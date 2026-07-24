import { Hono } from "hono";
import type { AuthEnv } from "../middleware/auth";
import { actorFrom, ipHint, requireUser } from "../middleware/auth";
import { audit } from "../lib/audit";
import { makeId } from "../lib/id";
import {
  STICKY_NOTE_LIST_LIMIT,
  StickyNoteCreateInput,
  StickyNoteEditInput,
  StickyNoteLayoutInput,
  StickyNoteLinkInput,
  type StickyNote,
  type StickyNoteStatus,
} from "../lib/sticky-notes";

type NoteRow = Omit<StickyNote, "layout"> & {
  layout_x: number | null;
  layout_y: number | null;
  layout_z_index: number | null;
};

type NoteIdentity = {
  id: string;
  created_by: string;
  status: StickyNoteStatus;
  updated_at: string;
};

export const stickyNoteRoutes = new Hono<AuthEnv>();

const noteSelect = `
  SELECT n.id, n.body, n.status, n.event_id, n.organisation_id,
         n.created_by, creator.name AS created_by_name, n.created_at, n.updated_at,
         n.archived_by, archiver.name AS archived_by_name, n.archived_at,
         e.title AS event_title, e.event_code, e.event_start_date,
         o.name AS organisation_name,
         layout.x AS layout_x, layout.y AS layout_y, layout.z_index AS layout_z_index
  FROM sticky_notes n
  JOIN users creator ON creator.id = n.created_by
  LEFT JOIN users archiver ON archiver.id = n.archived_by
  LEFT JOIN events e ON e.id = n.event_id
  LEFT JOIN organisations o ON o.id = n.organisation_id
  LEFT JOIN sticky_note_layouts layout ON layout.note_id = n.id AND layout.user_id = ?`;

function serialiseNote(row: NoteRow): StickyNote {
  return {
    ...row,
    layout: row.layout_x == null || row.layout_y == null || row.layout_z_index == null
      ? null
      : { x: Number(row.layout_x), y: Number(row.layout_y), z_index: Number(row.layout_z_index) },
  };
}

async function loadNote(db: D1Database, noteId: string, userId: string): Promise<StickyNote | null> {
  const row = await db.prepare(`${noteSelect} WHERE n.id = ?`)
    .bind(userId, noteId)
    .first<NoteRow>();
  return row ? serialiseNote(row) : null;
}

async function loadIdentity(db: D1Database, noteId: string): Promise<NoteIdentity | null> {
  return db.prepare("SELECT id, created_by, status, updated_at FROM sticky_notes WHERE id = ?")
    .bind(noteId)
    .first<NoteIdentity>();
}

async function resolveLink(
  db: D1Database,
  eventId: string | null | undefined,
  organisationId: string | null | undefined,
): Promise<{ eventId: string | null; organisationId: string | null } | null> {
  if (eventId) {
    const event = await db.prepare(
      "SELECT id, organisation_id FROM events WHERE id = ? AND is_archived = 0"
    ).bind(eventId).first<{ id: string; organisation_id: string | null }>();
    if (!event) return null;
    return { eventId: event.id, organisationId: event.organisation_id };
  }
  if (organisationId) {
    const organisation = await db.prepare(
      "SELECT id FROM organisations WHERE id = ? AND is_archived = 0"
    ).bind(organisationId).first<{ id: string }>();
    if (!organisation) return null;
    return { eventId: null, organisationId: organisation.id };
  }
  return { eventId: null, organisationId: null };
}

stickyNoteRoutes.get("/summary", requireUser, async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT COUNT(*) AS active_count, MAX(updated_at) AS newest_updated_at FROM sticky_notes WHERE status = 'active'"
  ).first<{ active_count: number; newest_updated_at: string | null }>();
  return c.json({
    active_count: Number(row?.active_count ?? 0),
    newest_updated_at: row?.newest_updated_at ?? null,
  });
});

