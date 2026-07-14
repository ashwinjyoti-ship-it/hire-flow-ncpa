-- Default vendor registration to not applicable (matches event form POC default).
UPDATE checklist_definitions
SET default_value = 'No Applicable'
WHERE module = 'operations' AND field_key = 'vendor_registration_form';
