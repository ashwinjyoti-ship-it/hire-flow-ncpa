-- ============================================================
-- Migration 0019: Normalize the venue list to 14 canonical caps values
-- ============================================================
-- Collapses the venue dropdown from 23 options (12 singles + 11 combos,
-- mixed-case) to a single canonical set of 14 venues, all uppercase:
--
--   JBT, TATA, TET, LT, GDT, OAP, JBT BOX, TATA GARDEN, TET GARDEN,
--   SUNKEN GARDEN, WEST ROOM 1, SVR, TATA LOBBY, JBT LOBBY
--
-- The seed (scripts/seed/seed-data.ts VENUES) is the source of truth for
-- fresh databases; this migration remaps EXISTING rows so records and the
-- dropdown_options list line up with the new vocabulary. Idempotent.
--
-- Two effects:
--   (a) Remap stored values in venue_bookings.venue and checklist_items.value
--       (field_key = 'venue'): mixed-case singles → caps; the retired
--       combined-venue combos collapse to their FIRST part (defensive — these
--       are not in active use). Values already canonical are left untouched.
--   (b) Normalize dropdown_options for list_key = 'venue': rename mixed-case
--       single venues in place, insert the two new venues, set the 14
--       canonical rows active with correct sort_order, and deactivate any
--       venue option not in the canonical set (the retired combos).
-- ============================================================

-- (a) Remap stored record values. Comparison is exact (case-sensitive) so the
-- CASE only rewrites the historical spellings; canonical caps values fall
-- through to ELSE and are unchanged. Runs in a single statement per table.

UPDATE venue_bookings
   SET venue = CASE venue
     -- mixed-case singles -> caps
     WHEN 'JBT Box'         THEN 'JBT BOX'
     WHEN 'TATA Garden'     THEN 'TATA GARDEN'
     WHEN 'TET Garden'      THEN 'TET GARDEN'
     WHEN 'Sunken Garden'   THEN 'SUNKEN GARDEN'
     WHEN 'West Room 1'     THEN 'WEST ROOM 1'
     -- retired combos -> first part
     WHEN 'TET & GDT'            THEN 'TET'
     WHEN 'JBT & OAP'            THEN 'JBT'
     WHEN 'TATA & OAP'           THEN 'TATA'
     WHEN 'TATA & TATA Garden'   THEN 'TATA'
     WHEN 'TET & OAP'            THEN 'TET'
     WHEN 'TET & TET Garden'     THEN 'TET'
     WHEN 'GDT & OAP'            THEN 'GDT'
     WHEN 'GDT & Sunken Garden'  THEN 'GDT'
     WHEN 'LT & OAP'             THEN 'LT'
     WHEN 'LT & TET Garden'      THEN 'LT'
     WHEN 'LT & Sunken Garden'   THEN 'LT'
     ELSE venue
   END
 WHERE venue IN (
   'JBT Box','TATA Garden','TET Garden','Sunken Garden','West Room 1',
   'TET & GDT','JBT & OAP','TATA & OAP','TATA & TATA Garden','TET & OAP',
   'TET & TET Garden','GDT & OAP','GDT & Sunken Garden','LT & OAP',
   'LT & TET Garden','LT & Sunken Garden'
 );

UPDATE checklist_items
   SET value = CASE value
     WHEN 'JBT Box'         THEN 'JBT BOX'
     WHEN 'TATA Garden'     THEN 'TATA GARDEN'
     WHEN 'TET Garden'      THEN 'TET GARDEN'
     WHEN 'Sunken Garden'   THEN 'SUNKEN GARDEN'
     WHEN 'West Room 1'     THEN 'WEST ROOM 1'
     WHEN 'TET & GDT'            THEN 'TET'
     WHEN 'JBT & OAP'            THEN 'JBT'
     WHEN 'TATA & OAP'           THEN 'TATA'
     WHEN 'TATA & TATA Garden'   THEN 'TATA'
     WHEN 'TET & OAP'            THEN 'TET'
     WHEN 'TET & TET Garden'     THEN 'TET'
     WHEN 'GDT & OAP'            THEN 'GDT'
     WHEN 'GDT & Sunken Garden'  THEN 'GDT'
     WHEN 'LT & OAP'             THEN 'LT'
     WHEN 'LT & TET Garden'      THEN 'LT'
     WHEN 'LT & Sunken Garden'   THEN 'LT'
     ELSE value
   END
 WHERE field_key = 'venue'
   AND value IN (
     'JBT Box','TATA Garden','TET Garden','Sunken Garden','West Room 1',
     'TET & GDT','JBT & OAP','TATA & OAP','TATA & TATA Garden','TET & OAP',
     'TET & TET Garden','GDT & OAP','GDT & Sunken Garden','LT & OAP',
     'LT & TET Garden','LT & Sunken Garden'
   );

