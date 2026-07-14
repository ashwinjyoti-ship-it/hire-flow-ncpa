-- Rename schedule activity type: technical_meeting -> zero_show
UPDATE schedule_entries
SET activity_type = 'zero_show'
WHERE activity_type = 'technical_meeting';
