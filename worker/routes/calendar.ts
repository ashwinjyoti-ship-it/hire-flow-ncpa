/**
 * Calendar API routes.
 *   GET /calendar?from=&to=&status=&venue=&type=&owner=  — schedule entries in range
 *
 * Returns event blocks keyed by date, with title/venue/status/time/activity.
 */
import { Hono } from "hono";
import type { AuthEnv } from "../middleware/auth";
import { requireUser } from "../middleware/auth";
import { evaluatePocCompletion, getPocFieldValuesForEvents } from "../lib/poc-completion";

export const calendarRoutes = new Hono<AuthEnv>();

function importedMonthSql(raw: string): string {
  return `CASE lower(substr(${raw}, 4, 3))
    WHEN 'jan' THEN '01'
    WHEN 'feb' THEN '02'
    WHEN 'mar' THEN '03'
    WHEN 'apr' THEN '04'
    WHEN 'may' THEN '05'
    WHEN 'jun' THEN '06'
    WHEN 'jul' THEN '07'
    WHEN 'aug' THEN '08'
    WHEN 'sep' THEN '09'
    WHEN 'oct' THEN '10'
    WHEN 'nov' THEN '11'
    WHEN 'dec' THEN '12'
  END`;
}

function normalisedDateSql(raw: string): string {
  const month = importedMonthSql(raw);
  return `CASE
    WHEN ${raw} LIKE '____-__-__%' THEN substr(${raw}, 1, 10)
    WHEN ${raw} LIKE '__-___-____' AND substr(${raw}, 1, 2) BETWEEN '01' AND '31' AND (${month}) IS NOT NULL THEN substr(${raw}, 8, 4) || '-' || (${month}) || '-' || substr(${raw}, 1, 2)
    ELSE NULL
  END`;
}