stickyNoteRoutes.get("/people", requireUser, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT DISTINCT u.id, u.name
     FROM users u
     WHERE u.id IN (
       SELECT created_by FROM sticky_notes
       UNION
       SELECT archived_by FROM sticky_notes WHERE archived_by IS NOT NULL
     )
     ORDER BY u.name`
  ).all<{ id: string; name: string }>();
  return c.json({ people: results ?? [] });
});

stickyNoteRoutes.get("/", requireUser, async (c) => {
  const user = c.get("user")!;
  const requestedStatus = c.req.query("status");
  const status: StickyNoteStatus = requestedStatus === "archived" ? "archived" : "active";
  const q = c.req.query("q")?.trim().toLowerCase();
  const eventId = c.req.query("event_id")?.trim();
  const organisationId = c.req.query("organisation_id")?.trim();
  const creatorId = c.req.query("created_by")?.trim();
  const archivedBy = c.req.query("archived_by")?.trim();
  const from = c.req.query("from")?.trim();
  const to = c.req.query("to")?.trim();
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 50) || 50, 1), STICKY_NOTE_LIST_LIMIT);
  const offset = Math.max(Number(c.req.query("offset") ?? 0) || 0, 0);

  const where = ["n.status = ?"];
  const binds: unknown[] = [status];
  if (q) {
    where.push("(LOWER(n.body) LIKE ? OR LOWER(COALESCE(e.title, '')) LIKE ? OR LOWER(COALESCE(o.name, '')) LIKE ? OR LOWER(creator.name) LIKE ? OR LOWER(COALESCE(archiver.name, '')) LIKE ?)");
    const like = `%${q}%`;
    binds.push(like, like, like, like, like);
  }
  if (eventId) { where.push("n.event_id = ?"); binds.push(eventId); }
  if (organisationId) { where.push("n.organisation_id = ?"); binds.push(organisationId); }
  if (creatorId) { where.push("n.created_by = ?"); binds.push(creatorId); }
  if (archivedBy) { where.push("n.archived_by = ?"); binds.push(archivedBy); }
  if (from) {
    where.push(status === "archived" ? "substr(n.archived_at, 1, 10) >= ?" : "substr(n.created_at, 1, 10) >= ?");
    binds.push(from);
  }
  if (to) {
    where.push(status === "archived" ? "substr(n.archived_at, 1, 10) <= ?" : "substr(n.created_at, 1, 10) <= ?");
    binds.push(to);
  }

  const whereSql = where.join(" AND ");
  const orderSql = status === "archived"
    ? "ORDER BY n.archived_at DESC, n.created_at DESC"
    : "ORDER BY n.created_at DESC";
  const count = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total
     FROM sticky_notes n
     JOIN users creator ON creator.id = n.created_by
     LEFT JOIN users archiver ON archiver.id = n.archived_by
     LEFT JOIN events e ON e.id = n.event_id
     LEFT JOIN organisations o ON o.id = n.organisation_id
     WHERE ${whereSql}`
  ).bind(...binds).first<{ total: number }>();
  const { results } = await c.env.DB.prepare(
    `${noteSelect} WHERE ${whereSql} ${orderSql} LIMIT ? OFFSET ?`
  ).bind(user.id, ...binds, limit, offset).all<NoteRow>();

  return c.json({
    notes: (results ?? []).map(serialiseNote),
    total: Number(count?.total ?? 0),
    limit,
    offset,
  });
});

