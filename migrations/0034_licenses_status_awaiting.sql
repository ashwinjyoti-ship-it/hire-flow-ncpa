-- Add "Awaiting" to the Licences — Required dropdown options.
UPDATE checklist_definitions
SET options = '["Not required","Awaiting","Received"]'
WHERE module = 'operations' AND field_key = 'licenses_status';
