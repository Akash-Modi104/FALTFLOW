-- Flatflow on Cloudflare D1. Apply with: npx wrangler@4.151.1 d1 execute flatflow --remote --file worker/schema.sql
-- Every id is a SHA-256 hash; invitation keys and session tokens are never stored.
CREATE TABLE IF NOT EXISTS homes (
  hash TEXT PRIMARY KEY,          -- hash of the household invitation key
  revision INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  home TEXT NOT NULL,             -- household JSON
  op TEXT NOT NULL DEFAULT ''     -- last write's operation id, for idempotent retries
);
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,            -- random id (accounts from before sign-in methods: hash of the Google id)
  data TEXT NOT NULL              -- {name, email, homes:[{key, person}]}
);
CREATE TABLE IF NOT EXISTS logins (
  id TEXT PRIMARY KEY,            -- hash of provider:subject, e.g. google:<sub>, github:<id>, email:<address>
  account TEXT NOT NULL,
  provider TEXT NOT NULL          -- google, github or email
);
CREATE INDEX IF NOT EXISTS logins_account ON logins (account);
CREATE TABLE IF NOT EXISTS codes (
  id TEXT PRIMARY KEY,            -- hash of code:<email>
  code TEXT NOT NULL,             -- hash of email|code
  exp INTEGER NOT NULL,
  tries INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS limits (
  id TEXT PRIMARY KEY,            -- hash of limit:<what>:<who>
  n INTEGER NOT NULL,
  reset INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,            -- hash of the session token
  sub TEXT NOT NULL,              -- 'a:' + account id (older rows: the Google id)
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
  name TEXT PRIMARY KEY,          -- VAPID_PRIVATE, VAPID_PUBLIC, GOOGLE_CLIENT_ID, BREVO_API_KEY, BREVO_SENDER, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY,            -- hash of the short invite code (the code itself is never sent)
  home TEXT NOT NULL,
  sealed TEXT NOT NULL,           -- household key encrypted in the browser with the code
  exp INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS invites_home ON invites (home);
