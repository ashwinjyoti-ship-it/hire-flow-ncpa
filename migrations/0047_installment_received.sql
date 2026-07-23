-- Per-installment "received" checkboxes + defer follow-up tasks until the expected date.

INSERT INTO checklist_definitions (
  id, module, section, field_key, label, field_type, options, default_value,
  vfh_only, is_computed, triggers_task, visibility_rule, sort_order, created_at
)
SELECT
  'cd_operations_installment_1_received',
  'operations',
  'Financials',
  'installment_1_received',
  'Installment 1 — Received',
  'checkbox',
  NULL,
  NULL,
  0,
  0,
  NULL,
  'onlyWhen(instalment == Yes)',
  COALESCE((SELECT sort_order FROM checklist_definitions WHERE field_key = 'installment_1_expected_date'), 0) + 1,
  datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM checklist_definitions WHERE field_key = 'installment_1_received');

INSERT INTO checklist_definitions (
  id, module, section, field_key, label, field_type, options, default_value,
  vfh_only, is_computed, triggers_task, visibility_rule, sort_order, created_at
)
SELECT
  'cd_operations_installment_2_received',
  'operations',
  'Financials',
  'installment_2_received',
  'Installment 2 — Received',
  'checkbox',
  NULL,
  NULL,
  0,
  0,
  NULL,
  'onlyWhen(instalment == Yes)',
  COALESCE((SELECT sort_order FROM checklist_definitions WHERE field_key = 'installment_2_expected_date'), 0) + 1,
  datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM checklist_definitions WHERE field_key = 'installment_2_received');

INSERT INTO checklist_definitions (
  id, module, section, field_key, label, field_type, options, default_value,
  vfh_only, is_computed, triggers_task, visibility_rule, sort_order, created_at
)
SELECT
  'cd_operations_installment_3_received',
  'operations',
  'Financials',
  'installment_3_received',
  'Installment 3 — Received',
  'checkbox',
  NULL,
  NULL,
  0,
  0,
  NULL,
  'onlyWhen(instalment == Yes)',
  COALESCE((SELECT sort_order FROM checklist_definitions WHERE field_key = 'installment_3_expected_date'), 0) + 1,
  datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM checklist_definitions WHERE field_key = 'installment_3_received');

INSERT INTO checklist_definitions (
  id, module, section, field_key, label, field_type, options, default_value,
  vfh_only, is_computed, triggers_task, visibility_rule, sort_order, created_at
)
SELECT
  'cd_operations_installment_4_received',
  'operations',
  'Financials',
  'installment_4_received',
  'Installment 4 — Received',
  'checkbox',
  NULL,
  NULL,
  0,
  0,
  NULL,
  'onlyWhen(instalment == Yes)',
  COALESCE((SELECT sort_order FROM checklist_definitions WHERE field_key = 'installment_4_expected_date'), 0) + 1,
  datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM checklist_definitions WHERE field_key = 'installment_4_received');

INSERT INTO checklist_definitions (
  id, module, section, field_key, label, field_type, options, default_value,
  vfh_only, is_computed, triggers_task, visibility_rule, sort_order, created_at
)
SELECT
  'cd_operations_installment_5_received',
  'operations',
  'Financials',
  'installment_5_received',
  'Installment 5 — Received',
  'checkbox',
  NULL,
  NULL,
  0,
  0,
  NULL,
  'onlyWhen(instalment == Yes)',
  COALESCE((SELECT sort_order FROM checklist_definitions WHERE field_key = 'installment_5_expected_date'), 0) + 1,
  datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM checklist_definitions WHERE field_key = 'installment_5_received');

INSERT OR IGNORE INTO checklist_items (
  id, event_id, definition_id, module, section, field_key, label, status, value, due_date,
  completed_at, completed_by, last_updated_at, last_updated_by
)
SELECT
  'cli_' || cd.field_key || '_' || e.id,
  e.id,
  cd.id,
  'operations',
  'Financials',
  cd.field_key,
  cd.label,
  'not_started',
  NULL,
  NULL,
  NULL,
  NULL,
  datetime('now'),
  NULL
FROM events e
JOIN checklist_definitions cd ON cd.field_key IN (
  'installment_1_received',
  'installment_2_received',
  'installment_3_received',
  'installment_4_received',
  'installment_5_received'
)
WHERE e.is_archived = 0
  AND NOT EXISTS (
    SELECT 1 FROM checklist_items ci
    WHERE ci.event_id = e.id AND ci.field_key = cd.field_key
  );
