-- NOC: replace computed noc_status with Yes/No dropdown + conditional date sent.
INSERT INTO checklist_definitions (
  id, module, section, field_key, label, field_type, options, default_value,
  vfh_only, is_computed, triggers_task, visibility_rule, sort_order, created_at
)
SELECT
  'cd_operations_noc_sent',
  'operations',
  'NOC',
  'noc_sent',
  'NOC Sent?',
  'dropdown',
  '["No","Yes"]',
  'No',
  0,
  0,
  NULL,
  NULL,
  COALESCE((SELECT sort_order FROM checklist_definitions WHERE field_key = 'noc_sent_on'), 0),
  datetime('now')
WHERE NOT EXISTS (
  SELECT 1 FROM checklist_definitions WHERE module = 'operations' AND field_key = 'noc_sent'
);

UPDATE checklist_definitions
SET label = 'Date Sent',
    visibility_rule = 'onlyWhen(noc_sent == Yes)'
WHERE module = 'operations' AND field_key = 'noc_sent_on';

-- Backfill noc_sent from legacy date-only rows before removing computed status.
INSERT INTO checklist_items (
  id, event_id, definition_id, module, section, field_key, label, status, value,
  due_date, completed_at, completed_by, last_updated_at, last_updated_by
)
SELECT
  'cli_' || lower(hex(randomblob(8))),
  ci.event_id,
  (SELECT id FROM checklist_definitions WHERE field_key = 'noc_sent'),
  'operations',
  'NOC',
  'noc_sent',
  'NOC Sent?',
  CASE WHEN noc_date.value IS NOT NULL AND TRIM(noc_date.value) != '' THEN 'completed' ELSE 'not_started' END,
  CASE WHEN noc_date.value IS NOT NULL AND TRIM(noc_date.value) != '' THEN 'Yes' ELSE 'No' END,
  NULL,
  CASE WHEN noc_date.value IS NOT NULL AND TRIM(noc_date.value) != '' THEN datetime('now') ELSE NULL END,
  NULL,
  datetime('now'),
  NULL
FROM checklist_items noc_date
WHERE noc_date.field_key = 'noc_sent_on'
  AND NOT EXISTS (
    SELECT 1 FROM checklist_items existing
    WHERE existing.event_id = noc_date.event_id AND existing.field_key = 'noc_sent'
  );

UPDATE checklist_items
SET value = 'Yes', status = 'completed', completed_at = COALESCE(completed_at, datetime('now'))
WHERE field_key = 'noc_sent'
  AND event_id IN (
    SELECT event_id FROM checklist_items
    WHERE field_key = 'noc_sent_on' AND value IS NOT NULL AND TRIM(value) != ''
  )
  AND (value IS NULL OR TRIM(value) = '' OR value = 'No');

UPDATE checklist_items
SET status = 'not_applicable', value = NULL, due_date = NULL, completed_at = NULL, completed_by = NULL
WHERE field_key = 'noc_sent_on'
  AND event_id IN (
    SELECT event_id FROM checklist_items
    WHERE field_key = 'noc_sent' AND (value IS NULL OR TRIM(value) = '' OR lower(value) = 'no')
  );

DELETE FROM checklist_items WHERE field_key = 'noc_status';
DELETE FROM checklist_definitions WHERE field_key = 'noc_status';

