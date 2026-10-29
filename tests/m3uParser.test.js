import { describe, it, expect } from 'vitest';
import { parseM3U } from '../server/services/m3uService.js';

describe('M3U / M3U8 Parser Service', () => {
  it('should parse valid M3U playlist with attributes correctly', () => {
    const sampleM3u = `
#EXTM3U
#EXTINF:-1 tvg-id="ch1.news" tvg-name="News 24" tvg-logo="https://example.com/logo1.png" group-title="الأخبار",قناة الأخبار 24
https://example.com/live/ch1.m3u8
#EXTINF:-1 tvg-id="ch2.sports" group-title="الرياضة",قناة الرياضة HD
https://example.com/live/sports.m3u8
    `;

    const result = parseM3U(sampleM3u);
    expect(result.channels.length).toBe(2);

    expect(result.channels[0].externalId).toBe('ch1.news');
    expect(result.channels[0].name).toBe('قناة الأخبار 24');
    expect(result.channels[0].category).toBe('الأخبار');
    expect(result.channels[0].logoUrl).toBe('https://example.com/logo1.png');
    expect(result.channels[0].streamUrl).toBe('https://example.com/live/ch1.m3u8');

    expect(result.channels[1].externalId).toBe('ch2.sports');
    expect(result.channels[1].name).toBe('قناة الرياضة HD');
    expect(result.channels[1].category).toBe('الرياضة');
  });

  it('should generate deterministic IDs when tvg-id is missing', () => {
    const sampleM3u = `
#EXTM3U
#EXTINF:-1,قناة وثائقية
https://example.com/stream/doc.m3u8
    `;

    const result1 = parseM3U(sampleM3u);
    const result2 = parseM3U(sampleM3u);

    expect(result1.channels.length).toBe(1);
    expect(result1.channels[0].externalId).toBeTruthy();
    // Deterministic: subsequent runs on the exact same stream and name give identical externalId!
    expect(result1.channels[0].externalId).toBe(result2.channels[0].externalId);
  });

  it('should sanitize HTML tags from channel name and category', () => {
    const sampleM3u = `
#EXTM3U
#EXTINF:-1 group-title="<b>أفلام</b>",<script>alert(1)</script>قناة السينما
https://example.com/cinema.m3u8
    `;

    const result = parseM3U(sampleM3u);
    expect(result.channels[0].name).toBe('قناة السينما');
    expect(result.channels[0].category).toBe('أفلام');
  });

  it('should throw an error on empty or invalid file content', () => {
    expect(() => parseM3U('')).toThrow('فارغ');
    expect(() => parseM3U('This is just random text with no links')).toThrow('لا يحتوي على صيغة M3U');
  });
});
