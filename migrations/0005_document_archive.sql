-- ============================================================
-- Migration 0005: Document archive support (Phase 7)
-- ============================================================
-- Documents are archived rather than permanently deleted; the R2 object is
-- retained and the metadata row is flagged. Archived documents disappear from
-- event document lists and can no longer be downloaded.

ALTER TABLE documents ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0;
ALTER TABLE documents ADD COLUMN archived_at TEXT;
ALTER TABLE documents ADD COLUMN archived_by TEXT REFERENCES users(id);
