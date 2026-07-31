import { Hono, type Context } from "hono";
import type { AuthEnv } from "../middleware/auth";
import { requireUser } from "../middleware/auth";

export const realtimeRoutes = new Hono<AuthEnv>();

function connect(c: Context<AuthEnv>, room: string) {
  if (!c.env.EVENT_ROOMS) {
    return c.json({ error: "Realtime service is unavailable" }, 503);
  }
  if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
    return c.json({ error: "WebSocket upgrade required" }, 426);
  }
  const namespace = c.env.EVENT_ROOMS;
  const stub = namespace.get(namespace.idFromName(room));
  return stub.fetch(new Request("https://room.internal/connect", c.req.raw));
}

realtimeRoutes.get("/dashboard", requireUser, (c) => connect(c, "dashboard"));
realtimeRoutes.get("/events/:eventId", requireUser, async (c) => {
  const eventId = c.req.param("eventId");
  const event = await c.env.DB.prepare(
    "SELECT id FROM events WHERE id = ? AND is_archived = 0",
  ).bind(eventId).first();
  if (!event) return c.json({ error: "Event not found" }, 404);
  return connect(c, `event:${eventId}`);
});
