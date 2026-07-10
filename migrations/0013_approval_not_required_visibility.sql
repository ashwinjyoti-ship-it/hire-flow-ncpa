-- When Approval Required? = Not Required on VFH events, skip the rest of the
-- Approval checklist: hide dependent fields and mark them not_applicable.
--
-- Visibility mirrors the instalment pattern:
--   onlyWhen(approval_required == Required)

UPDATE checklist_definitions
SET visibility_rule = 'onlyWhen(approval_required == Required)'
WHERE field_key IN ('approval_sent_on', 'approval_received_on', 'genre_head');

-- Backfill existing events that already have Approval Required? = Not Required.
UPDATE checklist_items
SET status = 'not_applicable'
WHERE field_key IN ('approval_sent_on', 'approval_received_on', 'genre_head')
  AND event_id IN (
    SELECT event_id
    FROM checklist_items
    WHERE field_key = 'approval_required'
      AND LOWER(TRIM(COALESCE(value, ''))) = 'not required'
  );
