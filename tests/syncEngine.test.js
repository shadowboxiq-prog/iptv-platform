import { describe, it, expect, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../server/db/index.js';
import { calculateSyncDiff, executeSync } from '../server/services/syncService.js';

describe('Channel Synchronization Engine', () => {
  let testSourceId;

  beforeEach(() => {
    testSourceId = uuidv4();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO stream_sources (id, name, type, is_active, created_at, updated_at)
      VALUES (?, 'Test Source', 'm3u', 1, ?, ?)
    `).run(testSourceId, now, now);
  });

  it('should detect new channels accurately in diff calculation', () => {
    const incoming = [
      {
        externalId: 'ext-ch-1',
        name: 'قناة الأخبار',
        category: 'أخبار',
        logoUrl: 'http://example.com/logo1.png',
        streamUrl: 'https://example.com/live/ch1.m3u8'
      },
      {
        externalId: 'ext-ch-2',
        name: 'قناة الوثائقي',
        category: 'وثائقي',
        logoUrl: 'http://example.com/logo2.png',
        streamUrl: 'https://example.com/live/ch2.m3u8'
      }
    ];

    const diff = calculateSyncDiff(testSourceId, incoming);
    expect(diff.counts.new).toBe(2);
    expect(diff.counts.updated).toBe(0);
    expect(diff.counts.suspended).toBe(0);
  });

  it('should sync channels and avoid duplicates upon re-syncing', () => {
    const incoming = [
      {
        externalId: 'ext-ch-1',
        name: 'قناة تجريبية 1',
        category: 'عام',
        logoUrl: 'http://example.com/logo1.png',
        streamUrl: 'https://example.com/live/1.m3u8'
      }
    ];

    // First sync
    const firstResult = executeSync(testSourceId, incoming, { autoActivate: true });
    expect(firstResult.newCount).toBe(1);

    // Verify channel inserted
    const channelsInDb = db.prepare('SELECT * FROM channels WHERE source_id = ?').all(testSourceId);
    expect(channelsInDb.length).toBe(1);
    expect(channelsInDb[0].name).toBe('قناة تجريبية 1');
    expect(channelsInDb[0].is_active).toBe(1);

    // Second sync with identical channels: should NOT insert duplicates!
    const secondDiff = calculateSyncDiff(testSourceId, incoming);
    expect(secondDiff.counts.new).toBe(0);
    expect(secondDiff.counts.unchanged).toBe(1);

    const secondResult = executeSync(testSourceId, incoming);
    expect(secondResult.newCount).toBe(0);

    const channelsAfterSecondSync = db.prepare('SELECT * FROM channels WHERE source_id = ?').all(testSourceId);
    expect(channelsAfterSecondSync.length).toBe(1);
  });

  it('should preserve suspended channels and not hard-delete them', () => {
    const ch1 = {
      externalId: 'persist-ch-1',
      name: 'قناة ثابتة',
      category: 'عام',
      streamUrl: 'https://example.com/live/persist.m3u8'
    };
    executeSync(testSourceId, [ch1]);

    // Next sync has empty incoming list (e.g. source temporarily down or missing the channel)
    const diff = calculateSyncDiff(testSourceId, []);
    expect(diff.counts.suspended).toBe(1);

    executeSync(testSourceId, [], { handleSuspended: 'keep' });

    // The channel must still exist in DB!
    const remainingChannels = db.prepare('SELECT * FROM channels WHERE source_id = ?').all(testSourceId);
    expect(remainingChannels.length).toBe(1);
    expect(remainingChannels[0].name).toBe('قناة ثابتة');
  });
});
