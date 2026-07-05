/**
 * Event API routes.
 *   GET    /events                — list (filters: status, venue, org, type, owner, q, date range)
 *   GET    /events/:id            — detail (with venue bookings, schedule, completion)
 *   POST   /events                — create (with nested venue bookings + schedule entries)
 *   PUT    /events/:id            — update
 *   POST   /events/:id/status     — transition status (state-machine validated)
 *   GET    /events/:id/conflicts  — check venue conflicts for the event
 *   GET    /events/:id/activity   — activity feed
 */
import { Hono } from "hono";
import type { AuthEnv } from "../middleware/auth";
import { requireUser, requirePermission, actorFrom, ipHint } from "../middleware/auth";
import { EventInput, StatusTransitionInput } from "../lib/types";
import { canTransition, requiresOverride, STATUS_LABELS } from "../lib/state-machine";
import type { EventStatus } from "../lib/state-machine";
import { audit, eventActivity } from "../lib/audit";
import { makeId } from "../lib/id";
import { can } from "../lib/rbac";

export const eventRoutes = new Hono<AuthEnv>();

// GET / — list with filters
eventRoutes.get("/", requireUser, async (c) => {
  const { status, venue, org, type, owner, q, from, to } = c.req.query();
  const where: string[] = ["e.is_archived = 0"];
  const binds: unknown[] = [];
  if (status) { where.push("e.status = ?"); binds.push(status); }
  if (venue) { where.push("EXISTS (SELECT 1 FROM venue_bookings vb WHERE vb.event_id = e.id AND vb.venue = ?)"); binds.push(venue); }
  if (org) { where.push("e.organisation_id = ?"); binds.push(org); }
  if (type) { where.push("e.event_type = ?"); binds.push(type); }
  if (owner) { where.push("e.event_owner = ?"); binds.push(owner); }
  if (q) {
    where.push("(LOWER(e.title) LIKE ? OR LOWER(e.event_code) LIKE ? OR LOWER(COALESCE((SELECT name FROM organisations WHERE id = e.organisation_id), '')) LIKE ?)");
    const like = `%${q.toLowerCase()}%`;
    binds.push(like, like, like);
  }
  if (from) { where.push("(e.event_end_date IS NULL OR e.event_end_date >= ?)"); binds.push(from); }
  if (to) { where.push("(e.event_start_date IS NULL OR e.event_start_date <= ?)"); binds.push(to); }

  const sql = `SELECT e.id, e.event_code, e.title, e.status, e.event_type, e.event_start_date, e.event_end_date,
               o.name AS organisation_name, e.event_owner,
               (SELECT GROUP_CONCAT(venue, ' · ') FROM venue_bookings WHERE event_id = e.id) AS venues,
               e.overall_completion
               FROM events e LEFT JOIN organisations o ON o.id = e.organisation_id
               WHERE ${where.join(" AND ")}
               ORDER BY COALESCE(e.event_start_date, '9999') DESC, e.updated_at DESC
               LIMIT 300`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json({ events: results });
});

// GET /:id — full detail
eventRoutes.get("/:id", requireUser, async (c) => {
  const id = c.req.param("id");
  const event = await c.env.DB.prepare(
    `SELECT e.*, o.name AS organisation_name, c.name AS primary_contact_name
     FROM events e
     LEFT JOIN organisations o ON o.id = e.organisation_id
     LEFT JOIN contacts c ON c.id = e.primary_contact_id
     WHERE e.id = ?`
  ).bind(id).first();
  if (!event) return c.json({ error: "Not found" }, 404);

  const { results: venue_bookings } = await c.env.DB.prepare(
    `SELECT vb.*, (SELECT json_group_array(json(se.json)) FROM (
       SELECT json_object('id', id, 'activity_type', activity_type, 'activity_date', activity_date,
         'start_time', start_time, 'end_time', end_time, 'notes', notes, 'sort_order', sort_order) AS json
       FROM schedule_entries WHERE venue_booking_id = vb.id ORDER BY activity_date, sort_order
     ) se) AS schedule_json
     FROM venue_bookings vb WHERE vb.event_id = ? ORDER BY vb.sort_order`
  ).bind(id).all();

  // Parse the schedule JSON strings.
  const bookings = venue_bookings.map((vb) => {
    const raw = (vb as { schedule_json?: string }).schedule_json;
    let schedule: unknown[] = [];
    try {
      schedule = raw ? (JSON.parse(raw) as unknown[]) : [];
    } catch {
      schedule = [];
    }
    const { schedule_json, ...rest } = vb as Record<string, unknown>;
    void schedule_json;
    return { ...rest, schedule_entries: schedule };
  });

  const { results: activity } = await c.env.DB.prepare(
    `SELECT a.*, u.name AS actor_name FROM event_activity a LEFT JOIN users u ON u.id = a.actor_id
     WHERE a.event_id = ? ORDER BY a.created_at DESC LIMIT 100`
  ).bind(id).all();

  return c.json({ event, venue_bookings: bookings, activity });
});

