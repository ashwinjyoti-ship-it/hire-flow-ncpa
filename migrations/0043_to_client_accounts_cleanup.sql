-- To Client / TDS processing cleanup:
-- - Payment advice: received-from-client → sent-to-client semantics
-- - Move TDS Payment & Advice into TDS Certificate Processing
-- - Remove Accounts Status Summary section

-- 1. Payment advice: rename field, relabel, and switch to outbound vocabulary.
UPDATE checklist_definitions
   SET id = 'cd_accounts_payment_advice_sent_to_client',
       field_key = 'payment_advice_sent_to_client',
       label = 'Payment Advice — Sent to Client?',
       options = '["Not Sent","Sent"]',
       default_value = 'Not Sent'
 WHERE field_key = 'payment_advice_received_from_client';

UPDATE checklist_items
   SET definition_id = 'cd_accounts_payment_advice_sent_to_client',
       field_key = 'payment_advice_sent_to_client',
       label = 'Payment Advice — Sent to Client?',
       value = CASE
         WHEN lower(trim(value)) = 'yes' THEN 'Sent'
         WHEN lower(trim(value)) = 'no' THEN 'Not Sent'
         ELSE value
       END,
       status = CASE
         WHEN lower(trim(value)) = 'yes' THEN 'completed'
         WHEN lower(trim(value)) = 'no' THEN 'not_started'
         WHEN lower(trim(value)) = 'sent' THEN 'completed'
         WHEN lower(trim(value)) = 'not sent' THEN 'not_started'
         ELSE status
       END,
       completed_at = CASE
         WHEN lower(trim(value)) IN ('yes', 'sent') THEN COALESCE(completed_at, datetime('now'))
         ELSE NULL
       END
 WHERE field_key = 'payment_advice_received_from_client';

-- 2. Move TDS Payment & Advice into TDS Certificate Processing.
UPDATE checklist_definitions
   SET section = 'TDS Certificate Processing',
       visibility_rule = 'onlyWhen(tds_certificate_from_client == Received)'
 WHERE field_key = 'tds_payment_and_advice_sent';

UPDATE checklist_items
   SET section = 'TDS Certificate Processing'
 WHERE field_key = 'tds_payment_and_advice_sent';

UPDATE checklist_items
   SET status = 'not_applicable',
       completed_at = COALESCE(completed_at, datetime('now'))
 WHERE field_key = 'tds_payment_and_advice_sent'
   AND status != 'not_applicable'
   AND event_id IN (
     SELECT ci.event_id
       FROM checklist_items ci
      WHERE ci.field_key = 'tds_certificate_from_client'
        AND lower(trim(ci.value)) != 'received'
   );

-- 3. Remove Accounts Status Summary (computed read-only section).
DELETE FROM checklist_items
 WHERE field_key IN ('accounts_file_status', 'outstanding_to_client', 'notifications_triggered');

DELETE FROM checklist_definitions
 WHERE field_key IN ('accounts_file_status', 'outstanding_to_client', 'notifications_triggered');
