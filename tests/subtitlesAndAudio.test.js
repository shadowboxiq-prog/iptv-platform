import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { db } from '../server/db/index.js';
import { 
  parseProbeOutput, 
  srtToWebVtt, 
  formatLanguageLabel,
  searchOnlineSubtitles 
} from '../server/services/subtitleService.js';
import { encrypt } from '../server/services/cryptoService.js';

describe('VOD Subtitles & Multi-Audio Capabilities', () => {
  const app = createApp();
  let testChannelId = 'test-series-vod-1';

  beforeAll(() => {
    // Insert a test series episode channel
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO channels (
        id, name, description, logo_url, category, playback_ref, is_active, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, 0, datetime('now'), datetime('now'))
    `);

    stmt.run(
      testChannelId,
      'Vikings S01E01 - Ragnars Journey',
      'حلقة تجريبية لاختبار الترجمات وتعدد اللغات الصوتية',
      'https://example.com/vikings.png',
      'مسلسلات',
      encrypt('http://example.com/streams/vikings_s01e01.mkv')
    );
  });

  describe('Subtitle & Audio Parsing Utilities', () => {
    it('should correctly format language labels to friendly Arabic names', () => {
      expect(formatLanguageLabel('ara')).toContain('العربية');
      expect(formatLanguageLabel('eng')).toContain('الإنجليزية');
      expect(formatLanguageLabel('fra')).toContain('الفرنسية');
      expect(formatLanguageLabel('und')).toContain('غير محدد');
    });

    it('should accurately parse probe output into audio and subtitle tracks', () => {
      const mockFfmpegStderr = `
Input #0, matroska,webm, from 'episode.mkv':
  Duration: 00:45:10.50, start: 0.000000, bitrate: 4500 kb/s
    Stream #0:0(eng): Video: h264 (High), yuv420p, 1920x1080, 24 fps
    Stream #0:1(ara): Audio: aac (LC), 48000 Hz, stereo, fltp (default)
      Metadata:
        title           : Arabic Dubbed (مدبلج عربي)
    Stream #0:2(eng): Audio: ac3, 48000 Hz, 5.1(side), fltp
      Metadata:
        title           : English 5.1 Original
    Stream #0:3(ara): Subtitle: subrip (default)
      Metadata:
        title           : العربية - ترجمة احترافية
    Stream #0:4(eng): Subtitle: subrip
      Metadata:
        title           : English SDH
      `;

      const result = parseProbeOutput(mockFfmpegStderr);

      expect(result.audioTracks).toHaveLength(2);
      expect(result.audioTracks[0].language).toBe('ara');
      expect(result.audioTracks[0].title).toBe('Arabic Dubbed (مدبلج عربي)');
      expect(result.audioTracks[1].language).toBe('eng');

      expect(result.subtitleTracks).toHaveLength(2);
      expect(result.subtitleTracks[0].language).toBe('ara');
      expect(result.subtitleTracks[0].title).toBe('العربية - ترجمة احترافية');
      expect(result.subtitleTracks[1].language).toBe('eng');
    });

    it('should convert SRT timestamp format to valid WebVTT format', () => {
      const srt = `1\r\n00:00:01,500 --> 00:00:04,200\r\nمرحبا بك في الحلقة\r\n\r\n2\r\n00:00:05,000 --> 00:00:08,000\r\nهذه ترجمة تجريبية`;
      const vtt = srtToWebVtt(srt);

      expect(vtt).toContain('WEBVTT');
      expect(vtt).toContain('00:00:01.500 --> 00:00:04.200');
      expect(vtt).toContain('00:00:05.000 --> 00:00:08.000');
      expect(vtt).toContain('مرحبا بك في الحلقة');
    });
  });

  describe('Public API Endpoints for Subtitles and Audio', () => {
    it('GET /api/player/channels/:id/media-tracks should return media tracks structure', async () => {
      const res = await request(app)
        .get(`/api/player/channels/${testChannelId}/media-tracks`)
        .expect(200);

      expect(res.body.ok).toBe(true);
      expect(res.body.channelId).toBe(testChannelId);
      expect(res.body).toHaveProperty('audioTracks');
      expect(res.body).toHaveProperty('subtitleTracks');
    });

    it('GET /api/player/subtitles/search should return online subtitle search results', async () => {
      const res = await request(app)
        .get('/api/player/subtitles/search?query=Vikings&lang=ar')
        .expect(200);

      expect(res.body.ok).toBe(true);
      expect(res.body.query).toBe('Vikings');
      expect(Array.isArray(res.body.results)).toBe(true);
      expect(res.body.results.length).toBeGreaterThan(0);
      expect(res.body.results[0]).toHaveProperty('title');
      expect(res.body.results[0]).toHaveProperty('language');
    });

    it('GET /api/player/subtitles/download should return WebVTT stream with correct Content-Type', async () => {
      const res = await request(app)
        .get('/api/player/subtitles/download?id=demo-ar-1')
        .expect(200);

      expect(res.headers['content-type']).toContain('text/vtt');
      expect(res.text).toContain('WEBVTT');
    });
  });
});
