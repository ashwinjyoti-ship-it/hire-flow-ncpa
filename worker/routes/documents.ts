/**
 * Document API routes. File bytes live in R2 (FILES binding), metadata in D1.
 *
 * Event-scoped (mounted at /events):
 *   POST /:eventId/documents — upload (Coordinator+, `document.upload`)
 *   GET  /:eventId/documents — list active documents for the event
 *
 * Document-scoped (mounted at /documents):
 *   GET    /:id           — metadata
 *   GET    /:id/download  — stream bytes through the Worker (never a public R2 URL)
 *   DELETE /:id           — archive (Admin / Venue Manager, `document.delete`)
 */
import { Hono } from "hono";
import type { AuthEnv } from "../middleware/auth";
import { requireUser, requirePermission, actorFrom, ipHint } from "../middleware/auth";
import { audit, eventActivity } from "../lib/audit";
import { makeId } from "../lib/id";
import {
  DOCUMENT_CATEGORIES,
  documentObjectKey,
  sanitizeFileName,
  validateUpload,
  type DocumentCategory,
} from "../lib/documents";

export const eventDocumentRoutes = new Hono<AuthEnv>();
export const documentRoutes = new Hono<AuthEnv>();

type DocumentRow = {
  id: string;
  event_id: string | null;
  file_name: string;
  r2_key: string;
  mime_type: string | null;
  file_size: number | null;
  category: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
  notes: string | null;
  is_archived: number;
};

// POST /:eventId/documents — multipart upload (fields: file, category, notes)
eventDocumentRoutes.post("/:eventId/documents", requirePermission("document.upload"), async (c) => {
  const eventId = c.req.param("eventId");
  const user = c.get("user")!;
  const db = c.env.DB;

  const event = await db.prepare("SELECT id FROM events WHERE id = ? AND is_archived = 0").bind(eventId).first();
  if (!event) return c.json({ error: "Event not found" }, 404);

  const body = await c.req.parseBody().catch(() => null);
  if (!body) return c.json({ error: "Invalid multipart form data" }, 400);

  const file = body["file"];
  if (!(file instanceof File)) return c.json({ error: "A file is required" }, 400);
  const invalid = validateUpload(file);
  if (invalid) return c.json({ error: invalid }, 400);

  const category = typeof body["category"] === "string" ? body["category"] : "other";
  if (!DOCUMENT_CATEGORIES.includes(category as DocumentCategory)) {
    return c.json({ error: `Invalid category: ${category}` }, 400);
  }
  const notes = typeof body["notes"] === "string" && body["notes"].trim() ? body["notes"].trim() : null;

  const docId = makeId("doc");
  const fileName = sanitizeFileName(file.name);
  const key = documentObjectKey(eventId, docId, file.name);
  const now = new Date().toISOString();

  await c.env.FILES.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  });

  await db.prepare(
    `INSERT INTO documents (id, event_id, file_name, r2_key, mime_type, file_size, category, uploaded_by, uploaded_at, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(docId, eventId, fileName, key, file.type, file.size, category, user.id, now, notes).run();

  await audit({
    db, actor: actorFrom(user), action: "document.uploaded",
    targetType: "document", targetId: docId,
    detail: { eventId, fileName, category, size: file.size },
    ipHint: ipHint(c.req.raw),
  });
  await eventActivity(db, eventId, "document_uploaded", user.id, { documentId: docId, fileName, category });

  return c.json({ id: docId, file_name: fileName, category }, 201);
});

// GET /:eventId/documents — active documents for the event
eventDocumentRoutes.get("/:eventId/documents", requireUser, async (c) => {
  const eventId = c.req.param("eventId");
  const { results } = await c.env.DB.prepare(
    `SELECT d.id, d.event_id, d.file_name, d.mime_type, d.file_size, d.category, d.notes,
            d.uploaded_at, u.name AS uploaded_by_name
     FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by
     WHERE d.event_id = ? AND d.is_archived = 0
     ORDER BY d.uploaded_at DESC`
  ).bind(eventId).all();
  return c.json({ documents: results });
});

// GET /:id — metadata
documentRoutes.get("/:id", requireUser, async (c) => {
  const doc = await c.env.DB.prepare(
    `SELECT d.id, d.event_id, d.file_name, d.mime_type, d.file_size, d.category, d.notes,
            d.uploaded_at, d.is_archived, u.name AS uploaded_by_name
     FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by
     WHERE d.id = ?`
  ).bind(c.req.param("id")).first<DocumentRow>();
  if (!doc || doc.is_archived) return c.json({ error: "Document not found" }, 404);
  return c.json({ document: doc });
});

// GET /:id/download — stream through the Worker (authorised access only)
documentRoutes.get("/:id/download", requireUser, async (c) => {
  const user = c.get("user")!;
  const doc = await c.env.DB.prepare(
    "SELECT id, event_id, file_name, r2_key, mime_type, file_size, is_archived FROM documents WHERE id = ?"
  ).bind(c.req.param("id")).first<DocumentRow>();
  if (!doc || doc.is_archived) return c.json({ error: "Document not found" }, 404);

  const object = await c.env.FILES.get(doc.r2_key);
  if (!object) return c.json({ error: "Stored file is missing" }, 404);

  await audit({
    db: c.env.DB, actor: actorFrom(user), action: "document.downloaded",
    targetType: "document", targetId: doc.id, detail: { eventId: doc.event_id, fileName: doc.file_name },
  });

  return new Response(object.body, {
    headers: {
      "Content-Type": doc.mime_type ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="${sanitizeFileName(doc.file_name)}"`,
      ...(doc.file_size ? { "Content-Length": String(doc.file_size) } : {}),
      "Cache-Control": "private, no-store",
    },
  });
});

// DELETE /:id — archive (never a hard delete; the R2 object is retained)
documentRoutes.delete("/:id", requirePermission("document.delete"), async (c) => {
  const user = c.get("user")!;
  const db = c.env.DB;
  const doc = await db.prepare(
    "SELECT id, event_id, file_name, is_archived FROM documents WHERE id = ?"
  ).bind(c.req.param("id")).first<DocumentRow>();
  if (!doc || doc.is_archived) return c.json({ error: "Document not found" }, 404);

  const now = new Date().toISOString();
  await db.prepare(
    "UPDATE documents SET is_archived = 1, archived_at = ?, archived_by = ? WHERE id = ?"
  ).bind(now, user.id, doc.id).run();

  await audit({
    db, actor: actorFrom(user), action: "document.archived",
    targetType: "document", targetId: doc.id,
    detail: { eventId: doc.event_id, fileName: doc.file_name },
    ipHint: ipHint(c.req.raw),
  });
  if (doc.event_id) {
    await eventActivity(db, doc.event_id, "document_archived", user.id, { documentId: doc.id, fileName: doc.file_name });
  }
  return c.json({ ok: true, archived: true });
});
