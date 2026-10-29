import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/index.js';
import { requireAdmin } from '../middleware/authMiddleware.js';
import { encrypt, decrypt } from '../services/cryptoService.js';
import { logAudit } from '../services/auditService.js';
import { getStreamType } from './viewerRoutes.js';

const router = express.Router();
router.use(requireAdmin);

/**
 * List all channels with pagination, search, category, source and active status filters.
 */
router.get('/', (req, res) => {
  const { search, category, sourceId, status, page = 1, limit = 50 } = req.query;

  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  let whereClauses = [];
  const params = [];

  if (search && search.trim()) {
    whereClauses.push('(c.name LIKE ? OR c.description LIKE ? OR c.external_id LIKE ?)');
    const term = `%${search.trim()}%`;
    params.push(term, term, term);
  }

  if (category && category !== 'all' && category !== 'الكل') {
    whereClauses.push('c.category = ?');
    params.push(category);
  }

  if (sourceId && sourceId !== 'all') {
    whereClauses.push('c.source_id = ?');
    params.push(sourceId);
  }

  if (status === 'active') {
    whereClauses.push('c.is_active = 1');
  } else if (status === 'inactive') {
    whereClauses.push('c.is_active = 0');
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  try {
    const countStmt = db.prepare(`
      SELECT COUNT(*) as total 
      FROM channels c 
      ${whereSql}
    `);
    const total = countStmt.get(...params).total;

    const channelsStmt = db.prepare(`
      SELECT 
        c.id, c.source_id, c.external_id, c.name, c.description, c.logo_url,
        c.category, c.use_backup, c.is_active, c.sort_order,
        c.playback_ref, c.backup_playback_ref, c.backup_sources,
        c.last_checked_at, c.last_checked_status, c.created_at, c.updated_at,
        s.name as source_name, s.type as source_type
      FROM channels c
      LEFT JOIN stream_sources s ON c.source_id = s.id
      ${whereSql}
      ORDER BY c.sort_order ASC, c.created_at DESC
      LIMIT ? OFFSET ?
    `);

    const rawChannels = channelsStmt.all(...params, limitNum, offset);
    const channels = rawChannels.map(ch => {
      let backupList = [];
      if (ch.backup_sources) {
        try {
          const parsed = JSON.parse(ch.backup_sources);
          if (Array.isArray(parsed)) backupList = parsed;
        } catch {}
      }
      if (backupList.length === 0 && ch.backup_playback_ref) {
        backupList = [{ id: 'legacy-1', name: 'سيرفر بديل 1', url: ch.backup_playback_ref }];
      }

      const totalSourcesCount = 1 + backupList.length;
      const activeIndex = typeof ch.use_backup === 'number' ? ch.use_backup : (ch.use_backup ? 1 : 0);

      // Determine active ref
      let activeRef = ch.playback_ref;
      let activeName = 'المصدر الأساسي';
      if (activeIndex > 0 && backupList[activeIndex - 1]) {
        activeRef = backupList[activeIndex - 1].url;
        activeName = backupList[activeIndex - 1].name || `سيرفر بديل ${activeIndex}`;
      } else if (activeIndex === 1 && ch.backup_playback_ref) {
        activeRef = ch.backup_playback_ref;
        activeName = 'سيرفر بديل 1';
      }

      const rawUrl = decrypt(activeRef) || '';
      const streamType = getStreamType(rawUrl);

      // Stream sources descriptor list (secure, no raw URLs)
      const streamSources = [
        { index: 0, id: 'primary', name: 'المصدر الأساسي', streamType: getStreamType(decrypt(ch.playback_ref)) }
      ];
      backupList.forEach((b, idx) => {
        const bDecrypted = decrypt(b.url) || '';
        streamSources.push({
          index: idx + 1,
          id: b.id || `backup-${idx + 1}`,
          name: b.name || `سيرفر بديل ${idx + 1}`,
          streamType: getStreamType(bDecrypted)
        });
      });

      const { playback_ref, backup_playback_ref, backup_sources, ...rest } = ch;
      return {
        ...rest,
        sourcesCount: totalSourcesCount,
        hasBackup: totalSourcesCount > 1,
        activeSourceIndex: activeIndex,
        activeSourceName: activeName,
        use_backup: activeIndex,
        streamSources,
        streamType,
        playbackUrl: `/api/player/stream/${ch.id}${streamType === 'ts' ? '.ts' : streamType === 'video' ? '.mp4' : '.m3u8'}?source=${activeIndex}`
      };
    });

    res.json({
      ok: true,
      channels,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (err) {
    console.error('Error fetching admin channels:', err);
    res.status(500).json({ ok: false, error: 'حدث خطأ أثناء تحميل مكتبة القنوات' });
  }
});

/**
 * List all unique channel categories for filtering and suggestions
 */
router.get('/categories', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT DISTINCT category 
      FROM channels 
      WHERE category IS NOT NULL AND TRIM(category) != ''
      ORDER BY category ASC
    `).all();

    res.json({
      ok: true,
      categories: rows.map(r => r.category)
    });
  } catch (err) {
    console.error('Error fetching admin channel categories:', err);
    res.status(500).json({ ok: false, error: 'حدث خطأ أثناء تحميل التصنيفات' });
  }
});

/**
 * Create a new channel manually
 */
router.post('/', (req, res) => {
  const { 
    name, description, logoUrl, category, sortOrder, isActive, 
    streamUrl, backupStreamUrl, backupSources, useBackup, sourceId 
  } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ ok: false, error: 'اسم القناة مطلوب' });
  }

  if (!streamUrl || !streamUrl.trim()) {
    return res.status(400).json({ ok: false, error: 'رابط البث مطلوب' });
  }

  const cleanStreamUrl = streamUrl.trim();
  if (!cleanStreamUrl.startsWith('http://') && !cleanStreamUrl.startsWith('https://')) {
    return res.status(400).json({ ok: false, error: 'رابط البث يجب أن يبدأ بـ http:// أو https://' });
  }

  const id = uuidv4();
  const now = new Date().toISOString();
  const encryptedPlayback = encrypt(cleanStreamUrl);

  // Process multiple backup sources
  let encryptedBackupSources = null;
  let primaryBackupRef = null;

  if (Array.isArray(backupSources) && backupSources.length > 0) {
    const valid = backupSources.filter(b => b && b.url && b.url.trim());
    if (valid.length > 0) {
      const encryptedList = valid.map((b, idx) => ({
        id: b.id || uuidv4(),
        name: b.name?.trim() || `سيرفر بديل ${idx + 1}`,
        url: encrypt(b.url.trim())
      }));
      encryptedBackupSources = JSON.stringify(encryptedList);
      primaryBackupRef = encryptedList[0].url;
    }
  } else if (backupStreamUrl && backupStreamUrl.trim()) {
    primaryBackupRef = encrypt(backupStreamUrl.trim());
    encryptedBackupSources = JSON.stringify([{
      id: uuidv4(),
      name: 'سيرفر بديل 1',
      url: primaryBackupRef
    }]);
  }

  const channelCategory = category?.trim() || 'عام';
  const channelIsActive = typeof isActive === 'boolean' ? (isActive ? 1 : 0) : 1;
  const channelSort = sortOrder !== undefined ? (parseInt(sortOrder, 10) || 0) : 0;
  const activeBackupIndex = typeof useBackup === 'number' ? useBackup : (useBackup ? 1 : 0);

  try {
    const insertStmt = db.prepare(`
      INSERT INTO channels (
        id, source_id, external_id, name, description, logo_url, category,
        playback_ref, backup_playback_ref, backup_sources, use_backup, is_active, sort_order,
        last_checked_at, last_checked_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ok', ?, ?)
    `);

    insertStmt.run(
      id,
      sourceId || null,
      `manual-${id.substring(0, 8)}`,
      name.trim(),
      description?.trim() || null,
      logoUrl?.trim() || null,
      channelCategory,
      encryptedPlayback,
      primaryBackupRef,
      encryptedBackupSources,
      activeBackupIndex,
      channelIsActive,
      channelSort,
      now,
      now,
      now
    );

    logAudit({
      adminId: req.admin.id,
      adminUsername: req.admin.username,
      action: 'CREATE_CHANNEL',
      entityType: 'channel',
      entityId: id,
      details: { name: name.trim(), category: channelCategory, isActive: channelIsActive === 1 },
      ipAddress: req.ip
    });

    res.json({
      ok: true,
      message: 'تمت إضافة القناة بنجاح',
      channelId: id
    });
  } catch (err) {
    console.error('Error creating manual channel:', err);
    res.status(500).json({ ok: false, error: 'حدث خطأ أثناء إضافة القناة' });
  }
});

/**
 * Get individual channel details including decrypted playback URLs for editing
 */
router.get('/:id', (req, res) => {
  const { id } = req.params;
  const stmt = db.prepare(`
    SELECT c.*, s.name as source_name, s.type as source_type 
    FROM channels c
    LEFT JOIN stream_sources s ON c.source_id = s.id
    WHERE c.id = ?
  `);
  const channel = stmt.get(id);

  if (!channel) {
    return res.status(404).json({ ok: false, error: 'القناة غير موجودة' });
  }

  // Admin can view/edit the stream URL
  const decryptedPlaybackUrl = decrypt(channel.playback_ref) || '';

  // Parse and decrypt all backup sources
  let backupList = [];
  if (channel.backup_sources) {
    try {
      const parsed = JSON.parse(channel.backup_sources);
      if (Array.isArray(parsed)) backupList = parsed;
    } catch {}
  }
  if (backupList.length === 0 && channel.backup_playback_ref) {
    backupList = [{ id: 'legacy-1', name: 'سيرفر بديل 1', url: channel.backup_playback_ref }];
  }

  const decryptedBackupSources = backupList.map((item, idx) => ({
    id: item.id || `backup-${idx + 1}`,
    name: item.name || `سيرفر بديل ${idx + 1}`,
    url: decrypt(item.url) || ''
  }));

  const activeIndex = typeof channel.use_backup === 'number' ? channel.use_backup : (channel.use_backup ? 1 : 0);

  res.json({
    ok: true,
    channel: {
      ...channel,
      streamUrl: decryptedPlaybackUrl,
      backupStreamUrl: decryptedBackupSources[0]?.url || '',
      backupSources: decryptedBackupSources,
      activeSourceIndex: activeIndex,
      use_backup: activeIndex,
      useBackup: activeIndex
    }
  });
});

/**
 * Update channel metadata or stream URLs
 */
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const { 
    name, description, logoUrl, category, sortOrder, isActive, 
    streamUrl, backupStreamUrl, backupSources, useBackup 
  } = req.body;

  const existingStmt = db.prepare('SELECT * FROM channels WHERE id = ?');
  const existing = existingStmt.get(id);

  if (!existing) {
    return res.status(404).json({ ok: false, error: 'القناة غير موجودة' });
  }

  let playbackRef = existing.playback_ref;
  if (streamUrl && streamUrl.trim()) {
    playbackRef = encrypt(streamUrl.trim());
  }

  let backupSourcesJson = existing.backup_sources;
  let backupRef = existing.backup_playback_ref;

  if (Array.isArray(backupSources)) {
    const valid = backupSources.filter(b => b && b.url && b.url.trim());
    if (valid.length > 0) {
      const encryptedList = valid.map((b, idx) => ({
        id: b.id || uuidv4(),
        name: b.name?.trim() || `سيرفر بديل ${idx + 1}`,
        url: encrypt(b.url.trim())
      }));
      backupSourcesJson = JSON.stringify(encryptedList);
      backupRef = encryptedList[0].url;
    } else {
      backupSourcesJson = null;
      backupRef = null;
    }
  } else if (backupStreamUrl !== undefined) {
    backupRef = backupStreamUrl.trim() ? encrypt(backupStreamUrl.trim()) : null;
    backupSourcesJson = backupRef ? JSON.stringify([{ id: uuidv4(), name: 'سيرفر بديل 1', url: backupRef }]) : null;
  }

  let activeBackupIndex = existing.use_backup;
  if (typeof useBackup === 'number') {
    activeBackupIndex = useBackup;
  } else if (typeof useBackup === 'boolean') {
    activeBackupIndex = useBackup ? 1 : 0;
  }

  const now = new Date().toISOString();
  const updateStmt = db.prepare(`
    UPDATE channels SET
      name = COALESCE(?, name),
      description = COALESCE(?, description),
      logo_url = COALESCE(?, logo_url),
      category = COALESCE(?, category),
      sort_order = COALESCE(?, sort_order),
      is_active = COALESCE(?, is_active),
      playback_ref = ?,
      backup_playback_ref = ?,
      backup_sources = ?,
      use_backup = ?,
      updated_at = ?
    WHERE id = ?
  `);

  updateStmt.run(
    name?.trim() || null,
    description !== undefined ? description?.trim() : null,
    logoUrl !== undefined ? logoUrl?.trim() : null,
    category?.trim() || null,
    sortOrder !== undefined ? parseInt(sortOrder, 10) : null,
    typeof isActive === 'boolean' ? (isActive ? 1 : 0) : null,
    playbackRef,
    backupRef,
    backupSourcesJson,
    activeBackupIndex,
    now,
    id
  );

  logAudit({
    adminId: req.admin.id,
    adminUsername: req.admin.username,
    action: 'UPDATE_CHANNEL',
    entityType: 'channel',
    entityId: id,
    details: { name, category, isActive, useBackup: activeBackupIndex },
    ipAddress: req.ip
  });

  res.json({ ok: true, message: 'تم تحديث بيانات القناة بنجاح' });
});

/**
 * Toggle channel active status quickly
 */
router.patch('/:id/toggle', (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT id, name, is_active FROM channels WHERE id = ?').get(id);

  if (!existing) {
    return res.status(404).json({ ok: false, error: 'القناة غير موجودة' });
  }

  const newStatus = existing.is_active === 1 ? 0 : 1;
  const now = new Date().toISOString();

  db.prepare('UPDATE channels SET is_active = ?, updated_at = ? WHERE id = ?').run(newStatus, now, id);

  logAudit({
    adminId: req.admin.id,
    adminUsername: req.admin.username,
    action: newStatus === 1 ? 'ACTIVATE_CHANNEL' : 'DEACTIVATE_CHANNEL',
    entityType: 'channel',
    entityId: id,
    details: { channelName: existing.name, newStatus },
    ipAddress: req.ip
  });

  res.json({
    ok: true,
    isActive: newStatus === 1,
    message: newStatus === 1 ? 'تم تفعيل القناة للمشاهدين' : 'تم إيقاف القناة'
  });
});

/**
 * Bulk activate or deactivate channels
 */
router.post('/bulk-toggle', (req, res) => {
  const { channelIds, activate } = req.body;

  if (!Array.isArray(channelIds) || channelIds.length === 0) {
    return res.status(400).json({ ok: false, error: 'يلزم تحديد قناة واحدة على الأقل' });
  }

  const targetStatus = activate ? 1 : 0;
  const now = new Date().toISOString();

  const updateStmt = db.prepare('UPDATE channels SET is_active = ?, updated_at = ? WHERE id = ?');
  const bulkTx = db.transaction((ids) => {
    let count = 0;
    for (const chId of ids) {
      const res = updateStmt.run(targetStatus, now, chId);
      count += res.changes;
    }
    return count;
  });

  const updatedCount = bulkTx(channelIds);

  logAudit({
    adminId: req.admin.id,
    adminUsername: req.admin.username,
    action: 'BULK_TOGGLE_CHANNELS',
    entityType: 'channel',
    details: { updatedCount, activate },
    ipAddress: req.ip
  });

  res.json({
    ok: true,
    message: `تم ${activate ? 'تفعيل' : 'تعطيل'} ${updatedCount} قناة بنجاح`,
    updatedCount
  });
});

/**
 * Bulk delete channels
 */
router.post('/bulk-delete', (req, res) => {
  const { channelIds } = req.body;

  if (!Array.isArray(channelIds) || channelIds.length === 0) {
    return res.status(400).json({ ok: false, error: 'يلزم تحديد قناة واحدة على الأقل للحذف' });
  }

  const deleteStmt = db.prepare('DELETE FROM channels WHERE id = ?');
  const bulkTx = db.transaction((ids) => {
    let count = 0;
    for (const chId of ids) {
      const result = deleteStmt.run(chId);
      count += result.changes;
    }
    return count;
  });

  const deletedCount = bulkTx(channelIds);

  logAudit({
    adminId: req.admin.id,
    adminUsername: req.admin.username,
    action: 'BULK_DELETE_CHANNELS',
    entityType: 'channel',
    details: { deletedCount },
    ipAddress: req.ip
  });

  res.json({
    ok: true,
    message: `تم حذف ${deletedCount} قناة بنجاح من المكتبة`,
    deletedCount
  });
});

/**
 * Delete a channel
 */
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT name FROM channels WHERE id = ?').get(id);

  if (!existing) {
    return res.status(404).json({ ok: false, error: 'القناة غير موجودة' });
  }

  db.prepare('DELETE FROM channels WHERE id = ?').run(id);

  logAudit({
    adminId: req.admin.id,
    adminUsername: req.admin.username,
    action: 'DELETE_CHANNEL',
    entityType: 'channel',
    entityId: id,
    details: { channelName: existing.name },
    ipAddress: req.ip
  });

  res.json({ ok: true, message: 'تم حذف القناة من المكتبة' });
});

export default router;
