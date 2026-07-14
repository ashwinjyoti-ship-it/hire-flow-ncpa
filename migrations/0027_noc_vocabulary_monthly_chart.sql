-- NOC: align dropdown vocabulary with Not sent / Sent; add OnStage monthly chart field.

UPDATE checklist_definitions
SET options = '["Not sent","Sent"]',
    default_value = 'Not sent'
WHERE field_key = 'noc_sent';

UPDATE checklist_definitions
SET visibility_rule = 'onlyWhen(noc_sent == Sent)'
WHERE field_key = 'noc_sent_on';

UPDATE checklist_items
SET value = 'Sent', status = 'completed', completed_at = COALESCE(completed_at, datetime('now'))
WHERE field_key = 'noc_sent' AND lower(trim(value)) = 'yes';

UPDATE checklist_items
SET value = 'Not sent', status = 'not_started', completed_at = NULL, completed_by = NULL
WHERE field_key = 'noc_sent' AND (value IS NULL OR trim(value) = '' OR lower(trim(value)) IN ('no', 'not sent'));

INSERT INTO checklist_definitions (
  id, module, section, field_key, label, field_type, options, default_value,
  vfh_only, is_computed, triggers_task, visibility_rule, sort_order, created_at
)
SELECT
  'cd_operations_monthly_chart_sent',
  'operations',
  'OnStage',
  'monthly_chart_sent',
  'SENT for Monthly Chart',
  'dropdown',
  '["Not sent","Sent"]',
  'Not sent',
  0,
  0,
  NULL,
  NULL,
  COALESCE((SELECT sort_order FROM checklist_definitions WHERE field_key = 'onstage_complete'), 0) + 1,
  datetime('now')
WHERE NOT EXISTS (
  SELECT 1 FROM checklist_definitions WHERE field_key = 'monthly_chart_sent'
);
