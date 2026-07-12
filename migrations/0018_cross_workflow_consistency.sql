-- Normalize legacy DD-Mmm-YYYY dates so reminders, analytics, and reports all
-- compare the same ISO YYYY-MM-DD values used by the application.
-- Avoid stacked GLOB character classes — D1 rejects them with
-- "LIKE or GLOB pattern too complex" (SQLITE_ERROR 7500).
UPDATE events SET event_start_date = substr(event_start_date, 8, 4) || '-' ||
  CASE lower(substr(event_start_date, 4, 3)) WHEN 'jan' THEN '01' WHEN 'feb' THEN '02' WHEN 'mar' THEN '03' WHEN 'apr' THEN '04' WHEN 'may' THEN '05' WHEN 'jun' THEN '06' WHEN 'jul' THEN '07' WHEN 'aug' THEN '08' WHEN 'sep' THEN '09' WHEN 'oct' THEN '10' WHEN 'nov' THEN '11' WHEN 'dec' THEN '12' END || '-' || substr(event_start_date, 1, 2)
WHERE length(event_start_date) = 11
  AND substr(event_start_date, 3, 1) = '-'
  AND substr(event_start_date, 7, 1) = '-'
  AND CAST(substr(event_start_date, 1, 2) AS INTEGER) BETWEEN 1 AND 31
  AND CAST(substr(event_start_date, 8, 4) AS INTEGER) BETWEEN 1900 AND 2100
  AND lower(substr(event_start_date, 4, 3)) IN ('jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec');

UPDATE events SET event_end_date = substr(event_end_date, 8, 4) || '-' ||
  CASE lower(substr(event_end_date, 4, 3)) WHEN 'jan' THEN '01' WHEN 'feb' THEN '02' WHEN 'mar' THEN '03' WHEN 'apr' THEN '04' WHEN 'may' THEN '05' WHEN 'jun' THEN '06' WHEN 'jul' THEN '07' WHEN 'aug' THEN '08' WHEN 'sep' THEN '09' WHEN 'oct' THEN '10' WHEN 'nov' THEN '11' WHEN 'dec' THEN '12' END || '-' || substr(event_end_date, 1, 2)
WHERE length(event_end_date) = 11
  AND substr(event_end_date, 3, 1) = '-'
  AND substr(event_end_date, 7, 1) = '-'
  AND CAST(substr(event_end_date, 1, 2) AS INTEGER) BETWEEN 1 AND 31
  AND CAST(substr(event_end_date, 8, 4) AS INTEGER) BETWEEN 1900 AND 2100
  AND lower(substr(event_end_date, 4, 3)) IN ('jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec');

UPDATE schedule_entries SET activity_date = substr(activity_date, 8, 4) || '-' ||
  CASE lower(substr(activity_date, 4, 3)) WHEN 'jan' THEN '01' WHEN 'feb' THEN '02' WHEN 'mar' THEN '03' WHEN 'apr' THEN '04' WHEN 'may' THEN '05' WHEN 'jun' THEN '06' WHEN 'jul' THEN '07' WHEN 'aug' THEN '08' WHEN 'sep' THEN '09' WHEN 'oct' THEN '10' WHEN 'nov' THEN '11' WHEN 'dec' THEN '12' END || '-' || substr(activity_date, 1, 2)
WHERE length(activity_date) = 11
  AND substr(activity_date, 3, 1) = '-'
  AND substr(activity_date, 7, 1) = '-'
  AND CAST(substr(activity_date, 1, 2) AS INTEGER) BETWEEN 1 AND 31
  AND CAST(substr(activity_date, 8, 4) AS INTEGER) BETWEEN 1900 AND 2100
  AND lower(substr(activity_date, 4, 3)) IN ('jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec');

UPDATE checklist_items SET value = substr(value, 8, 4) || '-' ||
  CASE lower(substr(value, 4, 3)) WHEN 'jan' THEN '01' WHEN 'feb' THEN '02' WHEN 'mar' THEN '03' WHEN 'apr' THEN '04' WHEN 'may' THEN '05' WHEN 'jun' THEN '06' WHEN 'jul' THEN '07' WHEN 'aug' THEN '08' WHEN 'sep' THEN '09' WHEN 'oct' THEN '10' WHEN 'nov' THEN '11' WHEN 'dec' THEN '12' END || '-' || substr(value, 1, 2)
WHERE length(value) = 11
  AND substr(value, 3, 1) = '-'
  AND substr(value, 7, 1) = '-'
  AND CAST(substr(value, 1, 2) AS INTEGER) BETWEEN 1 AND 31
  AND CAST(substr(value, 8, 4) AS INTEGER) BETWEEN 1900 AND 2100
  AND lower(substr(value, 4, 3)) IN ('jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec');

