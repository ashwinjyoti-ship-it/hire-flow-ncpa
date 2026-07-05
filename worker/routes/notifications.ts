import { Hono } from "hono";
import type { AuthEnv } from "../middleware/auth";
import { requireUser } from "../middleware/auth";

export const notificationRoutes = new Hono<AuthEnv>();

notificationRoutes.get("/", requireUser, async (c) => {
  const user = c.get("user")!;
  const unreadOnly = c.req.query("unread") === "1";
  const where = ["(n.recipient_id = ? OR n.recipient_role = ?)"];
  const binds: unknown[] = [user.id, user.role];
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
     WHERE (n.recipient_id = ? OR n.recipient_role = ?) AND n.is_read = 0`
  ).bind(user.id, user.role).first<{ count: number }>();

  return c.json({ notifications: results, unread: unread?.count ?? 0 });
});

notificationRoutes.post("/:id/read", requireUser, async (c) => {
  const user = c.get("user")!;
  await c.env.DB.prepare(
    `UPDATE notifications SET is_read = 1
     WHERE id = ? AND (recipient_id = ? OR recipient_role = ?)`
  ).bind(c.req.param("id"), user.id, user.role).run();
  return c.json({ ok: true });
});

notificationRoutes.post("/read-all", requireUser, async (c) => {
  const user = c.get("user")!;
  await c.env.DB.prepare(
    `UPDATE notifications SET is_read = 1
     WHERE recipient_id = ? OR recipient_role = ?`
  ).bind(user.id, user.role).run();
  return c.json({ ok: true });
});
