-- Adds an optional visibility_rule column to checklist_definitions.
-- Allows a field to declare conditional visibility, e.g.
--   visibility_rule = 'onlyWhen(instalment == Yes)'
-- so a field is rendered only when another checklist field has a given value.
-- Rendered (UI) only; hidden fields stay persisted server-side. Backwards
-- compatible: existing rows default to NULL (always visible).

ALTER TABLE checklist_definitions ADD COLUMN visibility_rule TEXT;
