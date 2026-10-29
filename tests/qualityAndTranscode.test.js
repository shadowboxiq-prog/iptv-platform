import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { createApp } from '../server/app.js';
import { db } from '../server/db/index.js';
import { encrypt } from '../server/services/cryptoService.js';
import { 
  isTranscodeAvailable, 
  QUALITY_PRESETS, 
  extractQualityTag, 
  findSiblingChannels 
} from '../server/services/transcodeService.js';

describe('Quality Switching & Transcoding Features', () => {
  const app = createApp();
  let channelFhdId = uuidv4();
  let channelSdId = uuidv4();
  let channel4kId = uuidv4();

  beforeAll(() => {
    const now = new Date().toISOString();
    const encryptedRef = encrypt('http://example.com/live/stream1.ts');

    // Insert sibling channels with different quality tags
    db.prepare(`
      INSERT INTO channels (id, name, category, playback_ref, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)
    `).run(channelFhdId, 'Test Sports 1 FHD ◉', 'Sports', encryptedRef, now, now);

    db.prepare(`
      INSERT INTO channels (id, name, category, playback_ref, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)
    `).run(channelSdId, 'Test Sports 1 SD', 'Sports', encryptedRef, now, now);

    db.prepare(`
      INSERT INTO channels (id, name, category, playback_ref, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)
    `).run(channel4kId, 'Test Sports 1 4K UHD', 'Sports', encryptedRef, now, now);
  });

  it('should confirm ffmpeg transcoding capability and presets', () => {
    expect(isTranscodeAvailable()).toBe(true);
    expect(QUALITY_PRESETS).toHaveProperty('720p');
    expect(QUALITY_PRESETS).toHaveProperty('480p');
    expect(QUALITY_PRESETS).toHaveProperty('360p');
    expect(QUALITY_PRESETS['360p'].height).toBe(360);
    expect(QUALITY_PRESETS['480p'].height).toBe(480);
    expect(QUALITY_PRESETS['720p'].height).toBe(720);
  });

  it('should correctly parse quality tags from channel names', () => {
    expect(extractQualityTag('UK: BBC 1 4K ◉')).toBe('4K UHD');
    expect(extractQualityTag('UK: BBC 1 HD ◉')).toBe('HD 720p');
    expect(extractQualityTag('BeIN Sports 1 FHD')).toBe('FHD 1080p');
    expect(extractQualityTag('OSN Movies SD')).toBe('SD');
    expect(extractQualityTag('Sky Sports HEVC')).toBe('HEVC');
  });

  it('should detect sibling channels with different resolutions', () => {
    const siblings = findSiblingChannels(db, channelFhdId, 'Test Sports 1 FHD ◉', 'Sports');
    expect(siblings.length).toBeGreaterThan(0);
    const names = siblings.map(s => s.name);
    expect(names.some(n => n.includes('4K') || n.includes('SD'))).toBe(true);
  });

  it('should serve /api/player/channels/:id/qualities endpoint with presets and siblings', async () => {
    const res = await request(app).get(`/api/player/channels/${channelFhdId}/qualities`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.canTranscode).toBe(true);
    expect(res.body.presets.length).toBe(3);
    expect(res.body.presets.map(p => p.id)).toEqual(['720p', '480p', '360p']);
    expect(res.body.siblings.length).toBeGreaterThan(0);
  });
});
