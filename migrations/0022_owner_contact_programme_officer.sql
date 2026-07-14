-- Event owner contact + programme officer flag (replaces static program_officer lookup).
ALTER TABLE users ADD COLUMN contact_number TEXT;
ALTER TABLE users ADD COLUMN is_programme_officer INTEGER NOT NULL DEFAULT 0;

-- Backfill programme officers from the legacy dropdown list where names match an owner account.
UPDATE users
SET is_programme_officer = 1
WHERE LOWER(name) IN (
  SELECT LOWER(value) FROM dropdown_options
  WHERE list_key = 'program_officer' AND is_active = 1
);