UPDATE checklist_items SET due_date = substr(due_date, 8, 4) || '-' ||
  CASE lower(substr(due_date, 4, 3)) WHEN 'jan' THEN '01' WHEN 'feb' THEN '02' WHEN 'mar' THEN '03' WHEN 'apr' THEN '04' WHEN 'may' THEN '05' WHEN 'jun' THEN '06' WHEN 'jul' THEN '07' WHEN 'aug' THEN '08' WHEN 'sep' THEN '09' WHEN 'oct' THEN '10' WHEN 'nov' THEN '11' WHEN 'dec' THEN '12' END || '-' || substr(due_date, 1, 2)
WHERE length(due_date) = 11
  AND substr(due_date, 3, 1) = '-'
  AND substr(due_date, 7, 1) = '-'
  AND CAST(substr(due_date, 1, 2) AS INTEGER) BETWEEN 1 AND 31
  AND CAST(substr(due_date, 8, 4) AS INTEGER) BETWEEN 1900 AND 2100
  AND lower(substr(due_date, 4, 3)) IN ('jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec');

UPDATE tasks SET due_date = substr(due_date, 8, 4) || '-' ||
  CASE lower(substr(due_date, 4, 3)) WHEN 'jan' THEN '01' WHEN 'feb' THEN '02' WHEN 'mar' THEN '03' WHEN 'apr' THEN '04' WHEN 'may' THEN '05' WHEN 'jun' THEN '06' WHEN 'jul' THEN '07' WHEN 'aug' THEN '08' WHEN 'sep' THEN '09' WHEN 'oct' THEN '10' WHEN 'nov' THEN '11' WHEN 'dec' THEN '12' END || '-' || substr(due_date, 1, 2)
WHERE length(due_date) = 11
  AND substr(due_date, 3, 1) = '-'
  AND substr(due_date, 7, 1) = '-'
  AND CAST(substr(due_date, 1, 2) AS INTEGER) BETWEEN 1 AND 31
  AND CAST(substr(due_date, 8, 4) AS INTEGER) BETWEEN 1900 AND 2100
  AND lower(substr(due_date, 4, 3)) IN ('jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec');

-- A scheduled future date is in progress; it becomes complete once reached.
UPDATE checklist_items
SET status = CASE WHEN due_date <= date('now') THEN 'completed' ELSE 'in_progress' END,
    completed_at = CASE WHEN due_date <= date('now') THEN COALESCE(completed_at, datetime('now')) ELSE NULL END,
    completed_by = CASE WHEN due_date <= date('now') THEN completed_by ELSE NULL END,
    last_updated_at = datetime('now')
WHERE due_date IS NOT NULL
  AND definition_id IN (SELECT id FROM checklist_definitions WHERE field_type = 'date');

-- Terminal events must not continue surfacing actionable work.
UPDATE tasks
SET status = 'cancelled',
    completion_note = 'Cancelled automatically because event became terminal.',
    completed_at = NULL,
    completed_by = NULL,
    updated_at = datetime('now')
WHERE status IN ('open', 'in_progress')
  AND event_id IN (SELECT id FROM events WHERE status IN ('cancelled', 'regret'));

-- Open automatic work follows the event owner.
UPDATE tasks
SET assignee_id = (SELECT e.event_owner_id FROM events e WHERE e.id = tasks.event_id),
    updated_at = datetime('now')
WHERE task_type = 'automatic' AND status IN ('open', 'in_progress') AND event_id IS NOT NULL;

-- Recalculate cached readiness immediately after date-status repairs.
UPDATE events
SET ops_completion = COALESCE((
      SELECT 1.0 * SUM(CASE WHEN ci.status IN ('completed','not_applicable') THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0)
      FROM checklist_items ci JOIN checklist_definitions cd ON cd.id = ci.definition_id
      WHERE ci.event_id = events.id AND ci.module = 'operations' AND ci.field_key != 'event_status' AND cd.is_computed = 0
        AND NOT (ci.due_date > date('now') AND ci.status != 'completed')
    ), 0),
    accounts_completion = COALESCE((
      SELECT 1.0 * SUM(CASE WHEN ci.status IN ('completed','not_applicable') THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0)
      FROM checklist_items ci JOIN checklist_definitions cd ON cd.id = ci.definition_id
      WHERE ci.event_id = events.id AND ci.module = 'accounts' AND ci.field_key != 'event_status' AND cd.is_computed = 0
        AND NOT (ci.due_date > date('now') AND ci.status != 'completed')
    ), 0),
    overall_completion = COALESCE((
      SELECT 1.0 * SUM(CASE WHEN ci.status IN ('completed','not_applicable') THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0)
      FROM checklist_items ci JOIN checklist_definitions cd ON cd.id = ci.definition_id
      WHERE ci.event_id = events.id AND ci.field_key != 'event_status' AND cd.is_computed = 0
        AND NOT (ci.due_date > date('now') AND ci.status != 'completed')
    ), 0);
