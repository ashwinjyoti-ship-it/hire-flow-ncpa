-- Split Operations Details "Licenses" into status dropdown + types textarea.
INSERT INTO checklist_definitions (
  id, module, section, field_key, label, field_type, options, default_value,
  vfh_only, is_computed, triggers_task, visibility_rule, sort_order, created_at
)
SELECT
  'chkdef_licenses_status',
  'operations',
  'Operations Details',
  'licenses_status',
  'Licenses — Received',
  'dropdown',
  '["Not received","Received"]',
  'Not received',
  0,
  0,
  NULL,
  NULL,
  COALESCE((SELECT MAX(sort_order) FROM checklist_definitions WHERE module = 'operations' AND section = 'Operations Details'), 0) + 1,
  datetime('now')
WHERE NOT EXISTS (
  SELECT 1 FROM checklist_definitions WHERE module = 'operations' AND field_key = 'licenses_status'
);

UPDATE checklist_definitions
SET label = 'Licenses — Types (PPL/IPRS etc.)'
WHERE module = 'operations' AND field_key = 'licenses';
