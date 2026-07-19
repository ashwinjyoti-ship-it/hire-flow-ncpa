-- Completion rollups were counting not_applicable checklist items as "done",
-- inflating Accounts (and Operations) percentages before any real work started.
-- Only applicable items belong in the denominator; only completed items count
-- as done.

-- Heal instalment date rows that were left active while Instalment = No.
UPDATE checklist_items
SET status = 'not_applicable',
    due_date = NULL,
    completed_at = NULL,
    completed_by = NULL,
    last_updated_at = datetime('now')
WHERE field_key IN (
      'installment_1_expected_date',
      'installment_2_expected_date',
      'installment_3_expected_date',
      'installment_4_expected_date',
      'installment_5_expected_date'
    )
  AND event_id IN (
    SELECT event_id
    FROM checklist_items
    WHERE field_key = 'instalment'
      AND lower(trim(COALESCE(value, ''))) != 'yes'
  )
  AND status != 'not_applicable';

UPDATE events
SET ops_completion = COALESCE((
      SELECT 1.0 * SUM(CASE WHEN ci.status = 'completed' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0)
      FROM checklist_items ci JOIN checklist_definitions cd ON cd.id = ci.definition_id
      WHERE ci.event_id = events.id AND ci.module = 'operations' AND ci.field_key != 'event_status' AND cd.is_computed = 0
        AND ci.status != 'not_applicable'
        AND NOT (ci.due_date > date('now') AND ci.status != 'completed')
    ), 0),
    accounts_completion = COALESCE((
      SELECT 1.0 * SUM(CASE WHEN ci.status = 'completed' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0)
      FROM checklist_items ci JOIN checklist_definitions cd ON cd.id = ci.definition_id
      WHERE ci.event_id = events.id AND ci.module = 'accounts' AND ci.field_key != 'event_status' AND cd.is_computed = 0
        AND ci.status != 'not_applicable'
        AND NOT (ci.due_date > date('now') AND ci.status != 'completed')
    ), 0),
    overall_completion = COALESCE((
      SELECT 1.0 * SUM(CASE WHEN ci.status = 'completed' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0)
      FROM checklist_items ci JOIN checklist_definitions cd ON cd.id = ci.definition_id
      WHERE ci.event_id = events.id AND ci.field_key != 'event_status' AND cd.is_computed = 0
        AND ci.status != 'not_applicable'
        AND NOT (ci.due_date > date('now') AND ci.status != 'completed')
    ), 0);
