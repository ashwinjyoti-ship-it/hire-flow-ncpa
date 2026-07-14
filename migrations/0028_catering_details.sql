-- Catering ops: replace tier / type / pax with a single Catering Details status field.

DELETE FROM checklist_items
WHERE field_key IN ('caterer_tier', 'type_of_catering', 'no_of_pax');

DELETE FROM checklist_definitions
WHERE field_key IN ('caterer_tier', 'type_of_catering', 'no_of_pax');

INSERT INTO checklist_definitions (
  id, module, section, field_key, label, field_type, options, default_value,
  vfh_only, is_computed, triggers_task, visibility_rule, sort_order, created_at
)
SELECT
  'cd_operations_catering_details',
  'operations',
  'Catering',
  'catering_details',
  'Catering Details',
  'dropdown',
  '["Not Received","Received"]',
  'Received',
  0,
  0,
  NULL,
  NULL,
  COALESCE((SELECT sort_order FROM checklist_definitions WHERE field_key = 'caterer_name'), 900) + 1,
  datetime('now')
WHERE NOT EXISTS (
  SELECT 1 FROM checklist_definitions WHERE field_key = 'catering_details'
);

-- Backfill the new row for existing events.
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
  'completed',
  'Received',
  NULL,
  datetime('now'),
  NULL,
  datetime('now'),
  NULL
FROM events e
CROSS JOIN checklist_definitions cd
WHERE cd.field_key = 'catering_details'
  AND NOT EXISTS (
    SELECT 1 FROM checklist_items ci
    WHERE ci.event_id = e.id AND ci.field_key = 'catering_details'
  );
