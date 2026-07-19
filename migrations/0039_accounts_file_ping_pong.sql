-- Accounts file tracking: date-based ping-pong with automatic follow-up / send-back tasks.

-- 1. Convert Edit 1 / Edit 2 / Final from dropdowns to dates; add sent-back date fields.
UPDATE checklist_definitions
SET field_type = 'date',
    options = NULL,
    default_value = NULL,
    triggers_task = '{"rule":"accounts_file_send_back","title":"Send file back to Accounts","due_after_days":3,"complete_when":"Sent back after Edit 1 or final file received"}'
WHERE field_key = 'file_received_back_edit_1';

UPDATE checklist_definitions
SET field_type = 'date',
    options = NULL,
    default_value = NULL,
    triggers_task = '{"rule":"accounts_file_send_back","title":"Send file back to Accounts","due_after_days":3,"complete_when":"Sent back after Edit 2 or final file received"}'
WHERE field_key = 'file_received_back_edit_2';

UPDATE checklist_definitions
SET field_type = 'date',
    options = NULL,
    default_value = NULL,
    triggers_task = NULL
WHERE field_key = 'final_file_received';

UPDATE checklist_definitions
SET triggers_task = '{"rule":"accounts_file","title":"Follow up with Accounts","due_after_days":3,"complete_when":"Edit 1 or final file received"}'
WHERE field_key = 'file_sent_to_accounts';

UPDATE checklist_definitions
SET label = 'File Received Back — Edit 1 — Date'
WHERE field_key = 'file_received_back_edit_1';

UPDATE checklist_definitions
SET label = 'File Received Back — Edit 2 — Date'
WHERE field_key = 'file_received_back_edit_2';

UPDATE checklist_definitions
SET label = 'Final File Received — Date'
WHERE field_key = 'final_file_received';

INSERT INTO checklist_definitions (
  id, module, section, field_key, label, field_type, options, default_value,
  vfh_only, is_computed, triggers_task, visibility_rule, sort_order, created_at
)
SELECT
  'cd_accounts_file_sent_back_after_edit_1',
  'accounts',
  'File Tracking',
  'file_sent_back_after_edit_1',
  'File Sent Back After Edit 1 — Date',
  'date',
  NULL,
  NULL,
  0,
  0,
  '{"rule":"accounts_file","title":"Follow up with Accounts","due_after_days":3,"complete_when":"Edit 2 or final file received"}',
  NULL,
  COALESCE((SELECT sort_order FROM checklist_definitions WHERE field_key = 'file_received_back_edit_1'), 0) + 1,
  datetime('now')
WHERE NOT EXISTS (
  SELECT 1 FROM checklist_definitions WHERE field_key = 'file_sent_back_after_edit_1'
);

INSERT INTO checklist_definitions (
  id, module, section, field_key, label, field_type, options, default_value,
  vfh_only, is_computed, triggers_task, visibility_rule, sort_order, created_at
)
SELECT
  'cd_accounts_file_sent_back_after_edit_2',
  'accounts',
  'File Tracking',
  'file_sent_back_after_edit_2',
  'File Sent Back After Edit 2 — Date',
  'date',
  NULL,
  NULL,
  0,
  0,
  '{"rule":"accounts_file","title":"Follow up with Accounts","due_after_days":3,"complete_when":"Final file received"}',
  NULL,
  COALESCE((SELECT sort_order FROM checklist_definitions WHERE field_key = 'file_received_back_edit_2'), 0) + 1,
  datetime('now')
WHERE NOT EXISTS (
  SELECT 1 FROM checklist_definitions WHERE field_key = 'file_sent_back_after_edit_2'
);

-- Keep File Tracking field order: sent → edit1 → sent back 1 → edit2 → sent back 2 → final.
UPDATE checklist_definitions SET sort_order = COALESCE((SELECT sort_order FROM checklist_definitions WHERE field_key = 'file_sent_to_accounts'), 100) + 1
WHERE field_key = 'file_received_back_edit_1';
UPDATE checklist_definitions SET sort_order = COALESCE((SELECT sort_order FROM checklist_definitions WHERE field_key = 'file_sent_to_accounts'), 100) + 2
WHERE field_key = 'file_sent_back_after_edit_1';
UPDATE checklist_definitions SET sort_order = COALESCE((SELECT sort_order FROM checklist_definitions WHERE field_key = 'file_sent_to_accounts'), 100) + 3
WHERE field_key = 'file_received_back_edit_2';
UPDATE checklist_definitions SET sort_order = COALESCE((SELECT sort_order FROM checklist_definitions WHERE field_key = 'file_sent_to_accounts'), 100) + 4
WHERE field_key = 'file_sent_back_after_edit_2';
UPDATE checklist_definitions SET sort_order = COALESCE((SELECT sort_order FROM checklist_definitions WHERE field_key = 'file_sent_to_accounts'), 100) + 5
WHERE field_key = 'final_file_received';

-- 2. Drop legacy dropdown values on converted fields.
UPDATE checklist_items
SET value = NULL,
    status = 'not_started',
    due_date = NULL,
    completed_at = NULL,
    completed_by = NULL,
    last_updated_at = datetime('now')
WHERE field_key IN ('file_received_back_edit_1', 'file_received_back_edit_2', 'final_file_received')
  AND (
    lower(trim(value)) IN ('pending', 'received', 'yes', 'no')
    OR value IS NULL
  );

-- 3. Backfill sent-back date rows for existing events (lazy-created on next checklist load otherwise).
INSERT INTO checklist_items (
  id, event_id, definition_id, module, section, field_key, label, status, value, due_date,
  completed_at, completed_by, last_updated_at, last_updated_by
)
SELECT
  'cli_' || substr(e.id, 4) || '_fsbae1',
  e.id,
  cd.id,
  cd.module,
  cd.section,
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
JOIN checklist_definitions cd ON cd.field_key = 'file_sent_back_after_edit_1'
WHERE NOT EXISTS (
  SELECT 1 FROM checklist_items ci
  WHERE ci.event_id = e.id AND ci.field_key = 'file_sent_back_after_edit_1'
);

INSERT INTO checklist_items (
  id, event_id, definition_id, module, section, field_key, label, status, value, due_date,
  completed_at, completed_by, last_updated_at, last_updated_by
)
SELECT
  'cli_' || substr(e.id, 4) || '_fsbae2',
  e.id,
  cd.id,
  cd.module,
  cd.section,
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
JOIN checklist_definitions cd ON cd.field_key = 'file_sent_back_after_edit_2'
WHERE NOT EXISTS (
  SELECT 1 FROM checklist_items ci
  WHERE ci.event_id = e.id AND ci.field_key = 'file_sent_back_after_edit_2'
);