stickyNoteRoutes.post("/", requireUser, async (c) => {
  const parsed = StickyNoteCreateInput.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Enter a note of up to 1,000 characters." }, 400);
  const user = c.get("user")!;
  const db = c.env.DB;
  const input = parsed.data;
  const link = await resolveLink(db, input.event_id, input.organisation_id);
  if (!link) return c.json({ error: "The linked event or organisation could not be found." }, 400);

  const id = makeId("note");
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO sticky_notes
       (id, body, event_id, organisation_id, status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`
  ).bind(id, input.body, link.eventId, link.organisationId, user.id, now, now).run();
  if (input.layout) {
    await db.prepare(
      `INSERT INTO sticky_note_layouts (note_id, user_id, x, y, z_index, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(id, user.id, input.layout.x, input.layout.y, input.layout.z_index, now).run();
  }
  await audit({
    db,
    actor: actorFrom(user),
    action: "sticky_note.created",
    targetType: "sticky_note",
    targetId: id,
    detail: { eventId: link.eventId, organisationId: link.organisationId },
    ipHint: ipHint(c.req.raw),
  });
  return c.json({ note: await loadNote(db, id, user.id) }, 201);
});

stickyNoteRoutes.patch("/:id", requireUser, async (c) => {
  const parsed = StickyNoteEditInput.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Enter a note of up to 1,000 characters." }, 400);
  const user = c.get("user")!;
  const db = c.env.DB;
  const id = c.req.param("id");
  const note = await loadIdentity(db, id);
  if (!note) return c.json({ error: "Note not found." }, 404);
  if (note.created_by !== user.id) return c.json({ error: "Only the note creator can edit its wording." }, 403);
  if (note.status !== "active") return c.json({ error: "Restore the note before editing it." }, 409);
  if (note.updated_at !== parsed.data.expected_updated_at) {
    return c.json({ error: "This note changed while you were editing it. Refresh and try again." }, 409);
  }
  const now = new Date().toISOString();
  const result = await db.prepare(
    "UPDATE sticky_notes SET body = ?, updated_at = ? WHERE id = ? AND status = 'active' AND updated_at = ?"
  ).bind(parsed.data.body, now, id, parsed.data.expected_updated_at).run();
  if ((result.meta?.changes ?? 0) === 0) {
    return c.json({ error: "This note changed while you were editing it. Refresh and try again." }, 409);
  }
  await audit({
    db, actor: actorFrom(user), action: "sticky_note.edited",
    targetType: "sticky_note", targetId: id, ipHint: ipHint(c.req.raw),
  });
  return c.json({ note: await loadNote(db, id, user.id) });
});

stickyNoteRoutes.put("/:id/link", requireUser, async (c) => {
  const parsed = StickyNoteLinkInput.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Invalid note link." }, 400);
  const user = c.get("user")!;
  const db = c.env.DB;
  const id = c.req.param("id");
  const note = await loadIdentity(db, id);
  if (!note) return c.json({ error: "Note not found." }, 404);
  if (note.status !== "active") return c.json({ error: "Restore the note before changing its link." }, 409);
  const link = await resolveLink(db, parsed.data.event_id, parsed.data.organisation_id);
  if (!link) return c.json({ error: "The linked event or organisation could not be found." }, 400);
  const now = new Date().toISOString();
  await db.prepare(
    "UPDATE sticky_notes SET event_id = ?, organisation_id = ?, updated_at = ? WHERE id = ? AND status = 'active'"
  ).bind(link.eventId, link.organisationId, now, id).run();
  await audit({
    db, actor: actorFrom(user), action: "sticky_note.relinked",
    targetType: "sticky_note", targetId: id,
    detail: { eventId: link.eventId, organisationId: link.organisationId },
    ipHint: ipHint(c.req.raw),
  });
  return c.json({ note: await loadNote(db, id, user.id) });
});

stickyNoteRoutes.put("/:id/layout", requireUser, async (c) => {
  const parsed = StickyNoteLayoutInput.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Invalid note position." }, 400);
  const user = c.get("user")!;
  const db = c.env.DB;
  const id = c.req.param("id");
  const note = await loadIdentity(db, id);
  if (!note) return c.json({ error: "Note not found." }, 404);
  if (note.status !== "active") return c.json({ error: "Archived notes cannot be arranged." }, 409);
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO sticky_note_layouts (note_id, user_id, x, y, z_index, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(note_id, user_id) DO UPDATE SET
       x = excluded.x, y = excluded.y, z_index = excluded.z_index, updated_at = excluded.updated_at`
  ).bind(id, user.id, parsed.data.x, parsed.data.y, parsed.data.z_index, now).run();
  return c.json({ ok: true });
});

stickyNoteRoutes.post("/:id/archive", requireUser, async (c) => {
  const user = c.get("user")!;
  const db = c.env.DB;
  const id = c.req.param("id");
  const note = await loadIdentity(db, id);
  if (!note) return c.json({ error: "Note not found." }, 404);
  if (note.status === "archived") return c.json({ note: await loadNote(db, id, user.id) });
  const now = new Date().toISOString();
  await db.prepare(
    "UPDATE sticky_notes SET status = 'archived', archived_by = ?, archived_at = ?, updated_at = ? WHERE id = ? AND status = 'active'"
  ).bind(user.id, now, now, id).run();
  await audit({
    db, actor: actorFrom(user), action: "sticky_note.archived",
    targetType: "sticky_note", targetId: id, ipHint: ipHint(c.req.raw),
  });
  return c.json({ note: await loadNote(db, id, user.id) });
});

stickyNoteRoutes.post("/:id/restore", requireUser, async (c) => {
  const user = c.get("user")!;
  const db = c.env.DB;
  const id = c.req.param("id");
  const note = await loadIdentity(db, id);
  if (!note) return c.json({ error: "Note not found." }, 404);
  if (note.status === "active") return c.json({ note: await loadNote(db, id, user.id) });
  const now = new Date().toISOString();
  await db.prepare(
    "UPDATE sticky_notes SET status = 'active', archived_by = NULL, archived_at = NULL, updated_at = ? WHERE id = ? AND status = 'archived'"
  ).bind(now, id).run();
  await audit({
    db, actor: actorFrom(user), action: "sticky_note.restored",
    targetType: "sticky_note", targetId: id, ipHint: ipHint(c.req.raw),
  });
  return c.json({ note: await loadNote(db, id, user.id) });
});

stickyNoteRoutes.delete("/:id", requireUser, async (c) => {
  const user = c.get("user")!;
  const db = c.env.DB;
  const id = c.req.param("id");
  const note = await loadIdentity(db, id);
  if (!note) return c.json({ error: "Note not found." }, 404);
  if (note.created_by !== user.id) return c.json({ error: "Only the note creator can delete it." }, 403);
  await db.prepare("DELETE FROM sticky_note_layouts WHERE note_id = ?").bind(id).run();
  await db.prepare("DELETE FROM sticky_notes WHERE id = ?").bind(id).run();
  await audit({
    db, actor: actorFrom(user), action: "sticky_note.deleted",
    targetType: "sticky_note", targetId: id, ipHint: ipHint(c.req.raw),
  });
  return c.json({ ok: true });
});
