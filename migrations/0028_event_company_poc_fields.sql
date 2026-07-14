-- Event company contact fields under Point of Contact (organiser delegated by the booking org).

UPDATE checklist_definitions
SET sort_order = sort_order + 3
WHERE module = 'operations'
  AND sort_order > (
    SELECT sort_order FROM (
      SELECT sort_order FROM checklist_definitions WHERE field_key = 'poc_email' LIMIT 1
    )
  );

INSERT INTO checklist_definitions (
  id, module, section, field_key, label, field_type, options, default_value,
  vfh_only, is_computed, triggers_task, visibility_rule, sort_order, created_at
)
SELECT
  'cd_operations_event_company_contact_name',
  'operations',
  'Point of Contact',
  'event_company_contact_name',
  'Event Company Contact Name',
  'text',
  NULL,
  NULL,
  0,
  0,
  NULL,
  NULL,
  COALESCE((SELECT sort_order FROM checklist_definitions WHERE field_key = 'poc_email'), 0) + 1,
  datetime('now')
WHERE NOT EXISTS (
  SELECT 1 FROM checklist_definitions WHERE field_key = 'event_company_contact_name'
);

INSERT INTO checklist_definitions (
  id, module, section, field_key, label, field_type, options, default_value,
  vfh_only, is_computed, triggers_task, visibility_rule, sort_order, created_at
)
SELECT
  'cd_operations_event_company_contact_number',
  'operations',
  'Point of Contact',
  'event_company_contact_number',
  'Event Company Contact Number',
  'text',
  NULL,
  NULL,
  0,
  0,
  NULL,
  NULL,
  COALESCE((SELECT sort_order FROM checklist_definitions WHERE field_key = 'poc_email'), 0) + 2,
  datetime('now')
WHERE NOT EXISTS (
  SELECT 1 FROM checklist_definitions WHERE field_key = 'event_company_contact_number'
);

INSERT INTO checklist_definitions (
  id, module, section, field_key, label, field_type, options, default_value,
  vfh_only, is_computed, triggers_task, visibility_rule, sort_order, created_at
)
SELECT
  'cd_operations_event_company_email',
  'operations',
  'Point of Contact',
  'event_company_email',
  'Event Company Email',
  'text',
  NULL,
  NULL,
  0,
  0,
  NULL,
  NULL,
  COALESCE((SELECT sort_order FROM checklist_definitions WHERE field_key = 'poc_email'), 0) + 3,
  datetime('now')
WHERE NOT EXISTS (
  SELECT 1 FROM checklist_definitions WHERE field_key = 'event_company_email'
);
