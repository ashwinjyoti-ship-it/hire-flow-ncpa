-- ============================================================
-- Migration 0007: Backfill owner accounts for existing event owners
-- ============================================================
-- Phase 8a (identity layer). The "handled_by" dropdown options are free-text
-- staff names (Farha, Nasha, Delzeen, Adil). This one-time backfill creates a
-- real users row for each existing owner so that event ownership can be tied
-- to a login identity going forward.
--
-- Mechanics (run as raw SQL, so it CANNOT call the worker's
-- generateTemporaryPassword()/hashPassword()):
--   * Each owner gets a users row with a FIXED placeholder password
--     ("ChangeMe!Handoff2026", scrypt-hashed offline with the same params the
--      worker uses: N=16384, r=8, p=1, dkLen=32, format scrypt:<salt>:<hash>).
--   * must_change_password = 1  -> the owner must choose their own password on
--     first sign-in (the admin hands over the placeholder out-of-band).
--   * Email is a placeholder derived from the name (<slug>@local.handoff); the
--     admin edits it to the owner's real address via the Settings UI before
--     handover. users.email is UNIQUE, so the slug is made distinct.
--   * role = 'venue_manager' (the standard event-ops role; admin can change).
--
-- This is scaffolding for handoff, not production credentials. The admin
-- resets each owner's password via the new User Management surface before the
-- owner first signs in.
-- ============================================================

-- Insert a users row per handled_by owner that does not already have a user.
-- Names are matched on LOWER(value) = LOWER(name) to avoid dupes on re-run.
INSERT INTO users (id, email, name, role, organisation, password_hash, password_algo,
                   password_updated_at, is_active, must_change_password, created_at, updated_at)
SELECT
  'user_owner_' || LOWER(REPLACE(value, ' ', '_')),
  LOWER(REPLACE(value, ' ', '_')) || '@local.handoff',
  value,
  'venue_manager',
  'Events',
  'scrypt:9a06d49df2afbf7792e68992dd657eb1:ad2f5f8e6d043bbc38b4c13c165f3aeda28f7838c5d7d809fe39b6ee4de4f245',
  'scrypt',
  '2026-07-08T00:00:00.000Z',
  1,
  1,
  '2026-07-08T00:00:00.000Z',
  '2026-07-08T00:00:00.000Z'
FROM dropdown_options
WHERE list_key = 'handled_by'
  AND is_active = 1
  AND LOWER(value) NOT IN (SELECT LOWER(name) FROM users);
