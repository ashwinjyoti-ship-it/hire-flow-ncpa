-- Reopen POC tasks that were auto-cancelled when events moved into event prep / confirmed.
UPDATE tasks
SET status = 'open',
    completion_note = NULL,
    completed_at = NULL,
    updated_at = datetime('now')
WHERE source_rule = 'poc_incomplete'
  AND status = 'cancelled'
  AND EXISTS (
    SELECT 1
    FROM events e
    WHERE e.id = tasks.event_id
      AND e.is_archived = 0
      AND e.status NOT IN ('cancelled', 'regret')
  );
