-- Genre Head is a dropdown backed by the approval_sent_to master list
-- (editable under Settings → Master Lists).

UPDATE checklist_definitions
SET field_type = 'dropdown', options = NULL
WHERE field_key = 'genre_head';
