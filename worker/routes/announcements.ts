/**
 * Team announcement: a single pinned message the admin can post to the whole
 * team's Dashboard — a whiteboard, not a chat. Posting a new one replaces
 * whatever is currently live; each user can dismiss the live one for
 * themselves without clearing it for anyone else.
 *
 *   GET    /active       — the live announcement (if any) + whether *this*
 *                           user has dismissed it                  (any user)
 *   POST   /             — post a new one, replacing the live one  (announcement.manage)
 *   DELETE /active       — clear the live announcement early       (announcement.manage)
 *   POST   /:id/dismiss  — dismiss the live announcement for me     (any user)
 */
import { Hono } from "hono";
import { z } from "zod";
import type { AuthEnv } from "../middleware/auth";
import { requireUser, requirePermission, actorFrom, ipHint } from "../middleware/auth";
import { audit } from "../lib/audit";
import { makeId } from "../lib/id";

export const announcementRoutes = new Hono<AuthEnv>();

const DEFAULT_EXPIRY_HOURS = 72;

const PostInput = z.object({
  message: z.string().trim().min(1).max(500),
  // Hours until auto-expiry; 0 means "no auto-expiry". Defaults to 72h so a
  // forgotten announcement doesn't linger indefinitely.
  expires_in_hours: z.number().int().min(0).max(24 * 30).nullish(),
});

type AnnouncementRow = {
  id: string;
  message: string;
  created_by: string | null;
  created_at: string;
  expires_at: string | null;
  created_by_name?: string | null;
};

async function loadLive(db: D1Database): Promise<AnnouncementRow | null> {
  const now = new Date().toISOString();
  return db.prepare(
    `SELECT a.id, a.message, a.created_by, a.created_at, a.expires_at, u.name AS created_by_name
     FROM announcements a LEFT JOIN users u ON u.id = a.created_by
     WHERE a.cleared_at IS NULL AND (a.expires_at IS NULL OR a.expires_at > ?)
     ORDER BY a.created_at DESC LIMIT 1`
  ).bind(now).first<AnnouncementRow>();
}

// GET /active — the live announcement plus whether the current user dismissed it.
announcementRoutes.get("/active", requireUser, async (c) => {
  const db = c.env.DB;
  const user = c.get("user")!;
  const live = await loadLive(db);
  if (!live) return c.json({ announcement: null });

  const dismissal = await db.prepare(
    "SELECT 1 FROM announcement_dismissals WHERE announcement_id = ? AND user_id = ?"
  ).bind(live.id, user.id).first();

  return c.json({
    announcement: {
      id: live.id,
      message: live.message,
      created_at: live.created_at,
      expires_at: live.expires_at,
      created_by_name: live.created_by_name ?? null,
      dismissed_by_me: Boolean(dismissal),
    },
  });
});

// POST / — post a new announcement, replacing whatever is currently live.
announcementRoutes.post("/", requirePermission("announcement.manage"), async (c) => {
  const parsed = PostInput.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Invalid input", detail: parsed.error.flatten() }, 400);
  const db = c.env.DB;
  const user = c.get("user")!;
  const now = new Date().toISOString();
  const expiresHours = parsed.data.expires_in_hours ?? DEFAULT_EXPIRY_HOURS;
  const expiresAt = expiresHours > 0 ? new Date(Date.now() + expiresHours * 3600_000).toISOString() : null;

  await db.prepare(
    "UPDATE announcements SET cleared_at = ?, cleared_by = ? WHERE cleared_at IS NULL"
  ).bind(now, user.id).run();

  const id = makeId("ann");
  await db.prepare(
    `INSERT INTO announcements (id, message, created_by, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(id, parsed.data.message, user.id, now, expiresAt).run();

  await audit({
    db, actor: actorFrom(user), action: "announcement.posted",
    targetType: "announcement", targetId: id, detail: { message: parsed.data.message, expiresAt },
    ipHint: ipHint(c.req.raw),
  });

  return c.json({
    announcement: {
      id, message: parsed.data.message, created_at: now, expires_at: expiresAt,
      created_by_name: user.name, dismissed_by_me: false,
    },
  }, 201);
});

// DELETE /active — clear the live announcement early.
announcementRoutes.delete("/active", requirePermission("announcement.manage"), async (c) => {
  const db = c.env.DB;
  const user = c.get("user")!;
  const live = await loadLive(db);
  if (!live) return c.json({ ok: true, cleared: false });

  const now = new Date().toISOString();
  await db.prepare("UPDATE announcements SET cleared_at = ?, cleared_by = ? WHERE id = ?").bind(now, user.id, live.id).run();
  await audit({
    db, actor: actorFrom(user), action: "announcement.cleared",
    targetType: "announcement", targetId: live.id,
    ipHint: ipHint(c.req.raw),
  });
  return c.json({ ok: true, cleared: true });
});

// POST /:id/dismiss — dismiss the live announcement for the current user only.
announcementRoutes.post("/:id/dismiss", requireUser, async (c) => {
  const db = c.env.DB;
  const user = c.get("user")!;
  const id = c.req.param("id");
  await db.prepare(
    "INSERT OR IGNORE INTO announcement_dismissals (announcement_id, user_id, dismissed_at) VALUES (?, ?, ?)"
  ).bind(id, user.id, new Date().toISOString()).run();
  return c.json({ ok: true });
});
