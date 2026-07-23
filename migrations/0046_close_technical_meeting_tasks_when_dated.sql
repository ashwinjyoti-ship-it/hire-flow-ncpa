-- Technical meeting date is the scheduling action; close stale open tasks once it is set.
UPDATE tasks
SET status = 'completed',
    completed_at = COALESCE(completed_at, datetime('now')),
    completion_note = COALESCE(completion_note, 'Completed automatically because Technical Meeting Date is set.'),
    updated_at = datetime('now')
WHERE source_rule = 'technical_meeting'
  AND status IN ('open', 'in_progress')
  AND EXISTS (
    SELECT 1
    FROM checklist_items ci
    WHERE ci.event_id = tasks.event_id
      AND ci.field_key = 'technical_meeting_date'
      AND trim(COALESCE(ci.value, '')) != ''
  );
