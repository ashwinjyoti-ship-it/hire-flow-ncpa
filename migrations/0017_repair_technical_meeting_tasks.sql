-- Keep existing technical-meeting tasks aligned with their checklist source.
UPDATE tasks
SET due_date = (
      SELECT ci.due_date
      FROM checklist_items ci
      WHERE ci.id = tasks.source_checklist_item_id
    ),
    updated_at = datetime('now')
WHERE source_rule = 'technical_meeting'
  AND source_checklist_item_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM checklist_items ci
    WHERE ci.id = tasks.source_checklist_item_id
      AND ci.due_date IS NOT NULL
      AND ci.due_date != tasks.due_date
  );

-- Minutes recorded means the meeting work is complete; close stale open tasks.
UPDATE tasks
SET status = 'completed',
    completion_note = COALESCE(completion_note, 'Completed automatically because Minutes of Meeting is Yes.'),
    completed_at = COALESCE(completed_at, datetime('now')),
    updated_at = datetime('now')
WHERE source_rule = 'technical_meeting'
  AND status IN ('open', 'in_progress')
  AND EXISTS (
    SELECT 1
    FROM checklist_items ci
    WHERE ci.event_id = tasks.event_id
      AND ci.field_key = 'minutes_of_meeting'
      AND lower(trim(COALESCE(ci.value, ''))) = 'yes'
  );
