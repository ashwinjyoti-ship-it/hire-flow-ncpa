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
import { canConfirm, canTransition, requiresOverride, STATUS_LABELS } from "../lib/state-machine";
import type { EventStatus } from "../lib/state-machine";
import { audit, eventActivity } from "../lib/audit";
import { makeId } from "../lib/id";
import { can } from "../lib/rbac";
import {
  blockersForTransition,
  completeTasksForSourceRules,
  ensureChecklistForEvent,
  getChecklistItems,
  getEventLifecycle,
  taskRulesCompletedByLifecycleTransition,
  updateChecklistItem,
} from "../lib/operations";
import { z } from "zod";

export const eventRoutes = new Hono<AuthEnv>();

// GET / — list with filters
eventRoutes.get("/", requireUser, async (c) => {
  const { status, venue, org, type, owner, q, from, to, mine } = c.req.query();
  const user = c.get("user");
  const where: string[] = ["e.is_archived = 0"];
  const binds: unknown[] = [];
  if (status) { where.push("e.status = ?"); binds.push(status); }
  if (venue) { where.push("EXISTS (SELECT 1 FROM venue_bookings vb WHERE vb.event_id = e.id AND vb.venue = ?)"); binds.push(venue); }
  if (org) { where.push("e.organisation_id = ?"); binds.push(org); }
  if (type) { where.push("e.event_type = ?"); binds.push(type); }
  if (owner) { where.push("e.event_owner = ?"); binds.push(owner); }
  // Phase 8b: "My events" — restrict to events owned by the signed-in user.
  if (mine === "1" && user) { where.push("e.event_owner_id = ?"); binds.push(user.id); }
  if (q) {
    where.push("(LOWER(e.title) LIKE ? OR LOWER(e.event_code) LIKE ? OR LOWER(COALESCE((SELECT name FROM organisations WHERE id = e.organisation_id), '')) LIKE ?)");
    const like = `%${q.toLowerCase()}%`;
    binds.push(like, like, like);
  }
  if (from) { where.push("(e.event_end_date IS NULL OR e.event_end_date >= ?)"); binds.push(from); }
  if (to) { where.push("(e.event_start_date IS NULL OR e.event_start_date <= ?)"); binds.push(to); }

  const sql = `SELECT e.id, e.event_code, e.title, e.status, e.event_type, e.event_start_date, e.event_end_date,
               o.name AS organisation_name, e.event_owner, e.event_owner_id,
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
     WHERE e.id = ? AND e.is_archived = 0`
  ).bind(id).first();
  if (!event) return c.json({ error: "Not found" }, 404);

  const { results: venue_bookings } = await c.env.DB.prepare(
    `SELECT vb.*, (SELECT json_group_array(json(se.json)) FROM (
       SELECT json_object('id', id, 'activity_type', activity_type, 'activity_date', activity_date,
         'start_time', start_time, 'end_time', end_time,
         'with_ac_start', with_ac_start, 'with_ac_end', with_ac_end, 'with_ac_minutes', with_ac_minutes,
         'without_ac_start', without_ac_start, 'without_ac_end', without_ac_end, 'without_ac_minutes', without_ac_minutes,
         'notes', notes, 'sort_order', sort_order) AS json
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
       event_type, program_officer, event_owner, event_owner_id,
       event_start_date, event_end_date, status, form_status, approval_status, confirmation_status,
       enquiry_source, priority, requirements, notes, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'enquiry', 'published', ?, 'none', ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, makeId("code"), d.title, d.description ?? null, d.organisation_id, d.primary_contact_id ?? null,
    d.event_type ?? null,
    d.program_officer ?? null, d.event_owner ?? null, d.event_owner_id ?? null,
    d.event_start_date ?? null, d.event_end_date ?? null,
    // Approval status default: not_required for all types. VFH events seed the
    // `approval_required` dropdown as "Not Required" by default, and that
    // drives approval_status via syncEventFieldsFromChecklist — so start
    // aligned. Choosing "Required" on the VFH approval checklist reopens it.
    "not_required",
    d.enquiry_source ?? null, d.priority,
    d.requirements ? JSON.stringify(d.requirements) : null,
    d.notes ?? null, user.id, now, now
  ).run();

  // Initial status history entry.
  await db.prepare(
    `INSERT INTO event_status_history (id, event_id, from_status, to_status, changed_by, changed_at, reason)
     VALUES (?, ?, NULL, 'enquiry', ?, ?, ?)`
  ).bind(makeId("sh"), id, user.id, now, "Event created").run();

  // Nested venue bookings + schedule entries.
  let vbOrder = 0;
  for (const vb of d.venue_bookings) {
    vbOrder++;
    const vbId = makeId("vb");
    await db.prepare(
      `INSERT INTO venue_bookings (id, event_id, venue, booking_status, number_of_shows,
         requirements, notes, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      vbId, id, vb.venue, vb.booking_status, vb.number_of_shows,
      vb.requirements ? JSON.stringify(vb.requirements) : null,
      vb.notes ?? null, vbOrder, now, now
    ).run();
    let seOrder = 0;
    for (const se of vb.schedule_entries) {
      seOrder++;
      await db.prepare(
        `INSERT INTO schedule_entries (id, venue_booking_id, event_id, activity_type, activity_date,
           start_time, end_time,
           with_ac_start, with_ac_end, with_ac_minutes,
           without_ac_start, without_ac_end, without_ac_minutes,
           notes, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        makeId("se"), vbId, id, se.activity_type, se.activity_date,
        se.start_time ?? null, se.end_time ?? null,
        se.with_ac_start ?? null, se.with_ac_end ?? null, se.with_ac_minutes ?? null,
        se.without_ac_start ?? null, se.without_ac_end ?? null, se.without_ac_minutes ?? null,
        se.notes ?? null, seOrder, now
      ).run();
    }
  }

  await audit({ db, actor: actorFrom(user), action: "event.created", targetType: "event", targetId: id, detail: { title: d.title } });
  await eventActivity(db, id, "created", actorFrom(user).id, { title: d.title });
  await ensureChecklistForEvent(db, id);
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
       event_type = COALESCE(?, event_type),
       program_officer = COALESCE(?, program_officer),
       event_owner = COALESCE(?, event_owner), event_owner_id = COALESCE(?, event_owner_id),
       event_start_date = COALESCE(?, event_start_date), event_end_date = COALESCE(?, event_end_date),
       enquiry_source = COALESCE(?, enquiry_source), priority = COALESCE(?, priority),
       requirements = COALESCE(?, requirements), notes = COALESCE(?, notes),
       updated_at = ? WHERE id = ?`
  ).bind(
    d.title ?? null, d.description ?? null, d.organisation_id ?? null, d.primary_contact_id ?? null,
    d.event_type ?? null,
    d.program_officer ?? null, d.event_owner ?? null, d.event_owner_id ?? null,
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

  const event = await db.prepare("SELECT status, event_type, approval_status, confirmation_status FROM events WHERE id = ?").bind(id).first<{
    status: EventStatus;
    event_type: string | null;
    approval_status: string | null;
    confirmation_status: string | null;
  }>();
  if (!event) return c.json({ error: "Not found" }, 404);

  // Amount received lives in the checklist; pull it for the confirmation gate.
  const amountRow = await db.prepare(
    "SELECT value FROM checklist_items WHERE event_id = ? AND field_key = 'amount_received'"
  ).bind(id).first<{ value: string | null }>();
  const amountReceived = amountRow?.value ?? null;

  const from = event.status;
  if (!canTransition(from, to)) {
    return c.json({ error: `Invalid transition: ${STATUS_LABELS[from]} → ${STATUS_LABELS[to]}` }, 422);
  }
  // Confirmation gate: amount received (cross the financials), signed
  // confirmation, and VFH approval — unless approval is marked Not Required.
  if (to === "confirmed" && !canConfirm({
    eventType: event.event_type,
    confirmationStatus: event.confirmation_status,
    approvalStatus: event.approval_status,
    amountReceived,
  })) {
    return c.json({ error: "Confirmation requires amount received, signed confirmation, and VFH events require approval received or approved (unless approval is marked Not Required)." }, 422);
  }
  const lifecycleBlockers = blockersForTransition({ id, title: "", ...event, amount_received: amountReceived, ops_completion: null, accounts_completion: null, overall_completion: null }, to);
  if (lifecycleBlockers.length > 0) {
    return c.json({ error: lifecycleBlockers.join(" ") }, 422);
  }
  // Cancellation and regret both require a reason.
  if ((to === "cancelled" || to === "regret") && !parsed.data.reason) {
    return c.json({ error: "A reason is required to cancel or decline an event" }, 422);
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
  const lifecycleNote = parsed.data.note?.trim() || null;
  const lifecycleReason = parsed.data.reason?.trim() || null;
  await db.prepare("UPDATE events SET status = ?, updated_at = ? WHERE id = ?").bind(to, now, id).run();
  if (to === "confirmed") {
    await db.prepare(
      "UPDATE venue_bookings SET booking_status = 'confirmed', updated_at = ? WHERE event_id = ? AND booking_status != 'confirmed'"
    ).bind(now, id).run();
  }
  await db.prepare(
    `INSERT INTO event_status_history (id, event_id, from_status, to_status, changed_by, changed_at, reason, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(makeId("sh"), id, from, to, user.id, now, lifecycleReason, lifecycleNote).run();

  await completeTasksForSourceRules(
    db,
    id,
    taskRulesCompletedByLifecycleTransition(from, to),
    user.id,
    "Completed automatically from lifecycle transition."
  );

  await audit({
    db, actor: actorFrom(user), action: "event.status_changed",
    targetType: "event", targetId: id, detail: { from, to, reason: lifecycleReason, note: lifecycleNote },
    ipHint: ipHint(c.req.raw),
  });
  await eventActivity(db, id, "status_changed", actorFrom(user).id, { from, to, reason: lifecycleReason, note: lifecycleNote });
  return c.json({ ok: true, status: to });
});

// GET /:id/checklist — per-event checklist grouped by module and lifecycle readiness.
eventRoutes.get("/:id/checklist", requireUser, async (c) => {
  const id = c.req.param("id");
  const [items, lifecycle] = await Promise.all([
    getChecklistItems(c.env.DB, id),
    getEventLifecycle(c.env.DB, id),
  ]);

  const grouped: Record<string, Record<string, unknown[]>> = {};
  for (const item of items) {
    grouped[item.module] ??= {};
    grouped[item.module]![item.section] ??= [];
    grouped[item.module]![item.section]!.push({
      ...item,
      options: item.options ? JSON.parse(item.options) as unknown[] : null,
    });
  }
  return c.json({ checklist: grouped, lifecycle: lifecycle.readiness });
});

const ChecklistUpdateInput = z.object({
  value: z.string().nullish(),
  status: z.enum(["not_started", "in_progress", "completed", "not_applicable", "blocked"]).optional(),
  correction_reason: z.string().nullish(),
});

const EventArchiveInput = z.object({
  keep_org_details: z.boolean().default(true),
});

// DELETE /:id — archive an event record. Organisations and POC/contact details
// are kept intact; event deletion is a record-level action, not client cleanup.
eventRoutes.delete("/:id", requirePermission("event.archive"), async (c) => {
  const parsed = EventArchiveInput.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Invalid input", detail: parsed.error.flatten() }, 400);
  if (!parsed.data.keep_org_details) {
    return c.json({ error: "Organisation and POC details must be kept when deleting an event record." }, 422);
  }

  const db = c.env.DB;
  const user = c.get("user")!;
  const id = c.req.param("id");
  const event = await db.prepare(
    "SELECT id, title, organisation_id, primary_contact_id, is_archived FROM events WHERE id = ?"
  ).bind(id).first<{
    id: string;
    title: string;
    organisation_id: string | null;
    primary_contact_id: string | null;
    is_archived: number;
  }>();
  if (!event || event.is_archived) return c.json({ error: "Not found" }, 404);

  const now = new Date().toISOString();
  await db.prepare("UPDATE events SET is_archived = 1, updated_at = ? WHERE id = ?").bind(now, id).run();
  await db.prepare(
    "UPDATE tasks SET status = 'cancelled', updated_at = ? WHERE event_id = ? AND status IN ('open', 'in_progress')"
  ).bind(now, id).run();

  await audit({
    db,
    actor: actorFrom(user),
    action: "event.archived",
    targetType: "event",
    targetId: id,
    detail: {
      title: event.title,
      keepOrganisationAndPoc: true,
      organisationId: event.organisation_id,
      primaryContactId: event.primary_contact_id,
    },
    ipHint: ipHint(c.req.raw),
  });
  await eventActivity(db, id, "event_archived", user.id, { keepOrganisationAndPoc: true });
  return c.json({ ok: true, archived: true, keptOrganisationAndPoc: true });
});

// PATCH /:id/checklist/:itemId — update a checklist field.
eventRoutes.patch("/:id/checklist/:itemId", requirePermission("checklist.update"), async (c) => {
  const parsed = ChecklistUpdateInput.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Invalid input", detail: parsed.error.flatten() }, 400);
  try {
    const item = await updateChecklistItem({
      db: c.env.DB,
      itemId: c.req.param("itemId"),
      eventId: c.req.param("id"),
      value: parsed.data.value ?? null,
      status: parsed.data.status,
      correctionReason: parsed.data.correction_reason,
      user: c.get("user")!,
    });
    return c.json({ item });
  } catch (err) {
    const message = (err as Error).message;
    const status = message.includes("reason") ? 422 : message.includes("not found") ? 404 : 400;
    return c.json({ error: message }, status);
  }
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
     WHERE e.id != ? AND e.is_archived = 0 AND e.status NOT IN ('cancelled','regret')
       AND vb.venue IN (SELECT venue FROM venue_bookings WHERE event_id = ?)
       AND se.activity_date IN (SELECT activity_date FROM schedule_entries WHERE event_id = ?)
     ORDER BY se.activity_date, vb.venue`
  ).bind(id, id, id).all();

  // Classify: confirmed∩confirmed = conflict; otherwise potential.
  const conflicts = results.map((r) => {
    const row = r as { status: string };
    const otherConfirmed = row.status === "confirmed";
    const thisConfirmed = event.status === "confirmed";
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
