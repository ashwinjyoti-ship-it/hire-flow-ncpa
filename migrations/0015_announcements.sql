-- Team announcement: a single pinned message the admin can post to the
-- whole team's Dashboard (e.g. "no evening bookings this week"). Only one
-- announcement is ever "live" at a time — posting a new one clears the
-- previous row rather than deleting it, so there's a lightweight history.
-- Each user can dismiss the live announcement for themselves without
-- affecting what anyone else sees.
CREATE TABLE IF NOT EXISTS announcements (
  id          TEXT PRIMARY KEY,
  message     TEXT NOT NULL,
  created_by  TEXT REFERENCES users(id),
  created_at  TEXT NOT NULL,
  expires_at  TEXT,                 -- NULL = no auto-expiry
  cleared_at  TEXT,                 -- set when replaced or manually cleared
  cleared_by  TEXT REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_announcements_live ON announcements(cleared_at, created_at);

CREATE TABLE IF NOT EXISTS announcement_dismissals (
  announcement_id TEXT NOT NULL REFERENCES announcements(id),
  user_id         TEXT NOT NULL REFERENCES users(id),
  dismissed_at    TEXT NOT NULL,
  PRIMARY KEY (announcement_id, user_id)
);