-- (b) Normalize the dropdown_options rows for list_key = 'venue'.

-- (b1) Rename the mixed-case single venues to caps in place (same id).
UPDATE dropdown_options SET value = 'JBT BOX'      WHERE list_key = 'venue' AND value = 'JBT Box';
UPDATE dropdown_options SET value = 'TATA GARDEN'  WHERE list_key = 'venue' AND value = 'TATA Garden';
UPDATE dropdown_options SET value = 'TET GARDEN'   WHERE list_key = 'venue' AND value = 'TET Garden';
UPDATE dropdown_options SET value = 'SUNKEN GARDEN' WHERE list_key = 'venue' AND value = 'Sunken Garden';
UPDATE dropdown_options SET value = 'WEST ROOM 1'  WHERE list_key = 'venue' AND value = 'West Room 1';

-- (b2) Insert the two new venues (idempotent; ids follow the dd_<key>_<value> slug convention).
INSERT OR IGNORE INTO dropdown_options (id, list_key, value, sort_order, is_active, metadata, created_at)
  VALUES ('dd_venue_tata_lobby', 'venue', 'TATA LOBBY', 13, 1, NULL, '2026-07-13T00:00:00.000Z');
INSERT OR IGNORE INTO dropdown_options (id, list_key, value, sort_order, is_active, metadata, created_at)
  VALUES ('dd_venue_jbt_lobby', 'venue', 'JBT LOBBY', 14, 1, NULL, '2026-07-13T00:00:00.000Z');

-- (b3) Set the 14 canonical rows active with the correct sort_order. Running
-- this AFTER the renames above means the five renamed rows are now keyed by
-- their caps value and get caught by their canonical branch.
UPDATE dropdown_options SET is_active = 1, sort_order =
    CASE value
      WHEN 'JBT'           THEN 1
      WHEN 'TATA'          THEN 2
      WHEN 'TET'           THEN 3
      WHEN 'LT'            THEN 4
      WHEN 'GDT'           THEN 5
      WHEN 'OAP'           THEN 6
      WHEN 'JBT BOX'       THEN 7
      WHEN 'TATA GARDEN'   THEN 8
      WHEN 'TET GARDEN'    THEN 9
      WHEN 'SUNKEN GARDEN' THEN 10
      WHEN 'WEST ROOM 1'   THEN 11
      WHEN 'SVR'           THEN 12
      WHEN 'TATA LOBBY'    THEN 13
      WHEN 'JBT LOBBY'     THEN 14
    END
  WHERE list_key = 'venue'
    AND value IN (
      'JBT','TATA','TET','LT','GDT','OAP','JBT BOX','TATA GARDEN','TET GARDEN',
      'SUNKEN GARDEN','WEST ROOM 1','SVR','TATA LOBBY','JBT LOBBY'
    );

-- (b4) Deactivate any venue option not in the canonical 14 (the retired combos
-- and any stray legacy spellings). Soft-delete only — preserves history.
UPDATE dropdown_options
   SET is_active = 0
 WHERE list_key = 'venue'
   AND value NOT IN (
     'JBT','TATA','TET','LT','GDT','OAP','JBT BOX','TATA GARDEN','TET GARDEN',
     'SUNKEN GARDEN','WEST ROOM 1','SVR','TATA LOBBY','JBT LOBBY'
   );
