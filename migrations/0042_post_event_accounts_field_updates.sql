-- Post-event accounts (To Accounts-payments and refunds): drop Security Deposit Refund
-- and TDS Certificate Refund & Payment Advice; rename labels; add N/A to Payment Ledger.

-- 1. Remove dropped fields.
DELETE FROM checklist_items
 WHERE field_key IN ('security_deposit_refund', 'tds_certificate_refund_and_payment_advice');

DELETE FROM checklist_definitions
 WHERE field_key IN ('security_deposit_refund', 'tds_certificate_refund_and_payment_advice');

-- 2. Rename labels on definitions and existing per-event rows.
UPDATE checklist_definitions
   SET label = 'Box Office Statement'
 WHERE field_key = 'box_office_collection_refund';

UPDATE checklist_items
   SET label = 'Box Office Statement'
 WHERE field_key = 'box_office_collection_refund';

UPDATE checklist_definitions
   SET label = 'Payment Advice from Accounts'
 WHERE field_key = 'payment_advice';

UPDATE checklist_items
   SET label = 'Payment Advice from Accounts'
 WHERE field_key = 'payment_advice';

-- 3. Payment Ledger gains N/A.
UPDATE checklist_definitions
   SET options = '["N/A","Requested","Received"]'
 WHERE field_key = 'payment_ledger';

UPDATE checklist_items
   SET status = 'not_applicable',
       completed_at = COALESCE(completed_at, datetime('now'))
 WHERE field_key = 'payment_ledger'
   AND lower(trim(value)) = 'n/a';
