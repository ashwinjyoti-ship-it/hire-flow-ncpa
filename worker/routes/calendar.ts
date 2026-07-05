/**
 * Calendar API routes.
 *   GET /calendar?from=&to=&status=&venue=&type=&owner=  — schedule entries in range
 *
 * Returns event blocks keyed by date, with title/venue/status/time/activity.
 */
import { Hono } from "hono";
import type { AuthEnv } from "../middleware/auth";
import { requireUser } from "../middleware/auth";

export const calendarRoutes = new Hono<AuthEnv>();

calendarRoutes.get("/", requireUser, async (c) => {
  const from = c.req.query("from");
  const to = c.req.query("to");
  const status = c.req.query("status");
  const venue = c.req.query("venue");
  const type = c.req.query("type");
  const owner = c.req.query("owner");

  if (!from || !to) {
    return c.json({ error: "from and to query params required (yyyy-mm-dd)" }, 400);
  }

  const where = [
    "se.activity_date >= ?",
    "se.activity_date <= ?",
    "e.is_archived = 0",
    "e.status NOT IN ('draft')",
  ];
  const binds: unknown[] = [from, to];

  if (status) { where.push("e.status = ?"); binds.push(status); }
  if (venue) { where.push("vb.venue = ?"); binds.push(venue); }
  if (type) { where.push("e.event_type = ?"); binds.push(type); }
  if (owner) { where.push("e.event_owner = ?"); binds.push(owner); }

  const sql = `SELECT se.id, se.activity_type, se.activity_date, se.start_time, se.end_time,
      e.id AS event_id, e.title, e.status, e.event_type,
      o.name AS organisation_name,
      vb.venue
    FROM schedule_entries se
    JOIN events e ON e.id = se.event_id
    JOIN venue_bookings vb ON vb.id = se.venue_booking_id
    LEFT JOIN organisations o ON o.id = e.organisation_id
    WHERE ${where.join(" AND ")}
    ORDER BY se.activity_date, vb.venue, se.start_time, se.sort_order
    LIMIT 1000`;

  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();

  // Group by date for convenient calendar rendering.
  const byDate: Record<string, typeof results> = {};
  for (const r of results) {
    const row = r as { activity_date: string };
    const key = row.activity_date;
    if (!byDate[key]) byDate[key] = [];
    byDate[key]!.push(r);
  }

  return c.json({ entries: results, byDate });
});
