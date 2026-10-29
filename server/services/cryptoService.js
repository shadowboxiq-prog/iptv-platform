import crypto from 'crypto';
import { config } from '../config/index.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // Standard for AES-GCM

const getKeyBuffer = () => {
  return Buffer.from(config.appSecretKey, 'hex');
};

/**
 * Encrypt a UTF-8 string or JSON payload using AES-256-GCM.
 * @param {string|object} data 
 * @returns {string} iv:tag:ciphertext (hex-encoded)
 */
export function encrypt(data) {
  if (data === null || data === undefined || data === '') {
    return '';
  }
  const text = typeof data === 'object' ? JSON.stringify(data) : String(data);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = getKeyBuffer();

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypt an AES-256-GCM encrypted string.
 * @param {string} cipherText 
 * @param {boolean} parseJson - whether to parse result as JSON
 * @returns {string|object|null}
 */
export function decrypt(cipherText, parseJson = false) {
  if (!cipherText || typeof cipherText !== 'string') {
    return null;
  }
  const parts = cipherText.split(':');
  if (parts.length !== 3) {
    // Return as-is if not encrypted in expected format (e.g. legacy plain text)
    return cipherText;
  }

  try {
    const [ivHex, tagHex, encryptedHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(tagHex, 'hex');
    const key = getKeyBuffer();

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    if (parseJson) {
      try {
        return JSON.parse(decrypted);
      } catch {
        return decrypted;
      }
    }
    return decrypted;
  } catch (err) {
    console.error('Decryption failed:', err.message);
    return null;
  }
}

/**
 * Mask sensitive strings (like passwords, keys, tokens).
 * @param {string} str 
 * @returns {string}
 */
export function maskSecret(str) {
  if (!str) return '';
  if (typeof str !== 'string') return '••••••••';
  if (str.length <= 4) return '••••••••';
  return '••••••••';
}

/**
 * Clean and redact sensitive keys from objects before sending to admin UI or audit logs.
 */
const SENSITIVE_KEYS = new Set([
  'password',
  'passwordhash',
  'password_hash',
  'secret',
  'credentials',
  'token',
  'auth_token',
  'jwtsecret',
  'appsecretkey',
  'mac'
]);

export function redactSensitiveData(data) {
  if (!data || typeof data !== 'object') {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map(item => redactSensitiveData(item));
  }

  const cleaned = {};
  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.has(lowerKey)) {
      cleaned[key] = '••••••••';
    } else if (typeof value === 'object' && value !== null) {
      cleaned[key] = redactSensitiveData(value);
    } else {
      cleaned[key] = value;
    }
  }
  return cleaned;
}
