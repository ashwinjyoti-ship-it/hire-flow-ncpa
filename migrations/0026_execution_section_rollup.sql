-- Replace granular req_* checklist rows with six section-level Event Requirements rows.

DELETE FROM checklist_items
WHERE field_key LIKE 'req_%' AND module = 'operations';

DELETE FROM checklist_definitions
WHERE field_key LIKE 'req_%' AND module = 'operations';

INSERT INTO checklist_definitions (
  id, module, section, field_key, label, field_type, options, default_value,
  vfh_only, is_computed, triggers_task, visibility_rule, sort_order, created_at
)
SELECT
  'cd_operations_exec_sound_light', 'operations', 'Event Requirements', 'exec_sound_light', 'Sound & Light', 'dropdown',
  '["Not started","Captured on form","Verified","Not applicable"]', 'Not started',
  0, 0, NULL, NULL, 800, datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM checklist_definitions WHERE field_key = 'exec_sound_light');

INSERT INTO checklist_definitions (
  id, module, section, field_key, label, field_type, options, default_value,
  vfh_only, is_computed, triggers_task, visibility_rule, sort_order, created_at
)
SELECT
  'cd_operations_exec_staffing', 'operations', 'Event Requirements', 'exec_staffing', 'Staffing & Facilities', 'dropdown',
  '["Not started","Captured on form","Verified","Not applicable"]', 'Not started',
  0, 0, NULL, NULL, 801, datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM checklist_definitions WHERE field_key = 'exec_staffing');

INSERT INTO checklist_definitions (
  id, module, section, field_key, label, field_type, options, default_value,
  vfh_only, is_computed, triggers_task, visibility_rule, sort_order, created_at
)
SELECT
  'cd_operations_exec_recording_special', 'operations', 'Event Requirements', 'exec_recording_special', 'Recording & Special', 'dropdown',
  '["Not started","Captured on form","Verified","Not applicable"]', 'Not started',
  0, 0, NULL, NULL, 802, datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM checklist_definitions WHERE field_key = 'exec_recording_special');

INSERT INTO checklist_definitions (
  id, module, section, field_key, label, field_type, options, default_value,
  vfh_only, is_computed, triggers_task, visibility_rule, sort_order, created_at
)
SELECT
  'cd_operations_exec_catering_decorator', 'operations', 'Event Requirements', 'exec_catering_decorator', 'Catering / Decorator', 'dropdown',
  '["Not started","Captured on form","Verified","Not applicable"]', 'Not started',
  0, 0, NULL, NULL, 803, datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM checklist_definitions WHERE field_key = 'exec_catering_decorator');

INSERT INTO checklist_definitions (
  id, module, section, field_key, label, field_type, options, default_value,
  vfh_only, is_computed, triggers_task, visibility_rule, sort_order, created_at
)
SELECT
  'cd_operations_exec_operations', 'operations', 'Event Requirements', 'exec_operations', 'Operations', 'dropdown',
  '["Not started","Captured on form","Verified","Not applicable"]', 'Not started',
  0, 0, NULL, NULL, 804, datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM checklist_definitions WHERE field_key = 'exec_operations');

INSERT INTO checklist_definitions (
  id, module, section, field_key, label, field_type, options, default_value,
  vfh_only, is_computed, triggers_task, visibility_rule, sort_order, created_at
)
SELECT
  'cd_operations_exec_additional', 'operations', 'Event Requirements', 'exec_additional', 'Additional Requirements', 'dropdown',
  '["Not started","Captured on form","Verified","Not applicable"]', 'Not started',
  0, 0, NULL, NULL, 805, datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM checklist_definitions WHERE field_key = 'exec_additional');
