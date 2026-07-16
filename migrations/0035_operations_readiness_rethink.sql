-- Operations is action-only; event-form data is represented by computed readiness.

UPDATE tasks
SET source_checklist_item_id = NULL
WHERE source_checklist_item_id IN (
  SELECT id FROM checklist_items WHERE field_key IN (
    'poc_name','poc_contact_number','poc_email','event_company_contact_name',
    'event_company_contact_number','event_company_email','bank_details','gst_no','tan_no','pan_no',
    'signing_authority_address','courier_address','vendor_registration_form',
    'setup_date','rehearsal_date','dismantling_date','nature_of_event',
    'exec_sound_light','exec_staffing','exec_recording_special','exec_catering_decorator','exec_operations','exec_additional',
    'no_of_crew_cards','house_seats','licenses_status','licenses','decorator_name','decorator_tier','caterer_name','catering_details'
  )
);

DELETE FROM checklist_items
WHERE field_key IN (
  'poc_name','poc_contact_number','poc_email','event_company_contact_name',
  'event_company_contact_number','event_company_email','bank_details','gst_no','tan_no','pan_no',
  'signing_authority_address','courier_address','vendor_registration_form',
  'setup_date','rehearsal_date','dismantling_date','nature_of_event',
  'exec_sound_light','exec_staffing','exec_recording_special','exec_catering_decorator','exec_operations','exec_additional',
  'no_of_crew_cards','house_seats','licenses_status','licenses','decorator_name','decorator_tier','caterer_name','catering_details'
);

DELETE FROM checklist_definitions
WHERE module = 'operations' AND field_key IN (
  'poc_name','poc_contact_number','poc_email','event_company_contact_name',
  'event_company_contact_number','event_company_email','bank_details','gst_no','tan_no','pan_no',
  'signing_authority_address','courier_address','vendor_registration_form',
  'setup_date','rehearsal_date','dismantling_date','nature_of_event',
  'exec_sound_light','exec_staffing','exec_recording_special','exec_catering_decorator','exec_operations','exec_additional',
  'no_of_crew_cards','house_seats','licenses_status','licenses','decorator_name','decorator_tier','caterer_name','catering_details'
);

UPDATE checklist_definitions
SET section = 'Event Reference', field_type = 'computed', is_computed = 1, options = NULL, default_value = NULL
WHERE module = 'operations' AND field_key IN ('event_name','event_dates','venue','event_type');

UPDATE checklist_items
SET section = 'Event Reference'
WHERE module = 'operations' AND field_key = 'event_dates';

INSERT OR IGNORE INTO checklist_definitions (
  id, module, section, field_key, label, field_type, options, default_value,
  vfh_only, is_computed, triggers_task, visibility_rule, sort_order, created_at
) VALUES (
  'cd_operations_final_closure_notes', 'operations', 'Post-Event Closure',
  'final_closure_notes', 'Final Closure Notes', 'textarea', NULL, NULL,
  0, 0, NULL, NULL, 999, datetime('now')
);

UPDATE events
SET requirements = REPLACE(requirements, '"No Applicable"', '"Not Applicable"')
WHERE requirements LIKE '%"No Applicable"%';

UPDATE venue_bookings
SET requirements = REPLACE(requirements, '"No Applicable"', '"Not Applicable"')
WHERE requirements LIKE '%"No Applicable"%';
