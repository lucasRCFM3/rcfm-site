CREATE TABLE IF NOT EXISTS cloud_save_users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS cloud_save_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES cloud_save_users(id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cloud_save_sessions_token_hash_idx ON cloud_save_sessions(token_hash);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS cloud_save_backups (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  size_bytes INTEGER NOT NULL,
  file_count INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES cloud_save_users(id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cloud_save_backups_user_game_created_idx ON cloud_save_backups(user_id, game_id, created_at DESC);
