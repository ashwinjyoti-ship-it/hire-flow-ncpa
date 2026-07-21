-- TDS Certificate Processing: remove redundant TDS Payment & Advice field.
-- Proof Sent to Client already tracks outbound confirmation to the client.

DELETE FROM checklist_items
 WHERE field_key = 'tds_payment_and_advice_sent';

DELETE FROM checklist_definitions
 WHERE field_key = 'tds_payment_and_advice_sent';
