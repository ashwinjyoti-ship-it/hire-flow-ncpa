-- Remove Operations Timings (AC lives only on the event form).
-- Restructure OnStage: Required gate, Emailer sub-pipeline, Monthly Chart out.

-- 1) Drop Operations Timings checklist rows
DELETE FROM checklist_items
WHERE field_key IN ('timings_with_ac', 'ac_hours', 'timings_without_ac', 'non_ac_hours');

DELETE FROM checklist_definitions
WHERE field_key IN ('timings_with_ac', 'ac_hours', 'timings_without_ac', 'non_ac_hours');

-- 2) OnStage Required? gate (default Required so existing pipelines stay visible)
INSERT INTO checklist_definitions (
  id, module, section, field_key, label, field_type, options, default_value,
  vfh_only, is_computed, triggers_task, visibility_rule, sort_order, created_at
)
SELECT
  'cd_operations_onstage_required',
  'operations',
  'OnStage',
  'onstage_required',
  'OnStage Required?',
  'dropdown',
  '["Not Required","Required"]',
  'Required',
  0,
  0,
  NULL,
  NULL,
  COALESCE((SELECT MIN(sort_order) FROM checklist_definitions WHERE section = 'OnStage'), 900) - 1,
  datetime('now')
WHERE NOT EXISTS (
  SELECT 1 FROM checklist_definitions WHERE field_key = 'onstage_required'
);

-- Hide OnStage pipeline unless Required
UPDATE checklist_definitions
SET visibility_rule = 'onlyWhen(onstage_required == Required)'
WHERE field_key IN (
  'onstage_asked_client',
  'onstage_received_from_client',
  'onstage_sent_to_team',
  'onstage_verified',
  'onstage_complete'
);

-- 3) Emailer Yes/No + date sub-fields
INSERT INTO checklist_definitions (
  id, module, section, field_key, label, field_type, options, default_value,
  vfh_only, is_computed, triggers_task, visibility_rule, sort_order, created_at
)
SELECT
  'cd_operations_emailer',
  'operations',
  'OnStage',
  'emailer',
  'Emailer',
  'dropdown',
  '["No","Yes"]',
  'No',
  0,
  0,
  NULL,
  'onlyWhen(onstage_required == Required)',
  COALESCE((SELECT sort_order FROM checklist_definitions WHERE field_key = 'onstage_complete'), 910) + 1,
  datetime('now')
WHERE NOT EXISTS (
  SELECT 1 FROM checklist_definitions WHERE field_key = 'emailer'
);

INSERT INTO checklist_definitions (
  id, module, section, field_key, label, field_type, options, default_value,
  vfh_only, is_computed, triggers_task, visibility_rule, sort_order, created_at
)
SELECT
  'cd_operations_emailer_asked_client',
  'operations',
  'OnStage',
  'emailer_asked_client',
  'Emailer — Asked Client',
  'date',
  NULL,
  NULL,
  0,
  0,
  NULL,
  'onlyWhen(emailer == Yes)',
  COALESCE((SELECT sort_order FROM checklist_definitions WHERE field_key = 'emailer'), 911) + 1,
  datetime('now')
WHERE NOT EXISTS (
  SELECT 1 FROM checklist_definitions WHERE field_key = 'emailer_asked_client'
);

INSERT INTO checklist_definitions (
  id, module, section, field_key, label, field_type, options, default_value,
  vfh_only, is_computed, triggers_task, visibility_rule, sort_order, created_at
)
SELECT
  'cd_operations_emailer_received_from_client',
  'operations',
  'OnStage',
  'emailer_received_from_client',
  'Emailer — Received from Client',
  'date',
  NULL,
  NULL,
  0,
  0,
  NULL,
  'onlyWhen(emailer == Yes)',
  COALESCE((SELECT sort_order FROM checklist_definitions WHERE field_key = 'emailer_asked_client'), 912) + 1,
  datetime('now')