-- Event execution requirements synced from the event form.
INSERT INTO checklist_definitions (
  id, module, section, field_key, label, field_type, options, default_value,
  vfh_only, is_computed, triggers_task, visibility_rule, sort_order, created_at
)
SELECT * FROM (
  SELECT 'cd_operations_req_light', 'operations', 'Additional Requirements', 'req_light', 'Light', 'dropdown', '["Not Required","Required"]', 'Not Required', 0, 0, NULL, NULL, (SELECT sort_order FROM checklist_definitions WHERE field_key = 'req_sound') + 1, datetime('now')
  UNION ALL SELECT 'cd_operations_req_green_rooms', 'operations', 'Additional Requirements', 'req_green_rooms', 'Green Rooms', 'dropdown', '["Not Required","Required"]', 'Not Required', 0, 0, NULL, NULL, (SELECT sort_order FROM checklist_definitions WHERE field_key = 'req_telecasting_media') + 1, datetime('now')
  UNION ALL SELECT 'cd_operations_req_ushers', 'operations', 'Additional Requirements', 'req_ushers', 'Ushers', 'dropdown', '["Not Required","Required"]', 'Not Required', 0, 0, NULL, NULL, (SELECT sort_order FROM checklist_definitions WHERE field_key = 'req_telecasting_media') + 2, datetime('now')
  UNION ALL SELECT 'cd_operations_req_loaders', 'operations', 'Additional Requirements', 'req_loaders', 'Loaders', 'dropdown', '["Not Required","Required"]', 'Not Required', 0, 0, NULL, NULL, (SELECT sort_order FROM checklist_definitions WHERE field_key = 'req_telecasting_media') + 3, datetime('now')
  UNION ALL SELECT 'cd_operations_req_video_recording', 'operations', 'Additional Requirements', 'req_video_recording', 'Video Recording', 'dropdown', '["Not Required","Required"]', 'Not Required', 0, 0, NULL, NULL, (SELECT sort_order FROM checklist_definitions WHERE field_key = 'req_telecasting_media') + 4, datetime('now')
  UNION ALL SELECT 'cd_operations_req_catering', 'operations', 'Additional Requirements', 'req_catering', 'Catering', 'dropdown', '["Not Required","Required"]', 'Not Required', 0, 0, NULL, NULL, (SELECT sort_order FROM checklist_definitions WHERE field_key = 'req_telecasting_media') + 5, datetime('now')
  UNION ALL SELECT 'cd_operations_req_decorator', 'operations', 'Additional Requirements', 'req_decorator', 'Decorator', 'dropdown', '["Not Required","Required"]', 'Not Required', 0, 0, NULL, NULL, (SELECT sort_order FROM checklist_definitions WHERE field_key = 'req_telecasting_media') + 6, datetime('now')
  UNION ALL SELECT 'cd_operations_req_parking', 'operations', 'Additional Requirements', 'req_parking', 'Parking', 'dropdown', '["Not Required","Required"]', 'Not Required', 0, 0, NULL, NULL, (SELECT sort_order FROM checklist_definitions WHERE field_key = 'req_telecasting_media') + 7, datetime('now')
  UNION ALL SELECT 'cd_operations_req_security', 'operations', 'Additional Requirements', 'req_security', 'Security', 'dropdown', '["Not Required","Required"]', 'Not Required', 0, 0, NULL, NULL, (SELECT sort_order FROM checklist_definitions WHERE field_key = 'req_telecasting_media') + 8, datetime('now')
  UNION ALL SELECT 'cd_operations_req_housekeeping', 'operations', 'Additional Requirements', 'req_housekeeping', 'Housekeeping', 'dropdown', '["Not Required","Required"]', 'Not Required', 0, 0, NULL, NULL, (SELECT sort_order FROM checklist_definitions WHERE field_key = 'req_telecasting_media') + 9, datetime('now')
  UNION ALL SELECT 'cd_operations_req_stage_setup', 'operations', 'Additional Requirements', 'req_stage_setup', 'Stage Setup', 'dropdown', '["Not Required","Required"]', 'Not Required', 0, 0, NULL, NULL, (SELECT sort_order FROM checklist_definitions WHERE field_key = 'req_telecasting_media') + 10, datetime('now')
  UNION ALL SELECT 'cd_operations_req_foyer_setup', 'operations', 'Additional Requirements', 'req_foyer_setup', 'Foyer Setup', 'dropdown', '["Not Required","Required"]', 'Not Required', 0, 0, NULL, NULL, (SELECT sort_order FROM checklist_definitions WHERE field_key = 'req_telecasting_media') + 11, datetime('now')
) AS defs(id, module, section, field_key, label, field_type, options, default_value, vfh_only, is_computed, triggers_task, visibility_rule, sort_order, created_at)
WHERE NOT EXISTS (
  SELECT 1 FROM checklist_definitions cd WHERE cd.module = defs.module AND cd.field_key = defs.field_key
);
