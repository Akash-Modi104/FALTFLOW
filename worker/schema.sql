-- Flatflow on Cloudflare D1. Apply with: npx wrangler@4.151.1 d1 execute flatflow --remote --file worker/schema.sql
-- Every id is a SHA-256 hash; invitation keys and session tokens are never stored.
CREATE TABLE IF NOT EXISTS homes (
  hash TEXT PRIMARY KEY,          -- hash of the household invitation key
  revision INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  home TEXT NOT NULL,             -- household JSON, as in the Sheet's Household JSON column
  op TEXT NOT NULL DEFAULT ''     -- last write's operation id, for idempotent retries
);
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,            -- hash of the Google account id
  data TEXT NOT NULL              -- {name, email, homes:[{key, person}]}
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,            -- hash of the session token
  sub TEXT NOT NULL,
  exp INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_sub ON sessions (sub);
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,            -- hash of endpoint|home hash
  home TEXT NOT NULL,
  person TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  keys TEXT,                      -- browser encryption keys as JSON, for encrypted expense messages
  sent TEXT NOT NULL DEFAULT '',  -- Berlin date the daily reminder was last handled
  test_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS devices_home ON devices (home);
CREATE TABLE IF NOT EXISTS settings (
  name TEXT PRIMARY KEY,          -- VAPID_PRIVATE, VAPID_PUBLIC or GOOGLE_CLIENT_ID, copied by the migration
  value TEXT NOT NULL
);
