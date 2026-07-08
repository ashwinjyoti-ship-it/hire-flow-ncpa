/**
 * Analytics routes — exactly the five requested areas, all `report.view`:
 *   GET /venue-utilisation?from=&to=
 *   GET /inquiry-conversion?from=&to=
 *   GET /payment-tracking?from=&to=
 *   GET /operational-performance?from=&to=
 *   GET /client-profile?from=&to=
 *
 * Counts and rates only — no revenue figures are computed or invented.
 * Default range: the last 90 days up to today (Asia/Kolkata).
 */
import { Hono } from "hono";
import type { AuthEnv } from "../middleware/auth";
import { requirePermission } from "../middleware/auth";
import { istToday } from "../lib/daily-report";

export const analyticsRoutes = new Hono<AuthEnv>();

analyticsRoutes.use("*", requirePermission("report.view"));

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseRange(query: Record<string, string>): { from: string; to: string; days: number } {
  const to = DATE_RE.test(query.to ?? "") ? query.to! : istToday();
  const defaultFrom = new Date(Date.parse(`${to}T00:00:00Z`) - 89 * 86_400_000).toISOString().slice(0, 10);
  const from = DATE_RE.test(query.from ?? "") ? query.from! : defaultFrom;
  const days = Math.max(1, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1);
  return { from, to, days };
}

// 1. Venue utilisation: distinct booked days per venue within the range.
analyticsRoutes.get("/venue-utilisation", async (c) => {
  const range = parseRange(c.req.query());

  const { results: byVenue } = await c.env.DB.prepare(
    `SELECT vb.venue, COUNT(DISTINCT se.activity_date) AS booked_days, COUNT(*) AS entries
     FROM schedule_entries se
     JOIN venue_bookings vb ON vb.id = se.venue_booking_id
     JOIN events e ON e.id = se.event_id
     WHERE se.activity_date BETWEEN ? AND ?
       AND e.is_archived = 0 AND e.status NOT IN ('cancelled','regret')
     GROUP BY vb.venue ORDER BY booked_days DESC`
  ).bind(range.from, range.to).all<{ venue: string; booked_days: number; entries: number }>();

  const { results: byActivity } = await c.env.DB.prepare(
    `SELECT vb.venue, se.activity_type, COUNT(*) AS entries
     FROM schedule_entries se
     JOIN venue_bookings vb ON vb.id = se.venue_booking_id
     JOIN events e ON e.id = se.event_id
     WHERE se.activity_date BETWEEN ? AND ?
       AND e.is_archived = 0 AND e.status NOT IN ('cancelled','regret')
     GROUP BY vb.venue, se.activity_type`
  ).bind(range.from, range.to).all<{ venue: string; activity_type: string; entries: number }>();

  const activityMap: Record<string, Record<string, number>> = {};
  for (const row of byActivity) {
    activityMap[row.venue] ??= {};
    activityMap[row.venue]![row.activity_type] = row.entries;
  }
  const venues = byVenue.map((v) => ({
    ...v,
    utilisation: Math.min(1, v.booked_days / range.days),
    by_activity: activityMap[v.venue] ?? {},
  }));
  return c.json({ ...range, venues });
});

// 2. Inquiry conversion: funnel from enquiry to confirmation, plus sources.
analyticsRoutes.get("/inquiry-conversion", async (c) => {
  const range = parseRange(c.req.query());
  const windowSql = `e.is_archived = 0 AND COALESCE(e.enquiry_date, date(e.created_at)) BETWEEN ? AND ?`;

  const { results: byStatus } = await c.env.DB.prepare(
    `SELECT e.status, COUNT(*) AS count FROM events e WHERE ${windowSql} GROUP BY e.status`
  ).bind(range.from, range.to).all<{ status: string; count: number }>();

  const { results: bySource } = await c.env.DB.prepare(
    `SELECT COALESCE(NULLIF(TRIM(e.enquiry_source), ''), 'Unknown') AS source,
            COUNT(*) AS total,
            SUM(CASE WHEN e.status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed
     FROM events e WHERE ${windowSql}
     GROUP BY 1 ORDER BY total DESC`
  ).bind(range.from, range.to).all<{ source: string; total: number; confirmed: number }>();

  const counts: Record<string, number> = {};
  for (const row of byStatus) counts[row.status] = row.count;
  const total = byStatus.reduce((sum, row) => sum + row.count, 0);
  const confirmed = counts["confirmed"] ?? 0;
  return c.json({
    ...range,
    total_inquiries: total,
    by_status: counts,
    confirmed,
    declined: (counts["regret"] ?? 0) + (counts["cancelled"] ?? 0),
    open_pipeline: (counts["enquiry"] ?? 0) + (counts["tentative"] ?? 0) + (counts["approved"] ?? 0),
    conversion_rate: total ? confirmed / total : 0,
    by_source: bySource,
  });
});

