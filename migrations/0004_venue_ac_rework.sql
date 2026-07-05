-- ============================================================
-- Migration 0004: Move AC timing into schedule_entries
-- ============================================================
-- Philosophy: a venue booking's hall-rental duration per day =
--   Σ(without-AC minutes) + Σ(with-AC minutes) across that day's
--   schedule entries. Per-booking AC start/end are no longer meaningful
--   because each activity (setup/rehearsal/show/dismantling/...) has its
--   own With-AC and Without-AC window.
--
-- 1. Drop the legacy AC columns from venue_bookings.
-- 2. Add With-AC / Without-AC columns to schedule_entries.

ALTER TABLE venue_bookings DROP COLUMN ac_start;
ALTER TABLE venue_bookings DROP COLUMN ac_end;
ALTER TABLE venue_bookings DROP COLUMN event_duration_minutes;

ALTER TABLE schedule_entries ADD COLUMN with_ac_start    TEXT;
ALTER TABLE schedule_entries ADD COLUMN with_ac_end      TEXT;
ALTER TABLE schedule_entries ADD COLUMN with_ac_minutes  INTEGER;
ALTER TABLE schedule_entries ADD COLUMN without_ac_start   TEXT;
ALTER TABLE schedule_entries ADD COLUMN without_ac_end     TEXT;
ALTER TABLE schedule_entries ADD COLUMN without_ac_minutes INTEGER;
