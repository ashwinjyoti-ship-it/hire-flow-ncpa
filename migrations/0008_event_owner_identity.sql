-- ============================================================
-- Migration 0008: Link event_owner to a real user identity (Phase 8b)
-- ============================================================
-- Phase 8a created real accounts for event owners. Phase 8b ties
-- events.event_owner to that identity. We add a nullable FK column
-- event_owner_id → users(id) ALONGSIDE the existing event_owner text column
-- (kept for display/back-compat — historical events whose text owner has no
-- matching user still render their name).
--
-- Backfill: every events row whose event_owner text matches a users.name gets
-- its event_owner_id populated. Unmatched rows stay NULL (the text label
-- remains the source of truth for them). This is idempotent and non-destructive.
-- ============================================================

ALTER TABLE events ADD COLUMN event_owner_id TEXT REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_events_owner_id ON events(event_owner_id);

-- Backfill by exact name match (case-insensitive). Existing demo events use
-- full names ("Aditi Rao") that match demo users exactly; the backfilled
-- dropdown owners ("Farha" etc.) own no events yet, so there are no orphans.
UPDATE events
SET event_owner_id = (
  SELECT u.id FROM users u WHERE LOWER(u.name) = LOWER(events.event_owner) LIMIT 1
)
WHERE event_owner IS NOT NULL
  AND event_owner_id IS NULL
  AND EXISTS (
    SELECT 1 FROM users u WHERE LOWER(u.name) = LOWER(events.event_owner)
  );
