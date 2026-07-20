-- Rename accounts post-event section to distinguish inbound (To Accounts) from outbound (To Client).

UPDATE checklist_definitions
SET section = 'To Accounts-payments and refunds'
WHERE field_key IN (
  'security_deposit_refund',
  'box_office_collection_refund',
  'payment_advice',
  'tds_certificate_refund_and_payment_advice',
  'payment_ledger'
);

UPDATE checklist_items
SET section = 'To Accounts-payments and refunds'
WHERE field_key IN (
  'security_deposit_refund',
  'box_office_collection_refund',
  'payment_advice',
  'tds_certificate_refund_and_payment_advice',
  'payment_ledger'
);