// 3. Payment tracking: checklist payment statuses only — no revenue amounts.
analyticsRoutes.get("/payment-tracking", async (c) => {
  const range = parseRange(c.req.query());

  const { results: byPaymentStatus } = await c.env.DB.prepare(
    `SELECT COALESCE(NULLIF(TRIM(ci.value), ''), 'Not recorded') AS payment_status, COUNT(*) AS count
     FROM events e
     LEFT JOIN checklist_items ci ON ci.event_id = e.id AND ci.field_key = 'payment_status'
     WHERE e.is_archived = 0 AND e.status = 'confirmed'
       AND COALESCE(e.event_start_date, date(e.created_at)) BETWEEN ? AND ?
     GROUP BY 1 ORDER BY count DESC`
  ).bind(range.from, range.to).all<{ payment_status: string; count: number }>();

  const fullPayment = await c.env.DB.prepare(
    `SELECT SUM(CASE WHEN LOWER(TRIM(COALESCE(ci.value,''))) = 'yes' THEN 1 ELSE 0 END) AS received,
            COUNT(*) AS total
     FROM events e
     JOIN checklist_items ci ON ci.event_id = e.id AND ci.field_key = 'full_payment_received'
     WHERE e.is_archived = 0 AND e.status = 'confirmed'
       AND COALESCE(e.event_start_date, date(e.created_at)) BETWEEN ? AND ?`
  ).bind(range.from, range.to).first<{ received: number | null; total: number }>();

  const openInstalments = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count FROM tasks t
     WHERE t.source_rule = 'instalment' AND t.status IN ('open','in_progress')`
  ).first<{ count: number }>();

  return c.json({
    ...range,
    by_payment_status: byPaymentStatus,
    full_payment_received: fullPayment?.received ?? 0,
    tracked_events: fullPayment?.total ?? 0,
    open_instalment_tasks: openInstalments?.count ?? 0,
  });
});

// 4. Operational performance: task throughput + checklist completion.
analyticsRoutes.get("/operational-performance", async (c) => {
  const range = parseRange(c.req.query());
  const today = istToday();

  const { results: taskCounts } = await c.env.DB.prepare(
    `SELECT t.task_type, t.status, COUNT(*) AS count
     FROM tasks t
     WHERE COALESCE(t.due_date, date(t.created_at)) BETWEEN ? AND ?
     GROUP BY t.task_type, t.status`
  ).bind(range.from, range.to).all<{ task_type: string; status: string; count: number }>();

  const overdue = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count FROM tasks t
     WHERE t.status IN ('open','in_progress') AND t.due_date IS NOT NULL AND t.due_date < ?`
  ).bind(today).first<{ count: number }>();

  const completion = await c.env.DB.prepare(
    `SELECT AVG(e.ops_completion) AS ops, AVG(e.accounts_completion) AS accounts, AVG(e.overall_completion) AS overall,
            COUNT(*) AS active_events
     FROM events e
     WHERE e.is_archived = 0 AND e.status NOT IN ('cancelled','regret')
       AND COALESCE(e.event_start_date, date(e.created_at)) BETWEEN ? AND ?`
  ).bind(range.from, range.to).first<{ ops: number | null; accounts: number | null; overall: number | null; active_events: number }>();

  let total = 0;
  let completed = 0;
  const byType: Record<string, Record<string, number>> = {};
  for (const row of taskCounts) {
    byType[row.task_type] ??= {};
    byType[row.task_type]![row.status] = row.count;
    total += row.count;
    if (row.status === "completed") completed += row.count;
  }
  return c.json({
    ...range,
    tasks_total: total,
    tasks_completed: completed,
    task_completion_rate: total ? completed / total : 0,
    tasks_by_type: byType,
    overdue_tasks: overdue?.count ?? 0,
    checklist_completion: {
      operations: completion?.ops ?? 0,
      accounts: completion?.accounts ?? 0,
      overall: completion?.overall ?? 0,
      active_events: completion?.active_events ?? 0,
    },
  });
});

// 5. Client & event profile: who books, what they book, repeat behaviour.
analyticsRoutes.get("/client-profile", async (c) => {
  const range = parseRange(c.req.query());
  const windowSql = `e.is_archived = 0 AND COALESCE(e.event_start_date, date(e.created_at)) BETWEEN ? AND ?`;

  const { results: byEventType } = await c.env.DB.prepare(
    `SELECT COALESCE(NULLIF(TRIM(e.event_type), ''), 'Unspecified') AS event_type, COUNT(*) AS count
     FROM events e WHERE ${windowSql} GROUP BY 1 ORDER BY count DESC`
  ).bind(range.from, range.to).all<{ event_type: string; count: number }>();

  const { results: byOrgType } = await c.env.DB.prepare(
    `SELECT COALESCE(NULLIF(TRIM(o.org_type), ''), 'Unspecified') AS org_type, COUNT(*) AS count
     FROM events e LEFT JOIN organisations o ON o.id = e.organisation_id
     WHERE ${windowSql} GROUP BY 1 ORDER BY count DESC`
  ).bind(range.from, range.to).all<{ org_type: string; count: number }>();

  const { results: topOrganisations } = await c.env.DB.prepare(
    `SELECT o.id, o.name, COUNT(*) AS events,
            SUM(CASE WHEN e.status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed
     FROM events e JOIN organisations o ON o.id = e.organisation_id
     WHERE ${windowSql}
     GROUP BY o.id, o.name ORDER BY events DESC LIMIT 10`
  ).bind(range.from, range.to).all<{ id: string; name: string; events: number; confirmed: number }>();

  const repeat = await c.env.DB.prepare(
    `SELECT SUM(CASE WHEN e.repeat_client = 1 THEN 1 ELSE 0 END) AS repeat_count, COUNT(*) AS total
     FROM events e WHERE ${windowSql}`
  ).bind(range.from, range.to).first<{ repeat_count: number | null; total: number }>();

  return c.json({
    ...range,
    by_event_type: byEventType,
    by_org_type: byOrgType,
    top_organisations: topOrganisations,
    repeat_clients: repeat?.repeat_count ?? 0,
    total_events: repeat?.total ?? 0,
  });
});
