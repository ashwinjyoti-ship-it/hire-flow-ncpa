-- Add "Not Applicable" to the NOC Sent? dropdown (Operations checklist).
UPDATE checklist_definitions
SET options = '["Not Applicable", "Not sent", "Sent"]'
WHERE module = 'operations' AND field_key = 'noc_sent';
