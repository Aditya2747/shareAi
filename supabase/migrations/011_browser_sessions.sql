-- Cross-run browser session persistence (encrypted at rest).
-- Never store without explicit per-run opt-in (enforced in app code).

CREATE TABLE IF NOT EXISTS browser_sessions (
  id TEXT PRIMARY KEY,
  recipient_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  encrypted_session_blob TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (recipient_id, domain)
);

CREATE INDEX IF NOT EXISTS idx_browser_sessions_recipient
  ON browser_sessions(recipient_id);
CREATE INDEX IF NOT EXISTS idx_browser_sessions_expires
  ON browser_sessions(expires_at);

-- Per-run consent flags (default false = no reuse/persist)
ALTER TABLE execution_runs
  ADD COLUMN IF NOT EXISTS browser_reuse_session BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS browser_persist_session BOOLEAN NOT NULL DEFAULT FALSE;
