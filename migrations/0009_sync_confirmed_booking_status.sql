-- Keep venue booking state aligned with confirmed event lifecycle state.
-- Older status transitions confirmed the event but left venue_bookings as
-- tentative, which made Show Calendar details display "Booking: Tentative".

UPDATE venue_bookings
SET booking_status = 'confirmed',
    updated_at = datetime('now')
WHERE booking_status != 'confirmed'
  AND event_id IN (
    SELECT id
    FROM events
    WHERE status = 'confirmed'
      AND is_archived = 0
  );
