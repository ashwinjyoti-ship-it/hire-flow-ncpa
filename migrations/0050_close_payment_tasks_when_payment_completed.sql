-- Heal stale payment follow-up tasks left open after Payment Status was marked Completed.
UPDATE tasks
SET status = 'completed',
    completed_at = COALESCE(completed_at, datetime('now')),
    completion_note = COALESCE(completion_note, 'Completed automatically because Payment Status was marked Completed.'),
    updated_at = datetime('now')
WHERE status IN ('open', 'in_progress')
  AND source_rule IN ('instalment', 'venue_booking_payment_followup')
  AND EXISTS (
    SELECT 1
    FROM checklist_items ci
    WHERE ci.event_id = tasks.event_id
      AND ci.field_key = 'payment_status'
      AND lower(trim(COALESCE(ci.value, ''))) = 'completed'
  );
