-- Programme officers are a name + contact dropdown list — not login accounts.
-- Backfill the program_officer master list from users previously flagged as POs,
-- storing contact in metadata JSON. Existing seed/list rows are left intact;
-- matching names get contact metadata when the user had a contact number.
UPDATE dropdown_options
SET metadata = (
  SELECT json_object('contact_number', u.contact_number)
  FROM users u
  WHERE u.is_programme_officer = 1
    AND LOWER(u.name) = LOWER(dropdown_options.value)
    AND u.contact_number IS NOT NULL
    AND TRIM(u.contact_number) != ''
  LIMIT 1
),
is_active = 1
WHERE list_key = 'program_officer'
  AND EXISTS (
    SELECT 1 FROM users u
    WHERE u.is_programme_officer = 1
      AND LOWER(u.name) = LOWER(dropdown_options.value)
  );

-- Insert PO-flagged users who are not yet in the list.
INSERT INTO dropdown_options (id, list_key, value, sort_order, is_active, metadata, created_at)
SELECT
  'dd_po_' || lower(hex(randomblob(8))),
  'program_officer',
  u.name,
  COALESCE((SELECT MAX(sort_order) FROM dropdown_options WHERE list_key = 'program_officer'), 0)
    + ROW_NUMBER() OVER (ORDER BY u.name),
  1,
  CASE
    WHEN u.contact_number IS NOT NULL AND TRIM(u.contact_number) != ''
      THEN json_object('contact_number', u.contact_number)
    ELSE NULL
  END,
  datetime('now')
FROM users u
WHERE u.is_programme_officer = 1
  AND NOT EXISTS (
    SELECT 1 FROM dropdown_options d
    WHERE d.list_key = 'program_officer' AND LOWER(d.value) = LOWER(u.name)
  );
