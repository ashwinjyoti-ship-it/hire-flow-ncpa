-- Close File: final Accounts-phase action to close the venue hire file.

INSERT INTO checklist_definitions (
  id, module, section, field_key, label, field_type, options, default_value,
  vfh_only, is_computed, triggers_task, visibility_rule, sort_order, created_at
)
SELECT
  'cd_operations_file_closed',
  'operations',
  'Post-Event Closure',
  'file_closed',
  'File Closed',
  'date',
  NULL,
  NULL,
  0,
  0,
  NULL,
  NULL,
  COALESCE((SELECT MAX(sort_order) FROM checklist_definitions WHERE module = 'operations' AND section = 'Post-Event Closure'), 0) + 1,
  datetime('now')
WHERE NOT EXISTS (
  SELECT 1 FROM checklist_definitions WHERE field_key = 'file_closed'
);

-- Backfill the new field onto existing events (idempotent).
INSERT OR IGNORE INTO checklist_items (
  id, event_id, definition_id, module, section, field_key, label, status, value, due_date,
  completed_at, completed_by, last_updated_at, last_updated_by
)
SELECT
  'cli_file_closed_' || e.id,
  e.id,
  cd.id,
  'operations',
  'Post-Event Closure',
  'file_closed',
  'File Closed',
  'not_started',
  NULL,
  NULL,
  NULL,
  NULL,
  datetime('now'),
  NULL
FROM events e
JOIN checklist_definitions cd ON cd.field_key = 'file_closed'
WHERE e.is_archived = 0
  AND NOT EXISTS (
    SELECT 1 FROM checklist_items ci
    WHERE ci.event_id = e.id AND ci.field_key = 'file_closed'
  );