calendarRoutes.get("/lifecycle", requireUser, async (c) => {
  const from = c.req.query("from");
  const to = c.req.query("to");
  const status = c.req.query("status");
  const venue = c.req.query("venue");
  const type = c.req.query("type");
  const owner = c.req.query("owner");
  const q = c.req.query("q");
  const mine = c.req.query("mine");
  const pocIncomplete = c.req.query("poc_incomplete") === "1";
  const user = c.get("user");

  const where = ["is_archived = 0"];
  const binds: unknown[] = [];

  if (from) { where.push("milestone_date >= ?"); binds.push(from); }
  if (to) { where.push("milestone_date <= ?"); binds.push(to); }

  if (status) { where.push("status = ?"); binds.push(status); }
  if (venue) { where.push("venues LIKE ?"); binds.push(`%${venue}%`); }
  if (type) { where.push("event_type = ?"); binds.push(type); }
  if (owner) { where.push("event_owner = ?"); binds.push(owner); }
  // Phase 8b: "My events" — restrict to events owned by the signed-in user.
  if (mine === "1" && user) { where.push("event_owner_id = ?"); binds.push(user.id); }
  if (q) {
    where.push("(LOWER(title) LIKE ? OR LOWER(COALESCE(organisation_name, '')) LIKE ? OR LOWER(COALESCE(event_code, '')) LIKE ?)");
    const like = `%${q.toLowerCase()}%`;
    binds.push(like, like, like);
  }

  // Dated calendar grids are the pre-confirm pipeline (+ terminal regret/cancelled).
  // Confirmed events live on the Show Calendar. The undated dashboard call still
  // includes confirmed so summary counts and the lifecycle queue stay complete.
  const calendarGrid = Boolean(from || to);
  const lifecycleStatuses = calendarGrid
    ? "('enquiry', 'tentative', 'approved', 'cancelled')"
    : "('enquiry', 'tentative', 'approved', 'confirmed', 'cancelled')";

  const sql = `WITH lifecycle AS (
      SELECT
        'current_' || e.id AS id,
        e.status AS milestone_type,
        CASE
          WHEN e.status = 'enquiry' THEN NULLIF(e.enquiry_date, '')
          ELSE NULLIF(substr(sh.changed_at, 1, 10), '')
        END AS raw_date,
        e.id AS event_id,
        e.event_code,
        e.event_start_date AS raw_event_start_date,
        e.title,
        e.status,
        e.event_type,
        e.created_at,
        o.name AS organisation_name,
        e.event_owner,
        e.event_owner_id,
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
      WHERE e.status IN ${lifecycleStatuses}
    ),
    normalised_dates AS (
      SELECT
        id,
        milestone_type,
        COALESCE(${normalisedDateSql("raw_date")}, date(created_at)) AS milestone_date,
        event_id,
        event_code,
        ${normalisedDateSql("raw_event_start_date")} AS event_start_date,
        title,
        status,
        event_type,
        organisation_name,
        event_owner,
        event_owner_id,
        venues,
        task_id,
        task_title,
        is_archived
      FROM lifecycle
    )
    SELECT id, milestone_type, milestone_date, event_id, event_code, event_start_date, title, status, event_type,
           organisation_name, event_owner, venues, task_id, task_title
    FROM normalised_dates
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
  const eventIds = Array.from(new Set((results ?? []).map((row) => (row as { event_id: string }).event_id)));
  const pocValuesByEvent = await getPocFieldValuesForEvents(c.env.DB, eventIds);
  const orgByEvent = new Map<string, string | null>();
  if (eventIds.length > 0) {
    const placeholders = eventIds.map(() => "?").join(", ");
    const { results: orgRows } = await c.env.DB.prepare(
      `SELECT id, organisation_id FROM events WHERE id IN (${placeholders})`,
    ).bind(...eventIds).all<{ id: string; organisation_id: string | null }>();
    for (const row of orgRows ?? []) {
      orgByEvent.set(row.id, row.organisation_id);
    }
  }

  const enriched = (results ?? []).map((row) => {
    const entry = row as Record<string, unknown> & { event_id: string; status: string };
    const poc = evaluatePocCompletion(pocValuesByEvent.get(entry.event_id) ?? {}, {
      organisationId: orgByEvent.get(entry.event_id) ?? null,
    });
    return {
      ...entry,
      poc_complete: poc.complete,
      poc_filled_count: poc.filledCount,
      poc_total_count: poc.totalCount,
      poc_missing_labels: poc.missingLabels,
    };
  });

  const activeStatuses = new Set(["enquiry", "tentative", "approved"]);
  const filtered = pocIncomplete
    ? enriched.filter((entry) => activeStatuses.has(entry.status) && !entry.poc_complete)
    : enriched;

  const pocIncompleteCount = enriched.filter((entry) => activeStatuses.has(entry.status) && !entry.poc_complete).length;

  const byDate: Record<string, Array<Record<string, unknown>>> = {};
  for (const r of filtered) {
    const milestoneDate = String((r as Record<string, unknown>).milestone_date ?? "");
    if (!byDate[milestoneDate]) byDate[milestoneDate] = [];
    byDate[milestoneDate]!.push(r);
  }

  return c.json({ entries: filtered, byDate, poc_incomplete_count: pocIncompleteCount });
});

calendarRoutes.get("/", requireUser, async (c) => {
  const from = c.req.query("from");
  const to = c.req.query("to");
  const status = c.req.query("status");
  const venue = c.req.query("venue");
  const type = c.req.query("type");
  const owner = c.req.query("owner");
  const q = c.req.query("q");
  const mine = c.req.query("mine");
  const user = c.get("user");

  if (!from || !to) {
    return c.json({ error: "from and to query params required (yyyy-mm-dd)" }, 400);
  }

  // The Show Calendar represents what's committed at the venue. By default it
  // surfaces only confirmed events — enquiries and tentative holds stay on the
  // Lifecycle Calendar, and cancelled/regret stay there too (never "move" here).
  // An explicit status choice from the filter still overrides for inspection,
  // except cancelled/regret which remain Lifecycle-only.
  const requestedStatus = status ?? "confirmed";
  const statusFilter = requestedStatus === "cancelled" || requestedStatus === "regret"
    ? "confirmed"
    : requestedStatus;

  // The calendar must not require schedule entries (setup/rehearsal/show rows
  // with AC timings) before a confirmed event earns a card. Those details are
  // normally filled in *after* confirmation; an event created with just the
  // required fields (org, name, venue, type, operating-window date) and
  // advanced to Confirmed must still appear. We therefore surface two row sets:
  //   (1) enriched rows driven by schedule_entries (when present), and
  //   (2) date-anchored rows for confirmed events that have NO schedule entries
  //       — keyed on the event's operating window, one card per in-range day.
  // The two sets are UNIONed and share the same column shape.

  // Common filters that apply to both sets.
  const commonWhere = ["e.is_archived = 0", "e.status = ?"];
  const commonBinds: unknown[] = [statusFilter];
  if (type) { commonWhere.push("e.event_type = ?"); commonBinds.push(type); }
  if (owner) { commonWhere.push("e.event_owner = ?"); commonBinds.push(owner); }
  // Phase 8b: "My events" — restrict to events owned by the signed-in user.
  if (mine === "1" && user) { commonWhere.push("e.event_owner_id = ?"); commonBinds.push(user.id); }
  if (q) {
    commonWhere.push("(LOWER(e.title) LIKE ? OR LOWER(COALESCE(o.name, '')) LIKE ? OR LOWER(COALESCE(e.event_code, '')) LIKE ?)");
    const like = `%${q.toLowerCase()}%`;
    commonBinds.push(like, like, like);
  }

  // ---- Set 1: schedule-entry-driven (enriched) rows ----
  const scheduleActivityDateExpr = normalisedDateSql("se.activity_date");
  const seWhere = [
    `${scheduleActivityDateExpr} >= ?`,
    `${scheduleActivityDateExpr} <= ?`,
    ...commonWhere,
  ];
  const seBinds: unknown[] = [from, to, ...commonBinds];
  if (venue) { seWhere.push("vb.venue = ?"); seBinds.push(venue); }

  // ---- Set 2: date-anchored rows for events with no schedule entries ----
  // An event's operating window must overlap the viewed [from, to] range. If a
  // confirmed import has no operating date, fall back to the date it entered
  // its current confirmed lifecycle state, then to creation date. That keeps
  // confirmed lifecycle records visible on the Show Calendar while the team
  // fills in the final show metadata.
  const showDateExpr = `COALESCE(${normalisedDateSql("e.event_start_date")}, ${normalisedDateSql("substr(sh.changed_at, 1, 10)")}, date(e.created_at))`;
  const eventEndExpr = `COALESCE(${normalisedDateSql("e.event_end_date")}, ${showDateExpr})`;
  const evWhere = [
    `${eventEndExpr} >= ?`,
    `${showDateExpr} <= ?`,
    ...commonWhere,
    // Only events that have NO schedule entries at all belong in this set —
    // otherwise they'd be double-counted with set 1.
    "NOT EXISTS (SELECT 1 FROM schedule_entries se2 WHERE se2.event_id = e.id)",
  ];
  const evBinds: unknown[] = [from, to, ...commonBinds];
  if (venue) { evWhere.push("vb.venue = ?"); evBinds.push(venue); }

  const columnList = `se.id, se.activity_type, ${scheduleActivityDateExpr} AS activity_date, se.start_time, se.end_time,
      se.with_ac_start, se.with_ac_end, se.with_ac_minutes,
      se.without_ac_start, se.without_ac_end, se.without_ac_minutes,
      se.notes AS schedule_notes,
      e.id AS event_id, e.event_code, e.title, e.status, e.event_type, e.event_owner,
      u.email AS event_owner_email,
      e.description, e.requirements AS event_requirements, e.notes AS event_notes,
      o.name AS organisation_name,
      vb.venue, vb.booking_status, vb.number_of_shows, vb.requirements, vb.notes AS venue_notes`;

  // Set 2: one card per (event × venue_booking) for confirmed events with no
  // schedule entries. activity_date is the best available show date clamped
  // into the viewed range. This avoids a recursive date spine — simpler and
  // robust on D1 — while still surfacing the event under its show month. `from`
  // is a validated yyyy-mm-dd string, so it is inlined as a quoted literal
  // (single statement bind order stays simple).
  const fromLit = `'${from}'`;
  const sql = `SELECT NULL AS id, 'show' AS activity_type,
      MAX(${fromLit}, ${showDateExpr}) AS activity_date,
      NULL AS start_time, NULL AS end_time,
      NULL AS with_ac_start, NULL AS with_ac_end, NULL AS with_ac_minutes,
      NULL AS without_ac_start, NULL AS without_ac_end, NULL AS without_ac_minutes,
      NULL AS schedule_notes,
      e.id AS event_id, e.event_code, e.title, e.status, e.event_type, e.event_owner,
      u.email AS event_owner_email,
      e.description, e.requirements AS event_requirements, e.notes AS event_notes,
      o.name AS organisation_name,
      COALESCE(vb.venue, 'No venue') AS venue, vb.booking_status, vb.number_of_shows, vb.requirements, vb.notes AS venue_notes
    FROM events e
    LEFT JOIN event_status_history sh ON sh.id = (
      SELECT latest.id
      FROM event_status_history latest
      WHERE latest.event_id = e.id AND latest.to_status = e.status
      ORDER BY latest.changed_at DESC
      LIMIT 1
    )
    LEFT JOIN venue_bookings vb ON vb.event_id = e.id
    LEFT JOIN organisations o ON o.id = e.organisation_id
    LEFT JOIN users u ON u.id = e.event_owner_id
    WHERE ${evWhere.join(" AND ")}
  UNION ALL
  SELECT ${columnList}
    FROM schedule_entries se
    JOIN events e ON e.id = se.event_id
    JOIN venue_bookings vb ON vb.id = se.venue_booking_id
    LEFT JOIN organisations o ON o.id = e.organisation_id
    LEFT JOIN users u ON u.id = e.event_owner_id
    WHERE ${seWhere.join(" AND ")}
  ORDER BY activity_date, venue, start_time
  LIMIT 1000`;

  const { results } = await c.env.DB.prepare(sql).bind(...evBinds, ...seBinds).all();

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
