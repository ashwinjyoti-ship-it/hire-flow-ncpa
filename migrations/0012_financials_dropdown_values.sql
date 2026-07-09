-- Normalize Financials dropdown values to the new vocabularies.
--   costing_email:   Pending -> No,  Sent/Approved -> Yes
--   proforma_invoice: Pending -> Not Sent,  Approved -> Sent (Sent/Not Applicable unchanged)
--   payment_status:  Awaiting -> Incomplete,  Received/Part received/Full received -> Completed
-- Definition rows (checklist_definitions) are idempotently upserted by the seed
-- run, so only the per-event checklist_items values are migrated here.

UPDATE checklist_items
   SET value = CASE field_key
     WHEN 'costing_email' THEN
       CASE LOWER(TRIM(value))
         WHEN 'pending' THEN 'No'
         WHEN 'sent' THEN 'Yes'
         WHEN 'approved' THEN 'Yes'
         ELSE value
       END
     WHEN 'proforma_invoice' THEN
       CASE LOWER(TRIM(value))
         WHEN 'pending' THEN 'Not Sent'
         WHEN 'approved' THEN 'Sent'
         ELSE value
       END
     WHEN 'payment_status' THEN
       CASE LOWER(TRIM(value))
         WHEN 'awaiting' THEN 'Incomplete'
         WHEN 'received' THEN 'Completed'
         WHEN 'part received' THEN 'Completed'
         WHEN 'full received' THEN 'Completed'
         ELSE value
       END
     ELSE value
   END
 WHERE field_key IN ('costing_email', 'proforma_invoice', 'payment_status');
