-- Accounts checklist: drop unused notify/TDS-sent-to-client fields; add Not Applicable
-- on box office statement; add TDS Certificate Processing section (client ↔ accounts).

-- 1. Remove obsolete fields.
DELETE FROM checklist_items
 WHERE field_key IN ('notify_after_3_days', 'tds_certificate_sent_to_client');

DELETE FROM checklist_definitions
 WHERE field_key IN ('notify_after_3_days', 'tds_certificate_sent_to_client');

-- 2. Box Office Statement — Sent? gains Not Applicable.
UPDATE checklist_definitions
SET options = '["Not Sent","Sent","Not Applicable"]'
WHERE field_key = 'box_office_statement_sent';

UPDATE checklist_items
SET status = 'not_applicable',
    completed_at = COALESCE(completed_at, datetime('now'))
WHERE field_key = 'box_office_statement_sent'
  AND lower(trim(value)) = 'not applicable';

-- 3. Insert new TDS processing definitions (sort after To Client / before Status Summary).
INSERT INTO checklist_definitions (
  id, module, section, field_key, label, field_type, options, default_value,
  vfh_only, is_computed, triggers_task, visibility_rule, sort_order, created_at
)
SELECT
  'cd_accounts_tds_received_from_client_date',
  'accounts',
  'TDS Certificate Processing',
  'tds_received_from_client_date',
  'TDS Received from Client — Date',
  'date',
  NULL,
  NULL,
  0,
  0,
  '{"rule":"tds_send_to_accounts","title":"Send TDS certificate to Accounts","due_after_days":0,"complete_when":"TDS Certificate Sent to Accounts date is set"}',
  'onlyWhen(tds_certificate_from_client == Received)',
  COALESCE((SELECT sort_order FROM checklist_definitions WHERE field_key = 'tds_certificate_from_client'), 0) + 1,
  datetime('now')
WHERE NOT EXISTS (
  SELECT 1 FROM checklist_definitions WHERE field_key = 'tds_received_from_client_date'
);

INSERT INTO checklist_definitions (
  id, module, section, field_key, label, field_type, options, default_value,
  vfh_only, is_computed, triggers_task, visibility_rule, sort_order, created_at
)
SELECT
  'cd_accounts_tds_certificate_sent_to_accounts',
  'accounts',
  'TDS Certificate Processing',
  'tds_certificate_sent_to_accounts',
  'TDS Certificate Sent to Accounts — Date',
  'date',
  NULL,
  NULL,
  0,
  0,
  NULL,
  'onlyWhen(tds_certificate_from_client == Received)',
  COALESCE((SELECT sort_order FROM checklist_definitions WHERE field_key = 'tds_certificate_from_client'), 0) + 2,
  datetime('now')
WHERE NOT EXISTS (
  SELECT 1 FROM checklist_definitions WHERE field_key = 'tds_certificate_sent_to_accounts'
);

INSERT INTO checklist_definitions (
  id, module, section, field_key, label, field_type, options, default_value,
  vfh_only, is_computed, triggers_task, visibility_rule, sort_order, created_at
)
SELECT
  'cd_accounts_tds_accounts_refund_or_action',
  'accounts',
  'TDS Certificate Processing',
  'tds_accounts_refund_or_action',
  'Accounts Refund / Payment Action',
  'dropdown',
  '["Awaiting","Refunded","Payment Processed","N/A"]',
  'Awaiting',
  0,
  0,
  NULL,
  'onlyWhen(tds_certificate_from_client == Received)',
  COALESCE((SELECT sort_order FROM checklist_definitions WHERE field_key = 'tds_certificate_from_client'), 0) + 3,
  datetime('now')
WHERE NOT EXISTS (
  SELECT 1 FROM checklist_definitions WHERE field_key = 'tds_accounts_refund_or_action'
);

INSERT INTO checklist_definitions (
  id, module, section, field_key, label, field_type, options, default_value,
  vfh_only, is_computed, triggers_task, visibility_rule, sort_order, created_at
)
SELECT
  'cd_accounts_tds_proof_sent_to_client',
  'accounts',
  'TDS Certificate Processing',
  'tds_proof_sent_to_client',
  'Proof Sent to Client',
  'dropdown',
  '["Not Sent","Sent"]',
  'Not Sent',
  0,
  0,
  NULL,
  'onlyWhen(tds_certificate_from_client == Received)',
  COALESCE((SELECT sort_order FROM checklist_definitions WHERE field_key = 'tds_certificate_from_client'), 0) + 4,
  datetime('now')
WHERE NOT EXISTS (
  SELECT 1 FROM checklist_definitions WHERE field_key = 'tds_proof_sent_to_client'
);

-- Keep later To Client / Status Summary fields ordered after the new block.
UPDATE checklist_definitions
SET sort_order = sort_order + 4
WHERE module = 'accounts'
  AND field_key IN (
    'tds_payment_and_advice_sent',
    'payment_ledger_sent',
    'accounts_file_status',
    'outstanding_to_client',
    'notifications_triggered'
  );

-- 4. Mark dependents N/A on existing events where TDS from client is not Received.
--    New rows are created lazily by ensureChecklistForEvent; this heals any that
--    already exist after a seed re-run, and sets status for the default N.A. case
--    once items are inserted on next checklist load.
