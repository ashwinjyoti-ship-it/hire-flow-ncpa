-- ============================================================
-- Migration 0006: Password change / self-service reset / admin-forced reset
-- ============================================================
-- Self-service "forgot password" issues a single-use, time-limited token
-- (hashed at rest, never stored in cleartext). Admin-forced resets and
-- self-service resets both set must_change_password so the next sign-in
-- can prompt the user to choose their own password.

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  token_hash   TEXT NOT NULL UNIQUE,
  expires_at   TEXT NOT NULL,
  used_at      TEXT,
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id);

ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
