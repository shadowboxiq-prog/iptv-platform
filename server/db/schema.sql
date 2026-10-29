-- Stream Sources Table
CREATE TABLE IF NOT EXISTS stream_sources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('stalker', 'xtream', 'm3u')),
    endpoint TEXT,
    credentials_encrypted TEXT,
    is_active INTEGER DEFAULT 1,
    last_checked_at TEXT,
    last_checked_status TEXT,
    last_checked_message TEXT,
    last_sync_at TEXT,
    last_sync_status TEXT,
    imported_count INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Channels Library Table
CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    source_id TEXT,
    external_id TEXT,
    name TEXT NOT NULL,
    description TEXT,
    logo_url TEXT,
    category TEXT DEFAULT 'عام',
    playback_ref TEXT NOT NULL,
    backup_playback_ref TEXT,
    backup_sources TEXT,
    use_backup INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    last_checked_at TEXT,
    last_checked_status TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (source_id) REFERENCES stream_sources(id) ON DELETE CASCADE
);

-- Index for fast lookup, filtering and unique external_id per source
CREATE INDEX IF NOT EXISTS idx_channels_source ON channels(source_id);
CREATE INDEX IF NOT EXISTS idx_channels_category ON channels(category);
CREATE INDEX IF NOT EXISTS idx_channels_active ON channels(is_active);
CREATE INDEX IF NOT EXISTS idx_channels_source_ext ON channels(source_id, external_id);

-- Admins Table
CREATE TABLE IF NOT EXISTS admins (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'admin',
    failed_attempts INTEGER DEFAULT 0,
    locked_until TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Audit Logs Table
CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    admin_id TEXT,
    admin_username TEXT,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    details TEXT,
    ip_address TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);

-- Settings Table
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
