import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/index.js';
import { encrypt, decrypt } from './cryptoService.js';

/**
 * Compare incoming channels from a stream source against currently saved channels.
 * Calculates diff without modifying the database.
 * 
 * @param {string} sourceId 
 * @param {Array<object>} incomingChannels 
 * @returns {object} Diff summary and details
 */
export function calculateSyncDiff(sourceId, incomingChannels) {
  const existingStmt = db.prepare(`
    SELECT id, external_id, name, logo_url, category, playback_ref, is_active, sort_order
    FROM channels 
    WHERE source_id = ?
  `);
  const existingChannels = existingStmt.all(sourceId);

  const existingMap = new Map();
  for (const ch of existingChannels) {
    if (ch.external_id) {
      existingMap.set(ch.external_id, ch);
    }
  }

  const incomingExtIds = new Set();
  const newChannels = [];
  const updatedChannels = [];
  const unchangedChannels = [];

  for (const incoming of incomingChannels) {
    incomingExtIds.add(incoming.externalId);
    const existing = existingMap.get(incoming.externalId);

    if (!existing) {
      newChannels.push(incoming);
    } else {
      const existingDecryptedUrl = decrypt(existing.playback_ref) || existing.playback_ref;
      const isChanged = 
        existing.name !== incoming.name ||
        (incoming.logoUrl && existing.logo_url !== incoming.logoUrl) ||
        (incoming.category && existing.category !== incoming.category) ||
        existingDecryptedUrl !== incoming.streamUrl;

      if (isChanged) {
        updatedChannels.push({
          id: existing.id,
          externalId: incoming.externalId,
          old: {
            name: existing.name,
            logoUrl: existing.logo_url,
            category: existing.category,
            isActive: existing.is_active
          },
          new: {
            name: incoming.name,
            logoUrl: incoming.logoUrl,
            category: incoming.category,
            streamUrl: incoming.streamUrl
          }
        });
      } else {
        unchangedChannels.push(existing.id);
      }
    }
  }

  // Suspended channels are those present in db but missing from current source response
  const suspendedChannels = [];
  for (const [extId, existing] of existingMap.entries()) {
    if (!incomingExtIds.has(extId)) {
      suspendedChannels.push({
        id: existing.id,
        externalId: extId,
        name: existing.name,
        category: existing.category,
        isActive: existing.is_active
      });
    }
  }

  return {
    counts: {
      new: newChannels.length,
      updated: updatedChannels.length,
      unchanged: unchangedChannels.length,
      suspended: suspendedChannels.length,
      totalIncoming: incomingChannels.length,
      totalExisting: existingChannels.length
    },
    diff: {
      newChannels: newChannels.slice(0, 100), // Preview sample
      updatedChannels: updatedChannels.slice(0, 100),
      suspendedChannels: suspendedChannels.slice(0, 100)
    }
  };
}

/**
 * Apply synchronization to the database safely within a transaction.
 * 
 * @param {string} sourceId 
 * @param {Array<object>} incomingChannels 
 * @param {object} options 
 * @param {boolean} [options.autoActivate=false] - activate newly imported channels
 * @param {string} [options.handleSuspended='keep'] - 'keep' | 'deactivate'
 * @returns {object} Final counts
 */
export function executeSync(sourceId, incomingChannels, options = {}) {
  const autoActivate = options.autoActivate === true ? 1 : 0;
  const handleSuspended = options.handleSuspended || 'keep'; // 'keep' or 'deactivate'

  const syncTx = db.transaction(() => {
    const existingStmt = db.prepare(`
      SELECT id, external_id, name, logo_url, category, playback_ref, is_active 
      FROM channels 
      WHERE source_id = ?
    `);
    const existingChannels = existingStmt.all(sourceId);
    const existingMap = new Map();
    for (const ch of existingChannels) {
      if (ch.external_id) {
        existingMap.set(ch.external_id, ch);
      }
    }

    const insertStmt = db.prepare(`
      INSERT INTO channels (
        id, source_id, external_id, name, description, logo_url, category,
        playback_ref, backup_playback_ref, use_backup, is_active, sort_order,
        last_checked_at, last_checked_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, 0, NULL, 'ok', ?, ?)
    `);

    const updateStmt = db.prepare(`
      UPDATE channels SET
        name = ?,
        logo_url = COALESCE(NULLIF(?, ''), logo_url),
        category = COALESCE(NULLIF(?, ''), category),
        playback_ref = ?,
        updated_at = ?
      WHERE id = ?
    `);

    const deactivateStmt = db.prepare(`
      UPDATE channels SET is_active = 0, updated_at = ? WHERE id = ?
    `);

    const now = new Date().toISOString();
    let newCount = 0;
    let updatedCount = 0;
    let unchangedCount = 0;
    let suspendedCount = 0;

    const incomingExtIds = new Set();

    for (const incoming of incomingChannels) {
      incomingExtIds.add(incoming.externalId);
      const existing = existingMap.get(incoming.externalId);

      const encryptedStreamUrl = encrypt(incoming.streamUrl);

      if (!existing) {
        // Insert new channel
        const newId = uuidv4();
        insertStmt.run(
          newId,
          sourceId,
          incoming.externalId,
          incoming.name,
          incoming.description || `قناة مستوردة (${incoming.category || 'عام'})`,
          incoming.logoUrl || '',
          incoming.category || 'عام',
          encryptedStreamUrl,
          autoActivate,
          now,
          now
        );
        newCount++;
      } else {
        // Update existing channel stream or metadata if needed
        updateStmt.run(
          incoming.name,
          incoming.logoUrl || '',
          incoming.category || '',
          encryptedStreamUrl,
          now,
          existing.id
        );
        updatedCount++;
      }
    }

    // Process suspended channels
    for (const [extId, existing] of existingMap.entries()) {
      if (!incomingExtIds.has(extId)) {
        suspendedCount++;
        if (handleSuspended === 'deactivate') {
          deactivateStmt.run(now, existing.id);
        }
        // Notice: We NEVER delete the channel here to prevent accidental loss of user favorites/curation!
      }
    }

    // Update source stats
    const totalCountStmt = db.prepare(`SELECT COUNT(*) as count FROM channels WHERE source_id = ?`);
    const totalCount = totalCountStmt.get(sourceId).count;

    const updateSourceStmt = db.prepare(`
      UPDATE stream_sources SET
        imported_count = ?,
        last_sync_at = ?,
        last_sync_status = 'success',
        last_checked_status = 'ok',
        updated_at = ?
      WHERE id = ?
    `);
    updateSourceStmt.run(totalCount, now, now, sourceId);

    return {
      newCount,
      updatedCount,
      suspendedCount,
      totalChannels: totalCount
    };
  });

  return syncTx();
}
