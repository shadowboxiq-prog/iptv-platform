import { describe, it, expect } from 'vitest';
import { validateSafeUrl } from '../server/services/ssrfService.js';

describe('SSRF Protection Service', () => {
  it('should block localhost and 127.0.0.1', async () => {
    const res1 = await validateSafeUrl('http://localhost:8080/playlist.m3u');
    expect(res1.isValid).toBe(false);
    expect(res1.error).toContain('محاولة الوصول');

    const res2 = await validateSafeUrl('http://127.0.0.1:3000/api');
    expect(res2.isValid).toBe(false);
  });

  it('should block internal private IP ranges (RFC 1918)', async () => {
    const res1 = await validateSafeUrl('http://192.168.1.1/stream');
    expect(res1.isValid).toBe(false);

    const res2 = await validateSafeUrl('http://10.0.0.5:8000/live');
    expect(res2.isValid).toBe(false);

    const res3 = await validateSafeUrl('http://172.16.0.10:8080/portal');
    expect(res3.isValid).toBe(false);
  });

  it('should block link-local cloud metadata service (169.254.169.254)', async () => {
    const res = await validateSafeUrl('http://169.254.169.254/latest/meta-data/');
    expect(res.isValid).toBe(false);
    expect(res.error).toContain('محاولة الوصول إلى عنوان شبكة محلي أو خاص');
  });

  it('should reject non-HTTP protocols such as file: and ftp:', async () => {
    const res1 = await validateSafeUrl('file:///etc/passwd');
    expect(res1.isValid).toBe(false);

    const res2 = await validateSafeUrl('ftp://example.com/playlist.m3u');
    expect(res2.isValid).toBe(false);
  });

  it('should allow valid public internet URLs', async () => {
    // 8.8.8.8 is a public DNS IP
    const res = await validateSafeUrl('https://8.8.8.8');
    expect(res.isValid).toBe(true);
  });
});
