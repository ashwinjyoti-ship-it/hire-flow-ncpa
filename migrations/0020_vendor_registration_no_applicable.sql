-- Add "No Applicable" to Vendor Registration Form dropdown options.

UPDATE checklist_definitions
   SET options = '["Pending","Received","No Applicable"]'
 WHERE field_key = 'vendor_registration_form';

INSERT OR IGNORE INTO dropdown_options (id, list_key, value, sort_order, is_active, metadata, created_at)
VALUES ('dd_vendor_registration_no_applicable', 'vendor_registration', 'No Applicable', 3, 1, NULL, datetime('now'));

UPDATE dropdown_options
   SET is_active = 1, sort_order = 3
 WHERE list_key = 'vendor_registration' AND value = 'No Applicable';
