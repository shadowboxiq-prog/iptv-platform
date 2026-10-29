import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import { createApp } from '../server/app.js';
import { db } from '../server/db/index.js';
import { config } from '../server/config/index.js';
import { encrypt, decrypt } from '../server/services/cryptoService.js';

describe('Multiple Stream Sources & Dynamic Switching', () => {
  const app = createApp();
  let adminToken;
  let testChannelId = uuidv4();

  beforeAll(() => {
    const adminId = uuidv4();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT OR REPLACE INTO admins (id, username, email, password_hash, role, created_at, updated_at)
      VALUES (?, 'test_source_admin', 'sources_admin@example.com', 'dummyhash', 'admin', ?, ?)
    `).run(adminId, now, now);

    adminToken = jwt.sign(
      { id: adminId, username: 'test_source_admin', role: 'admin' },
      config.jwtSecret,
      { expiresIn: '1h' }
    );
  });

  it('should create a channel with multiple alternative backup sources', async () => {
    const res = await request(app)
      .post('/api/admin/channels')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'قناة اختبار المصادر المتعددة',
        category: 'رياضة',
        streamUrl: 'https://cdn.example.com/primary.m3u8',
        backupSources: [
          { name: 'سيرفر بديل 1 (أوروبا)', url: 'https://cdn-eu.example.com/backup1.m3u8' },
          { name: 'سيرفر بديل 2 (آسيا)', url: 'https://cdn-asia.example.com/backup2.ts' }
        ],
        isActive: true
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    testChannelId = res.body.channelId;

    // Verify in database
    const row = db.prepare('SELECT * FROM channels WHERE id = ?').get(testChannelId);
    expect(row).toBeDefined();
    expect(decrypt(row.playback_ref)).toBe('https://cdn.example.com/primary.m3u8');
    expect(decrypt(row.backup_playback_ref)).toBe('https://cdn-eu.example.com/backup1.m3u8');

    const backupList = JSON.parse(row.backup_sources);
    expect(backupList.length).toBe(2);
    expect(backupList[0].name).toBe('سيرفر بديل 1 (أوروبا)');
    expect(decrypt(backupList[0].url)).toBe('https://cdn-eu.example.com/backup1.m3u8');
    expect(backupList[1].name).toBe('سيرفر بديل 2 (آسيا)');
    expect(decrypt(backupList[1].url)).toBe('https://cdn-asia.example.com/backup2.ts');
  });

  it('should retrieve channel details with decrypted backup sources for admin', async () => {
    const res = await request(app)
      .get(`/api/admin/channels/${testChannelId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.channel.streamUrl).toBe('https://cdn.example.com/primary.m3u8');
    expect(res.body.channel.backupSources).toHaveLength(2);
    expect(res.body.channel.backupSources[0].name).toBe('سيرفر بديل 1 (أوروبا)');
    expect(res.body.channel.backupSources[0].url).toBe('https://cdn-eu.example.com/backup1.m3u8');
    expect(res.body.channel.backupSources[1].name).toBe('سيرفر بديل 2 (آسيا)');
    expect(res.body.channel.backupSources[1].url).toBe('https://cdn-asia.example.com/backup2.ts');
  });

  it('should list channels for viewers with streamSources descriptors and no raw URLs exposed', async () => {
    const res = await request(app)
      .get('/api/player/channels')
      .query({ search: 'المصادر المتعددة' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const ch = res.body.channels.find(c => c.id === testChannelId);
    expect(ch).toBeDefined();
    expect(ch.hasMultipleSources).toBe(true);
    expect(ch.streamSources).toHaveLength(3);

    // Verify structure
    expect(ch.streamSources[0].name).toBe('المصدر الأساسي');
    expect(ch.streamSources[0].playbackUrl).toContain('source=0');
    expect(ch.streamSources[1].name).toBe('سيرفر بديل 1 (أوروبا)');
    expect(ch.streamSources[1].playbackUrl).toContain('source=1');
    expect(ch.streamSources[2].name).toBe('سيرفر بديل 2 (آسيا)');
    expect(ch.streamSources[2].playbackUrl).toContain('source=2');

    // Make sure no plain credentials or external URLs leak to viewer
    expect(JSON.stringify(ch)).not.toContain('https://cdn.example.com');
    expect(JSON.stringify(ch)).not.toContain('https://cdn-eu.example.com');
    expect(JSON.stringify(ch)).not.toContain('https://cdn-asia.example.com');
  });

  it('should update channel default active source to backup server', async () => {
    const updateRes = await request(app)
      .put(`/api/admin/channels/${testChannelId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        useBackup: 2 // Set backup 2 as default active source
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.ok).toBe(true);

    // Verify viewer endpoint now points to backup 2 as active source
    const viewerRes = await request(app).get(`/api/player/channels/${testChannelId}`);
    expect(viewerRes.status).toBe(200);
    expect(viewerRes.body.channel.activeSourceIndex).toBe(2);
    expect(viewerRes.body.channel.playbackUrl).toContain('source=2');
  });

  it('should handle legacy channel with single backup_playback_ref gracefully', async () => {
    const legacyId = uuidv4();
    const now = new Date().toISOString();
    const primaryEncrypted = encrypt('https://legacy.example.com/live.m3u8');
    const backupEncrypted = encrypt('https://legacy-backup.example.com/live.m3u8');

    db.prepare(`
      INSERT INTO channels (id, name, playback_ref, backup_playback_ref, backup_sources, use_backup, is_active, created_at, updated_at)
      VALUES (?, 'Legacy Single Backup Channel', ?, ?, NULL, 0, 1, ?, ?)
    `).run(legacyId, primaryEncrypted, backupEncrypted, now, now);

    const res = await request(app).get(`/api/player/channels/${legacyId}`);
    expect(res.status).toBe(200);
    expect(res.body.channel.hasMultipleSources).toBe(true);
    expect(res.body.channel.streamSources).toHaveLength(2);
    expect(res.body.channel.streamSources[0].name).toBe('المصدر الأساسي');
    expect(res.body.channel.streamSources[1].name).toBe('سيرفر بديل 1');
  });
});
