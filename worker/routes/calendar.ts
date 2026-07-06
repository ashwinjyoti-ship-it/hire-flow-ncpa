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

calendarRoutes.get("/lifecycle", requireUser, async (c) => {
  const from = c.req.query("from");
  const to = c.req.query("to");
  const status = c.req.query("status");
  const venue = c.req.query("venue");
  const type = c.req.query("type");
  const owner = c.req.query("owner");
  const q = c.req.query("q");

  if (!from || !to) {
    return c.json({ error: "from and to query params required (yyyy-mm-dd)" }, 400);
  }

  const where = ["milestone_date >= ?", "milestone_date <= ?", "is_archived = 0"];
  const binds: unknown[] = [from, to];

  if (status) { where.push("status = ?"); binds.push(status); }
  if (venue) { where.push("venues LIKE ?"); binds.push(`%${venue}%`); }
  if (type) { where.push("event_type = ?"); binds.push(type); }
  if (owner) { where.push("event_owner = ?"); binds.push(owner); }
  if (q) {
    where.push("(LOWER(title) LIKE ? OR LOWER(COALESCE(organisation_name, '')) LIKE ? OR LOWER(COALESCE(event_code, '')) LIKE ?)");
    const like = `%${q.toLowerCase()}%`;
    binds.push(like, like, like);
  }

  const sql = `WITH lifecycle AS (
      SELECT
        'current_' || e.id AS id,
        e.status AS milestone_type,
        CASE
          WHEN e.status = 'enquiry' THEN e.enquiry_date
          ELSE substr(sh.changed_at, 1, 10)
        END AS milestone_date,
        e.id AS event_id,
        e.event_code,
        e.title,
        e.status,
        e.event_type,
        o.name AS organisation_name,
        e.event_owner,
        (SELECT GROUP_CONCAT(vb.venue, ' · ') FROM venue_bookings vb WHERE vb.event_id = e.id) AS venues,
        NULL AS task_id,
        NULL AS task_title,
        e.is_archived
      FROM events e
      LEFT JOIN organisations o ON o.id = e.organisation_id
      LEFT JOIN event_status_history sh ON sh.id = (
        SELECT latest.id
        FROM event_status_history latest
        WHERE latest.event_id = e.id AND latest.to_status = e.status
        ORDER BY latest.changed_at DESC
        LIMIT 1
      )
      WHERE e.status IN ('enquiry', 'tentative', 'approved', 'confirmed', 'regret', 'cancelled')
    )
    SELECT id, milestone_type, milestone_date, event_id, event_code, title, status, event_type,
           organisation_name, event_owner, venues, task_id, task_title
    FROM lifecycle
    WHERE ${where.join(" AND ")}
    ORDER BY milestone_date,
      CASE milestone_type
        WHEN 'enquiry' THEN 1
        WHEN 'tentative' THEN 2
        WHEN 'approved' THEN 3
        WHEN 'confirmed' THEN 4
        ELSE 10
      END,
      title
    LIMIT 1200`;

  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  const byDate: Record<string, typeof results> = {};
  for (const r of results) {
    const row = r as { milestone_date: string };
    if (!byDate[row.milestone_date]) byDate[row.milestone_date] = [];
    byDate[row.milestone_date]!.push(r);
  }

  return c.json({ entries: results, byDate });
});

calendarRoutes.get("/", requireUser, async (c) => {
  const from = c.req.query("from");
  const to = c.req.query("to");
  const status = c.req.query("status");
  const venue = c.req.query("venue");
  const type = c.req.query("type");
  const owner = c.req.query("owner");
  const q = c.req.query("q");

  if (!from || !to) {
    return c.json({ error: "from and to query params required (yyyy-mm-dd)" }, 400);
  }

  const where = [
    "se.activity_date >= ?",
    "se.activity_date <= ?",
    "e.is_archived = 0",
  ];
  const binds: unknown[] = [from, to];

  if (status) { where.push("e.status = ?"); binds.push(status); }
  if (venue) { where.push("vb.venue = ?"); binds.push(venue); }
  if (type) { where.push("e.event_type = ?"); binds.push(type); }
  if (owner) { where.push("e.event_owner = ?"); binds.push(owner); }
  if (q) {
    where.push("(LOWER(e.title) LIKE ? OR LOWER(COALESCE(o.name, '')) LIKE ? OR LOWER(COALESCE(e.event_code, '')) LIKE ?)");
    const like = `%${q.toLowerCase()}%`;
    binds.push(like, like, like);
  }

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
