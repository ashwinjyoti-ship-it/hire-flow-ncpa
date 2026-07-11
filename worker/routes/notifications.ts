import { Hono } from "hono";
import type { AuthEnv } from "../middleware/auth";
import { requireUser } from "../middleware/auth";
import type { AuthUser } from "../env";

export const notificationRoutes = new Hono<AuthEnv>();

/**
 * A notification is addressed either to a specific user (recipient_id) or to
 * whoever holds a permission (recipient_permission). Build the matching WHERE
 * clause + binds for the current user.
 */
function recipientClause(user: AuthUser): { clause: string; binds: unknown[] } {
  const perms = user.permissions;
  if (!perms.length) return { clause: "(recipient_id = ?)", binds: [user.id] };
  const placeholders = perms.map(() => "?").join(", ");
  return {
    clause: `(recipient_id = ? OR recipient_permission IN (${placeholders}))`,
    binds: [user.id, ...perms],
  };
}

notificationRoutes.get("/", requireUser, async (c) => {
  const user = c.get("user")!;
  const unreadOnly = c.req.query("unread") === "1";
  const { clause, binds } = recipientClause(user);
  const where = [clause.replace(/recipient_/g, "n.recipient_")];
  if (unreadOnly) where.push("n.is_read = 0");

  const { results } = await c.env.DB.prepare(
    `SELECT n.*, e.title AS event_title, t.title AS task_title
     FROM notifications n
     LEFT JOIN events e ON e.id = n.related_event_id
     LEFT JOIN tasks t ON t.id = n.related_task_id
     WHERE ${where.join(" AND ")}
     ORDER BY n.created_at DESC
     LIMIT 100`
  ).bind(...binds).all();

  const unread = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count FROM notifications n
     WHERE ${clause.replace(/recipient_/g, "n.recipient_")} AND n.is_read = 0`
  ).bind(...binds).first<{ count: number }>();

  return c.json({ notifications: results, unread: unread?.count ?? 0 });
});

notificationRoutes.post("/:id/read", requireUser, async (c) => {
  const user = c.get("user")!;
  const { clause, binds } = recipientClause(user);
  await c.env.DB.prepare(
    `UPDATE notifications SET is_read = 1 WHERE id = ? AND ${clause}`
  ).bind(c.req.param("id"), ...binds).run();
  return c.json({ ok: true });
});

notificationRoutes.post("/read-all", requireUser, async (c) => {
  const user = c.get("user")!;
  const { clause, binds } = recipientClause(user);
  await c.env.DB.prepare(
    `UPDATE notifications SET is_read = 1 WHERE ${clause}`
  ).bind(...binds).run();
  return c.json({ ok: true });
});
