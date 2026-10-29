import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let dbInstance = null;

export function getDatabase() {
  if (dbInstance) {
    return dbInstance;
  }

  const dbPath = path.resolve(process.cwd(), config.databasePath);
  const dbDir = path.dirname(dbPath);

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  dbInstance = new Database(dbPath);
  
  // Pragmas for performance and consistency
  dbInstance.pragma('journal_mode = WAL');
  dbInstance.pragma('foreign_keys = ON');

  // Initialize schema
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  dbInstance.exec(schemaSql);

  // Auto-migrate schema changes if needed
  try {
    const channelsCols = dbInstance.prepare("PRAGMA table_info(channels)").all();
    if (!channelsCols.some(col => col.name === 'backup_sources')) {
      dbInstance.exec("ALTER TABLE channels ADD COLUMN backup_sources TEXT");
    }
  } catch (migErr) {
    console.warn('Channels schema migration warning:', migErr.message);
  }

  // Initialize default settings if not exists
  const insertSetting = dbInstance.prepare(`
    INSERT OR IGNORE INTO settings (key, value, updated_at) 
    VALUES (?, ?, ?)
  `);

  const now = new Date().toISOString();
  insertSetting.run('auto_activate_imported', config.autoActivateImported ? 'true' : 'false', now);
  insertSetting.run('app_title', 'منصة البث المباشر (IPTV)', now);
  insertSetting.run('reconnect_max_attempts', '3', now);

  return dbInstance;
}

export const db = getDatabase();
export default db;
