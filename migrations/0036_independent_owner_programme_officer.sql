-- Event owner and programme officer are independent designations on a person
-- account. Previously every account was treated as an event owner, and programme
-- officer was only a nested checkbox — so a PO without ownership was impossible.
ALTER TABLE users ADD COLUMN is_event_owner INTEGER NOT NULL DEFAULT 0;

-- Preserve anyone already treated as an owner (dropdown option and/or assigned events).
UPDATE users
SET is_event_owner = 1
WHERE id IN (
  SELECT DISTINCT event_owner_id FROM events WHERE event_owner_id IS NOT NULL
)
OR LOWER(name) IN (
  SELECT LOWER(value) FROM dropdown_options WHERE list_key = 'handled_by'
);
