-- ============================================================
-- Migration 0003: Collapse event status set to 6
-- ============================================================
-- Canonical statuses after this migration:
--   enquiry, tentative, approved (VFH only), confirmed, regret, cancelled
--
-- Mapping (old → new):
--   draft, inquiry                 → enquiry
--   availability_check,
--     awaiting_approval, waitlisted → tentative
--   in_progress, completed, closed  → confirmed
--   rejected                       → regret
--   cancelled                      → cancelled (unchanged)
--   (approved already exists)

UPDATE events SET status = 'enquiry'   WHERE status IN ('draft', 'inquiry');
UPDATE events SET status = 'tentative' WHERE status IN ('availability_check', 'awaiting_approval', 'waitlisted');
UPDATE events SET status = 'confirmed' WHERE status IN ('in_progress', 'completed', 'closed');
UPDATE events SET status = 'regret'    WHERE status IN ('rejected');

-- Migrate venue_bookings.booking_status: rejected → cancelled (no 'regret' at booking level).
UPDATE venue_bookings SET booking_status = 'cancelled' WHERE booking_status = 'rejected';

-- Mirror the rename in history rows so reports stay consistent.
UPDATE event_status_history SET from_status = 'enquiry'   WHERE from_status IN ('draft', 'inquiry');
UPDATE event_status_history SET to_status   = 'enquiry'   WHERE to_status   IN ('draft', 'inquiry');
UPDATE event_status_history SET from_status = 'tentative' WHERE from_status IN ('availability_check', 'awaiting_approval', 'waitlisted');
UPDATE event_status_history SET to_status   = 'tentative' WHERE to_status   IN ('availability_check', 'awaiting_approval', 'waitlisted');
UPDATE event_status_history SET from_status = 'confirmed' WHERE from_status IN ('in_progress', 'completed', 'closed');
UPDATE event_status_history SET to_status   = 'confirmed' WHERE to_status   IN ('in_progress', 'completed', 'closed');
UPDATE event_status_history SET from_status = 'regret'    WHERE from_status IN ('rejected');
UPDATE event_status_history SET to_status   = 'regret'    WHERE to_status   IN ('rejected');

-- Default new events to 'enquiry'.
UPDATE events SET status = 'enquiry' WHERE status = 'draft';

-- Replace the seeded event_status dropdown list with the 6 canonical values.
DELETE FROM dropdown_options WHERE list_key = 'event_status';
INSERT INTO dropdown_options (id, list_key, value, sort_order, is_active, metadata, created_at) VALUES
  ('es_enquiry',   'event_status', 'enquiry',   1, 1, NULL, datetime('now')),
  ('es_tentative', 'event_status', 'tentative', 2, 1, NULL, datetime('now')),
  ('es_approved',  'event_status', 'approved',  3, 1, '{"vfh_only": true}', datetime('now')),
  ('es_confirmed', 'event_status', 'confirmed', 4, 1, NULL, datetime('now')),
  ('es_regret',    'event_status', 'regret',    5, 1, '{"terminal": true}', datetime('now')),
  ('es_cancelled', 'event_status', 'cancelled', 6, 1, '{"terminal": true}', datetime('now'));
