import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, maskSecret, redactSensitiveData } from '../server/services/cryptoService.js';

describe('Crypto Service (AES-256-GCM & Secret Redaction)', () => {
  it('should encrypt and decrypt string values correctly', () => {
    const secret = 'super_secret_stream_key_12345';
    const encrypted = encrypt(secret);

    expect(encrypted).not.toBe(secret);
    expect(encrypted.split(':').length).toBe(3); // iv:tag:ciphertext

    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(secret);
  });

  it('should encrypt and decrypt JSON objects correctly', () => {
    const creds = { username: 'test_user', password: 'secret_password_987' };
    const encrypted = encrypt(creds);
    const decrypted = decrypt(encrypted, true);

    expect(decrypted).toEqual(creds);
  });

  it('should return null or fail gracefully when decrypting tampered data', () => {
    const original = encrypt('valid_secret');
    const tampered = original.slice(0, -4) + 'abcd';
    const result = decrypt(tampered);

    expect(result).toBeNull();
  });

  it('should mask secrets reliably', () => {
    expect(maskSecret('myPassword123')).toBe('••••••••');
    expect(maskSecret('')).toBe('');
    expect(maskSecret(null)).toBe('');
  });

  it('should recursively redact sensitive fields from audit/admin logs', () => {
    const payload = {
      username: 'admin',
      password: 'plain_password',
      token: 'jwt.token.here',
      nested: {
        secret: 'nested_secret',
        endpoint: 'http://example.com'
      }
    };

    const cleaned = redactSensitiveData(payload);
    expect(cleaned.password).toBe('••••••••');
    expect(cleaned.token).toBe('••••••••');
    expect(cleaned.nested.secret).toBe('••••••••');
    expect(cleaned.nested.endpoint).toBe('http://example.com');
  });
});
