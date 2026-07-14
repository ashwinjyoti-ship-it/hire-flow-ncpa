-- Align licence status negative option with event form ("Not required").
UPDATE checklist_definitions
SET options = '["Not required","Received"]',
    default_value = 'Not required'
WHERE module = 'operations' AND field_key = 'licenses_status';

UPDATE checklist_items
SET value = 'Not required'
WHERE field_key = 'licenses_status' AND value = 'Not received';