// POST / — create with nested venue bookings + schedule entries
eventRoutes.post("/", requirePermission("event.create"), async (c) => {
  const parsed = EventInput.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Invalid input", detail: parsed.error.flatten() }, 400);
  const db = c.env.DB;
  const user = c.get("user")!;
  const id = makeId("ev");
  const now = new Date().toISOString();
  const d = parsed.data;

  await db.prepare(
    `INSERT INTO events (id, event_code, title, description, organisation_id, primary_contact_id,
       event_type, hiring_category, vertical, program_officer, event_owner, collaboration_details,
       event_start_date, event_end_date, status, form_status, approval_status, confirmation_status,
       enquiry_source, priority, requirements, notes, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'inquiry', 'published', ?, 'none', ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, makeId("code"), d.title, d.description ?? null, d.organisation_id ?? null, d.primary_contact_id ?? null,
    d.event_type ?? null, d.hiring_category ?? null, d.vertical ?? null,
    d.program_officer ?? null, d.event_owner ?? null, d.collaboration_details ?? null,
    d.event_start_date ?? null, d.event_end_date ?? null,
    // Approval status default: pending if VFH else not_required
    d.event_type === "VFH" ? "pending" : "not_required",
    d.enquiry_source ?? null, d.priority,
    d.requirements ? JSON.stringify(d.requirements) : null,
    d.notes ?? null, user.id, now, now
  ).run();

  // Initial status history entry.
  await db.prepare(
    `INSERT INTO event_status_history (id, event_id, from_status, to_status, changed_by, changed_at, reason)
     VALUES (?, ?, NULL, 'inquiry', ?, ?, ?)`
  ).bind(makeId("sh"), id, user.id, now, "Event created").run();

  // Nested venue bookings + schedule entries.
  let vbOrder = 0;
  for (const vb of d.venue_bookings) {
    vbOrder++;
    const vbId = makeId("vb");
    await db.prepare(
      `INSERT INTO venue_bookings (id, event_id, venue, booking_status, number_of_shows, ac_start, ac_end,
         event_duration_minutes, requirements, notes, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      vbId, id, vb.venue, vb.booking_status, vb.number_of_shows, vb.ac_start ?? null, vb.ac_end ?? null,
      vb.event_duration_minutes ?? null,
      vb.requirements ? JSON.stringify(vb.requirements) : null,
      vb.notes ?? null, vbOrder, now, now
    ).run();
    let seOrder = 0;
    for (const se of vb.schedule_entries) {
      seOrder++;
      await db.prepare(
        `INSERT INTO schedule_entries (id, venue_booking_id, event_id, activity_type, activity_date,
           start_time, end_time, notes, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(makeId("se"), vbId, id, se.activity_type, se.activity_date, se.start_time ?? null, se.end_time ?? null, se.notes ?? null, seOrder, now).run();
    }
  }

  await audit({ db, actor: actorFrom(user), action: "event.created", targetType: "event", targetId: id, detail: { title: d.title } });
  await eventActivity(db, id, "created", actorFrom(user).id, { title: d.title });
  return c.json({ id }, 201);
});

// PUT /:id — update
eventRoutes.put("/:id", requirePermission("event.edit"), async (c) => {
  const parsed = EventInput.partial().safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Invalid input" }, 400);
  const db = c.env.DB;
  const user = c.get("user")!;
  const id = c.req.param("id");
  const d = parsed.data;
  const now = new Date().toISOString();

  await db.prepare(
    `UPDATE events SET title = COALESCE(?, title), description = COALESCE(?, description),
       organisation_id = COALESCE(?, organisation_id), primary_contact_id = COALESCE(?, primary_contact_id),
       event_type = COALESCE(?, event_type), hiring_category = COALESCE(?, hiring_category),
       vertical = COALESCE(?, vertical), program_officer = COALESCE(?, program_officer),
       event_owner = COALESCE(?, event_owner), collaboration_details = COALESCE(?, collaboration_details),
       event_start_date = COALESCE(?, event_start_date), event_end_date = COALESCE(?, event_end_date),
       enquiry_source = COALESCE(?, enquiry_source), priority = COALESCE(?, priority),
       requirements = COALESCE(?, requirements), notes = COALESCE(?, notes),
       updated_at = ? WHERE id = ?`
  ).bind(
    d.title ?? null, d.description ?? null, d.organisation_id ?? null, d.primary_contact_id ?? null,
    d.event_type ?? null, d.hiring_category ?? null, d.vertical ?? null,
    d.program_officer ?? null, d.event_owner ?? null, d.collaboration_details ?? null,
    d.event_start_date ?? null, d.event_end_date ?? null, d.enquiry_source ?? null,
    d.priority ?? null,
    d.requirements ? JSON.stringify(d.requirements) : null,
    d.notes ?? null, now, id
  ).run();

  await audit({ db, actor: actorFrom(user), action: "event.updated", targetType: "event", targetId: id });
  await eventActivity(db, id, "updated", actorFrom(user).id);
  return c.json({ ok: true });
});

// POST /:id/status — transition status
eventRoutes.post("/:id/status", requirePermission("event.status.change"), async (c) => {
  const parsed = StatusTransitionInput.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Invalid input" }, 400);
  const db = c.env.DB;
  const user = c.get("user")!;
  const id = c.req.param("id");
  const to = parsed.data.to_status as EventStatus;

  const event = await db.prepare("SELECT status, event_type FROM events WHERE id = ?").bind(id).first<{ status: EventStatus; event_type: string | null }>();
  if (!event) return c.json({ error: "Not found" }, 404);

  const from = event.status;
  if (!canTransition(from, to)) {
    return c.json({ error: `Invalid transition: ${STATUS_LABELS[from]} → ${STATUS_LABELS[to]}` }, 422);
  }
  // Cancellation requires a reason.
  if (to === "cancelled" && !parsed.data.reason) {
    return c.json({ error: "A reason is required to cancel an event" }, 422);
  }
  // Override-gated transitions require Admin or Venue Manager.
  if (requiresOverride(from, to)) {
    if (!can(user.role, "conflict.override")) {
      return c.json({ error: "This transition requires Admin or Venue Manager permission" }, 403);
    }
    if (!parsed.data.reason) {
      return c.json({ error: "A reason is required for this override" }, 422);
    }
  }

  const now = new Date().toISOString();
  await db.prepare("UPDATE events SET status = ?, updated_at = ? WHERE id = ?").bind(to, now, id).run();
  await db.prepare(
    `INSERT INTO event_status_history (id, event_id, from_status, to_status, changed_by, changed_at, reason, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(makeId("sh"), id, from, to, user.id, now, parsed.data.reason ?? null, parsed.data.note ?? null).run();

  await audit({
    db, actor: actorFrom(user), action: "event.status_changed",
    targetType: "event", targetId: id, detail: { from, to, reason: parsed.data.reason },
    ipHint: ipHint(c.req.raw),
  });
  await eventActivity(db, id, "status_changed", actorFrom(user).id, { from, to, reason: parsed.data.reason });
  return c.json({ ok: true, status: to });
});

// GET /:id/conflicts — venue conflict check
eventRoutes.get("/:id/conflicts", requireUser, async (c) => {
  const id = c.req.param("id");
  const event = await c.env.DB.prepare("SELECT id, status FROM events WHERE id = ?").bind(id).first<{ status: string }>();
  if (!event) return c.json({ error: "Not found" }, 404);

  // Find other events that share a venue and have overlapping schedule dates.
  const { results } = await c.env.DB.prepare(
    `SELECT se.activity_date, se.activity_type, se.start_time, se.end_time,
       vb.venue, e.id AS event_id, e.title, e.status
     FROM schedule_entries se
     JOIN venue_bookings vb ON vb.id = se.venue_booking_id
     JOIN events e ON e.id = se.event_id
     WHERE e.id != ? AND e.is_archived = 0 AND e.status NOT IN ('cancelled','rejected')
       AND vb.venue IN (SELECT venue FROM venue_bookings WHERE event_id = ?)
       AND se.activity_date IN (SELECT activity_date FROM schedule_entries WHERE event_id = ?)
     ORDER BY se.activity_date, vb.venue`
  ).bind(id, id, id).all();

  // Classify: confirmed∩confirmed = conflict; otherwise potential.
  const conflicts = results.map((r) => {
    const row = r as { status: string };
    const otherConfirmed = row.status === "confirmed" || row.status === "in_progress";
    const thisConfirmed = event.status === "confirmed" || event.status === "in_progress";
    return { ...r, level: otherConfirmed && thisConfirmed ? "conflict" : "potential" };
  });

  return c.json({ conflicts });
});

// GET /:id/activity — activity feed
eventRoutes.get("/:id/activity", requireUser, async (c) => {
  const id = c.req.param("id");
  const { results } = await c.env.DB.prepare(
    `SELECT a.*, u.name AS actor_name FROM event_activity a LEFT JOIN users u ON u.id = a.actor_id
     WHERE a.event_id = ? ORDER BY a.created_at DESC LIMIT 100`
  ).bind(id).all();
  return c.json({ activity: results });
});
