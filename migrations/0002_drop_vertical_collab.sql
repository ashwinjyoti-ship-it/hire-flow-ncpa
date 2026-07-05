-- ============================================================
-- Migration 0002: Remove Vertical & Collaboration Details
-- ============================================================
-- These free-text fields are no longer captured on the event form.
-- Organisation (events.organisation_id) is the canonical anchor for a record.

ALTER TABLE events DROP COLUMN vertical;
ALTER TABLE events DROP COLUMN collaboration_details;
