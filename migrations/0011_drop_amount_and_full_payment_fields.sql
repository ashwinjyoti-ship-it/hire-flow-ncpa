-- Rework the Financials section: drop the "Amount Received" and
-- "Full Payment Received" checklist fields and simplify Payment Status to
-- Awaiting / Received. The costing email + payment received are now the
-- financial gate to confirmation (see state-machine canConfirm).

-- 1. Remove per-event checklist item rows for the dropped fields.
DELETE FROM checklist_items
 WHERE field_key IN ('amount_received', 'full_payment_received');

-- 2. Remove the template definitions so they no longer seed for new events.
DELETE FROM checklist_definitions
 WHERE field_key IN ('amount_received', 'full_payment_received');

-- 3. Normalize legacy Payment Status values into the new vocabulary.
--    Old: Awaiting / Part received / Full received. New: Awaiting / Received.
UPDATE checklist_items
   SET value = 'Received'
 WHERE field_key = 'payment_status'
   AND LOWER(TRIM(value)) IN ('part received', 'full received');
