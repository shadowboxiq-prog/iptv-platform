import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';

dotenv.config();

const env = process.env.NODE_ENV || 'development';

if (env === 'production') {
  if (!/^[a-f0-9]{64}$/i.test(process.env.APP_SECRET_KEY || '')) {
    throw new Error('Production requires APP_SECRET_KEY to be a 32-byte hexadecimal key.');
  }
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error('Production requires JWT_SECRET to contain at least 32 characters.');
  }
}

// Ensure 32-byte secret key for AES-256-GCM
let appSecretKey = process.env.APP_SECRET_KEY;
if (!appSecretKey || Buffer.from(appSecretKey, 'hex').length !== 32) {
  // If not provided or invalid length, fallback to SHA-256 hash of whatever string was provided
  const baseKey = appSecretKey || 'default_insecure_fallback_key_for_dev_mode_only';
  appSecretKey = crypto.createHash('sha256').update(baseKey).digest('hex');
}

export const config = {
  env,
  port: parseInt(process.env.PORT || '3000', 10),
  appSecretKey,
  jwtSecret: process.env.JWT_SECRET || 'jwt_secret_dev_key_replace_in_production',
  databasePath: process.env.VITEST ? './data/iptv_test.db' : (process.env.DATABASE_PATH || './data/iptv.db'),
  autoActivateImported: process.env.AUTO_ACTIVATE_IMPORTED === 'true',
  setupToken: process.env.SETUP_TOKEN || '',
  // Rate limiting parameters
  maxLoginAttempts: 5,
  loginLockoutMinutes: 15,
  // File upload restrictions
  maxUploadSizeBytes: 15 * 1024 * 1024, // 15MB max M3U upload
};

export default config;
