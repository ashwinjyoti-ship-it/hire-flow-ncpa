/**
 * Document handling helpers: category list, upload validation and filename
 * sanitisation. File bytes live in R2 (FILES binding); metadata lives in the
 * D1 `documents` table. Downloads always go through the authorised Worker
 * endpoint — R2 objects are never exposed via public URLs.
 */

export const DOCUMENT_CATEGORIES = [
  "inquiry",
  "costing",
  "approval",
  "confirmation_letter",
  "technical_rider",
  "floor_plan",
  "licence",
  "accounts",
  "tds_certificate",
  "payment_advice",
  "event_report",
  "feedback",
  "other",
] as const;

export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024; // 25 MB

/** MIME types accepted for upload (documents, spreadsheets, images). */
export const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
]);

/**
 * Sanitise a client-supplied filename for use in an R2 key and a
 * Content-Disposition header: strips any path component, replaces everything
 * outside [A-Za-z0-9._-] with underscores, collapses repeats, trims leading
 * dots/underscores and caps the length while preserving the extension.
 */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  let clean = base
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^[._-]+/, "");
  if (!clean || clean.replace(/[._-]/g, "") === "") return "file";
  if (clean.length > 120) {
    const dot = clean.lastIndexOf(".");
    const ext = dot > 0 ? clean.slice(dot).slice(0, 16) : "";
    clean = clean.slice(0, 120 - ext.length) + ext;
  }
  return clean;
}

/** Canonical R2 object key: documents/{eventId}/{docId}/{sanitised-filename} */
export function documentObjectKey(eventId: string, docId: string, fileName: string): string {
  return `documents/${eventId}/${docId}/${sanitizeFileName(fileName)}`;
}

/** Validate an upload; returns an error message or null when acceptable. */
export function validateUpload(file: { size: number; type: string; name: string }): string | null {
  if (file.size <= 0) return "The uploaded file is empty";
  if (file.size > MAX_DOCUMENT_BYTES) return "File exceeds the 25 MB size limit";
  if (!ALLOWED_MIME_TYPES.has(file.type)) return `File type not allowed: ${file.type || "unknown"}`;
  return null;
}