WHERE NOT EXISTS (
  SELECT 1 FROM checklist_definitions WHERE field_key = 'emailer_received_from_client'
);

INSERT INTO checklist_definitions (
  id, module, section, field_key, label, field_type, options, default_value,
  vfh_only, is_computed, triggers_task, visibility_rule, sort_order, created_at
)
SELECT
  'cd_operations_emailer_sent_to_team',
  'operations',
  'OnStage',
  'emailer_sent_to_team',
  'Emailer — Sent to Team',
  'date',
  NULL,
  NULL,
  0,
  0,
  NULL,
  'onlyWhen(emailer == Yes)',
  COALESCE((SELECT sort_order FROM checklist_definitions WHERE field_key = 'emailer_received_from_client'), 913) + 1,
  datetime('now')
WHERE NOT EXISTS (
  SELECT 1 FROM checklist_definitions WHERE field_key = 'emailer_sent_to_team'
);

INSERT INTO checklist_definitions (
  id, module, section, field_key, label, field_type, options, default_value,
  vfh_only, is_computed, triggers_task, visibility_rule, sort_order, created_at
)
SELECT
  'cd_operations_emailer_sent',
  'operations',
  'OnStage',
  'emailer_sent',
  'Emailer — Sent',
  'date',
  NULL,
  NULL,
  0,
  0,
  NULL,
  'onlyWhen(emailer == Yes)',
  COALESCE((SELECT sort_order FROM checklist_definitions WHERE field_key = 'emailer_sent_to_team'), 914) + 1,
  datetime('now')
WHERE NOT EXISTS (
  SELECT 1 FROM checklist_definitions WHERE field_key = 'emailer_sent'
);

-- 4) Move Monthly Chart out of OnStage into its own section
UPDATE checklist_definitions
SET section = 'Monthly Chart',
    sort_order = 920
WHERE field_key = 'monthly_chart_sent';

UPDATE checklist_items
SET section = 'Monthly Chart'
WHERE field_key = 'monthly_chart_sent';

-- 5) Backfill new checklist rows for existing events
INSERT INTO checklist_items (
  id, event_id, definition_id, module, section, field_key, label, status, value,
  due_date, completed_at, completed_by, last_updated_at, last_updated_by
)
SELECT
  'cli_' || lower(hex(randomblob(8))),
  e.id,
  cd.id,
  cd.module,
  cd.section,
  cd.field_key,
  cd.label,
  CASE
    WHEN cd.field_key = 'onstage_required' THEN 'in_progress'
    WHEN cd.field_key = 'emailer' THEN 'not_started'
    ELSE 'not_applicable'
  END,
  CASE
    WHEN cd.field_key = 'onstage_required' THEN 'Required'
    WHEN cd.field_key = 'emailer' THEN 'No'
    ELSE NULL
  END,
  NULL,
  NULL,
  NULL,
  datetime('now'),
  NULL
FROM events e
CROSS JOIN checklist_definitions cd
WHERE cd.field_key IN (
  'onstage_required',
  'emailer',
  'emailer_asked_client',
  'emailer_received_from_client',
  'emailer_sent_to_team',
  'emailer_sent'
)
  AND NOT EXISTS (
    SELECT 1 FROM checklist_items ci
    WHERE ci.event_id = e.id AND ci.field_key = cd.field_key
  );

-- Emailer dates start N/A because Emailer defaults to No
UPDATE checklist_items
SET status = 'not_applicable', last_updated_at = datetime('now')
WHERE field_key IN (
  'emailer_asked_client',
  'emailer_received_from_client',
  'emailer_sent_to_team',
  'emailer_sent'
)
  AND status != 'not_applicable'
  AND event_id IN (
    SELECT event_id FROM checklist_items
    WHERE field_key = 'emailer'
      AND LOWER(TRIM(COALESCE(value, ''))) != 'yes'
  );
