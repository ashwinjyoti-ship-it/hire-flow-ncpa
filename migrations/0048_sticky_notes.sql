-- Shared call-capture sticky notes. Note content and lifecycle are shared with
-- the whole authenticated team; placement is stored separately per account.
CREATE TABLE IF NOT EXISTS sticky_notes (
  id                TEXT PRIMARY KEY,
  body              TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
  event_id          TEXT REFERENCES events(id),
  organisation_id   TEXT REFERENCES organisations(id),
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by        TEXT NOT NULL REFERENCES users(id),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  archived_by       TEXT REFERENCES users(id),
  archived_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_sticky_notes_status_created
  ON sticky_notes(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sticky_notes_event
  ON sticky_notes(event_id, status);
CREATE INDEX IF NOT EXISTS idx_sticky_notes_org
  ON sticky_notes(organisation_id, status);
CREATE INDEX IF NOT EXISTS idx_sticky_notes_creator
  ON sticky_notes(created_by, status);
CREATE INDEX IF NOT EXISTS idx_sticky_notes_archived
  ON sticky_notes(archived_at DESC);

CREATE TABLE IF NOT EXISTS sticky_note_layouts (
  note_id       TEXT NOT NULL REFERENCES sticky_notes(id),
  user_id       TEXT NOT NULL REFERENCES users(id),
  x             REAL NOT NULL CHECK (x >= 0 AND x <= 1),
  y             REAL NOT NULL CHECK (y >= 0 AND y <= 1),
  z_index       INTEGER NOT NULL DEFAULT 1 CHECK (z_index >= 0 AND z_index <= 100000),
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (note_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_sticky_note_layouts_user
  ON sticky_note_layouts(user_id, updated_at DESC);
