-- Rename OnStage section to Onstage/Emailer; decouple Emailer from OnStage Required.
-- Order: Onstage/Emailer → Monthly Chart → … → Post-Event Closure (last).

UPDATE checklist_definitions
SET section = 'Onstage/Emailer',
    visibility_rule = NULL
WHERE field_key = 'emailer';

UPDATE checklist_definitions
SET section = 'Onstage/Emailer'
WHERE field_key IN (
  'onstage_required',
  'onstage_asked_client',
  'onstage_received_from_client',
  'onstage_sent_to_team',
  'onstage_verified',
  'onstage_complete',
  'emailer_asked_client',
  'emailer_received_from_client',
  'emailer_sent_to_team',
  'emailer_sent'
);

UPDATE checklist_items
SET section = 'Onstage/Emailer'
WHERE field_key IN (
  'onstage_required',
  'onstage_asked_client',
  'onstage_received_from_client',
  'onstage_sent_to_team',
  'onstage_verified',
  'onstage_complete',
  'emailer',
  'emailer_asked_client',
  'emailer_received_from_client',
  'emailer_sent_to_team',
  'emailer_sent'
);

-- Section order via sort_order (Monthly Chart directly after Onstage/Emailer).
UPDATE checklist_definitions SET sort_order = 901 WHERE field_key = 'onstage_required';
UPDATE checklist_definitions SET sort_order = 902 WHERE field_key = 'onstage_asked_client';
UPDATE checklist_definitions SET sort_order = 903 WHERE field_key = 'onstage_received_from_client';
UPDATE checklist_definitions SET sort_order = 904 WHERE field_key = 'onstage_sent_to_team';
UPDATE checklist_definitions SET sort_order = 905 WHERE field_key = 'onstage_verified';
UPDATE checklist_definitions SET sort_order = 906 WHERE field_key = 'onstage_complete';
UPDATE checklist_definitions SET sort_order = 907 WHERE field_key = 'emailer';
UPDATE checklist_definitions SET sort_order = 908 WHERE field_key = 'emailer_asked_client';
UPDATE checklist_definitions SET sort_order = 909 WHERE field_key = 'emailer_received_from_client';
UPDATE checklist_definitions SET sort_order = 910 WHERE field_key = 'emailer_sent_to_team';
UPDATE checklist_definitions SET sort_order = 911 WHERE field_key = 'emailer_sent';
UPDATE checklist_definitions SET sort_order = 912 WHERE field_key = 'monthly_chart_sent';
UPDATE checklist_definitions SET sort_order = 913 WHERE field_key = 'technical_meeting_date';
UPDATE checklist_definitions SET sort_order = 914 WHERE field_key = 'minutes_of_meeting';
UPDATE checklist_definitions SET sort_order = 920 WHERE field_key = 'no_of_crew_cards';
UPDATE checklist_definitions SET sort_order = 921 WHERE field_key = 'house_seats';
UPDATE checklist_definitions SET sort_order = 922 WHERE field_key = 'licenses_status';
UPDATE checklist_definitions SET sort_order = 923 WHERE field_key = 'licenses';
UPDATE checklist_definitions SET sort_order = 924 WHERE field_key = 'decorator_name';
UPDATE checklist_definitions SET sort_order = 925 WHERE field_key = 'decorator_tier';
UPDATE checklist_definitions SET sort_order = 926 WHERE field_key = 'caterer_name';
UPDATE checklist_definitions SET sort_order = 927 WHERE field_key = 'catering_details';
UPDATE checklist_definitions SET sort_order = 930 WHERE field_key = 'feedback_sent';
UPDATE checklist_definitions SET sort_order = 931 WHERE field_key = 'feedback_received';
UPDATE checklist_definitions SET sort_order = 932 WHERE field_key = 'event_report';
UPDATE checklist_definitions SET sort_order = 933 WHERE field_key = 'box_office_statement';

-- Re-open Emailer rows that were incorrectly marked N/A when only OnStage was Not Required.
UPDATE checklist_items
SET status = 'not_started', last_updated_at = datetime('now')
WHERE field_key = 'emailer'
  AND status = 'not_applicable'
  AND LOWER(TRIM(COALESCE(value, ''))) = 'no';

UPDATE checklist_items
SET status = 'completed', last_updated_at = datetime('now')
WHERE field_key = 'emailer'
  AND status = 'not_applicable'
  AND LOWER(TRIM(COALESCE(value, ''))) = 'yes';

UPDATE checklist_items
SET status = 'not_applicable', last_updated_at = datetime('now')
WHERE field_key IN (
  'emailer_asked_client',
  'emailer_received_from_client',
  'emailer_sent_to_team',
  'emailer_sent'
)
  AND status != 'not_applicable'
  AND event_id IN (
    SELECT event_id FROM checklist_items
    WHERE field_key = 'emailer'
      AND LOWER(TRIM(COALESCE(value, ''))) != 'yes'
  );
