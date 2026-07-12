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
import { EventInput, StatusTransitionInput, type VenueBookingInputT } from "../lib/types";
import { getEventDateIssues } from "../lib/event-date-policy";
import { getPostShowDateWarning } from "../lib/checklist-date-policy";
import { canConfirm, canTransition, requiresOverride, STATUS_LABELS } from "../lib/state-machine";
import type { EventStatus } from "../lib/state-machine";
import { audit, eventActivity } from "../lib/audit";
import { makeId } from "../lib/id";
import { can } from "../lib/rbac";
import {
  blockersForTransition,
  ensureChecklistForEvent,
  getChecklistItems,
  getEventLifecycle,
  reconcileFileToAccountsReminderForEvent,
  reconcileTasksForLifecycleTransition,
  syncAdditionalRequirementsChecklist,
  syncAutomaticTaskOwnerForEvent,
  syncEventReferenceChecklist,
  updateChecklistItem,
} from "../lib/operations";
import { z } from "zod";

export const eventRoutes = new Hono<AuthEnv>();

async function venueBookingSyncStatements(db: D1Database, eventId: string, bookings: VenueBookingInputT[], now: string): Promise<D1PreparedStatement[]> {
  const writes: D1PreparedStatement[] = [];
  const { results: existingBookings } = await db.prepare(
    "SELECT id FROM venue_bookings WHERE event_id = ?"
  ).bind(eventId).all<{ id: string }>();
  const existingBookingIds = new Set(existingBookings.map((row) => row.id));
  const keptBookingIds = new Set<string>();

  for (const [bookingIndex, booking] of bookings.entries()) {
    if (booking.id && !existingBookingIds.has(booking.id)) throw new Error("Venue booking does not belong to this event");
    const bookingId = booking.id ?? makeId("vb");
    keptBookingIds.add(bookingId);

    if (booking.id) {
      writes.push(db.prepare(
        `UPDATE venue_bookings
         SET venue = ?, booking_status = ?, number_of_shows = ?, requirements = ?, notes = ?, sort_order = ?, updated_at = ?
         WHERE id = ? AND event_id = ?`
      ).bind(
        booking.venue, booking.booking_status, booking.number_of_shows,
        booking.requirements ? JSON.stringify(booking.requirements) : null,
        booking.notes ?? null, bookingIndex + 1, now, bookingId, eventId
      ));
    } else {
      writes.push(db.prepare(
        `INSERT INTO venue_bookings (id, event_id, venue, booking_status, number_of_shows,
           requirements, notes, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        bookingId, eventId, booking.venue, booking.booking_status, booking.number_of_shows,
        booking.requirements ? JSON.stringify(booking.requirements) : null,
        booking.notes ?? null, bookingIndex + 1, now, now
      ));
    }

    const { results: existingSchedules } = await db.prepare(
      "SELECT id FROM schedule_entries WHERE venue_booking_id = ? AND event_id = ?"
    ).bind(bookingId, eventId).all<{ id: string }>();
    const existingScheduleIds = new Set(existingSchedules.map((row) => row.id));
    const keptScheduleIds = new Set<string>();

    for (const [scheduleIndex, schedule] of booking.schedule_entries.entries()) {
      if (schedule.id && !existingScheduleIds.has(schedule.id)) throw new Error("Schedule entry does not belong to this venue booking");
      const scheduleId = schedule.id ?? makeId("se");
      keptScheduleIds.add(scheduleId);
      if (schedule.id) {
        writes.push(db.prepare(
          `UPDATE schedule_entries
           SET activity_type = ?, activity_date = ?, start_time = ?, end_time = ?,
               with_ac_start = ?, with_ac_end = ?, with_ac_minutes = ?,
               without_ac_start = ?, without_ac_end = ?, without_ac_minutes = ?,
               notes = ?, sort_order = ?
           WHERE id = ? AND venue_booking_id = ? AND event_id = ?`
        ).bind(
          schedule.activity_type, schedule.activity_date, schedule.start_time ?? null, schedule.end_time ?? null,
          schedule.with_ac_start ?? null, schedule.with_ac_end ?? null, schedule.with_ac_minutes ?? null,
          schedule.without_ac_start ?? null, schedule.without_ac_end ?? null, schedule.without_ac_minutes ?? null,
          schedule.notes ?? null, scheduleIndex + 1, scheduleId, bookingId, eventId
        ));
      } else {
        writes.push(db.prepare(
          `INSERT INTO schedule_entries (id, venue_booking_id, event_id, activity_type, activity_date,
             start_time, end_time, with_ac_start, with_ac_end, with_ac_minutes,
             without_ac_start, without_ac_end, without_ac_minutes, notes, sort_order, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          scheduleId, bookingId, eventId, schedule.activity_type, schedule.activity_date,
          schedule.start_time ?? null, schedule.end_time ?? null,
          schedule.with_ac_start ?? null, schedule.with_ac_end ?? null, schedule.with_ac_minutes ?? null,
          schedule.without_ac_start ?? null, schedule.without_ac_end ?? null, schedule.without_ac_minutes ?? null,
          schedule.notes ?? null, scheduleIndex + 1, now
        ));
      }
    }

    for (const scheduleId of existingScheduleIds) {
      if (!keptScheduleIds.has(scheduleId)) {
        writes.push(db.prepare("DELETE FROM schedule_entries WHERE id = ? AND event_id = ?").bind(scheduleId, eventId));
      }
    }
  }

  for (const bookingId of existingBookingIds) {
    if (keptBookingIds.has(bookingId)) continue;
    writes.push(db.prepare("UPDATE tasks SET venue_booking_id = NULL, updated_at = ? WHERE venue_booking_id = ?").bind(now, bookingId));
    writes.push(db.prepare("UPDATE documents SET venue_booking_id = NULL WHERE venue_booking_id = ?").bind(bookingId));
    writes.push(db.prepare("DELETE FROM schedule_entries WHERE venue_booking_id = ? AND event_id = ?").bind(bookingId, eventId));
    writes.push(db.prepare("DELETE FROM venue_bookings WHERE id = ? AND event_id = ?").bind(bookingId, eventId));
  }
  return writes;
}

async function postShowChecklistIssue(db: D1Database, eventId: string, finalShowDate: string | null): Promise<string | null> {
  if (!finalShowDate) return null;
  const { results } = await db.prepare(
    `SELECT ci.field_key, ci.value
     FROM checklist_items ci
     JOIN checklist_definitions cd ON cd.id = ci.definition_id
     WHERE ci.event_id = ? AND ci.module = 'operations' AND cd.field_type = 'date' AND ci.value IS NOT NULL`
  ).bind(eventId).all<{ field_key: string; value: string | null }>();
  for (const row of results) {
    const warning = getPostShowDateWarning(row.field_key, row.value, finalShowDate);
    if (warning) return warning;
  }
  return null;
}

function nextValueFrom(current: Record<string, unknown>, patch: Record<string, unknown>, key: string): unknown {
  return patch[key] !== undefined ? patch[key] : current[key];
}

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

type DuplicateLookupInput = {
  orgId: string;
  title: string;
  date: string;
  venues?: string[];
  excludeEventId?: string | null;
};

async function findLikelyDuplicateEvents(
  db: D1Database,
  { orgId, title, date, venues = [], excludeEventId }: DuplicateLookupInput,
) {
  const normalisedVenues = Array.from(new Set(venues.map((venue) => venue.trim()).filter(Boolean)));
  const duplicateSignals = ["trim(lower(e.title)) = trim(lower(?))"];
  const binds: unknown[] = [orgId, date, title];

  if (normalisedVenues.length > 0) {
    duplicateSignals.push(`EXISTS (SELECT 1 FROM venue_bookings vb_match WHERE vb_match.event_id = e.id AND vb_match.venue IN (${normalisedVenues.map(() => "?").join(", ")}))`);
    binds.push(...normalisedVenues);
  }

  const where = [
    "e.is_archived = 0",
    "e.organisation_id = ?",
    `${normalisedDateSql("e.event_start_date")} = ?`,
    `(${duplicateSignals.join(" OR ")})`,
  ];
  if (excludeEventId) {
    where.push("e.id != ?");
    binds.push(excludeEventId);
  }

  const sql = `SELECT e.id, e.event_code, e.title, e.status, e.event_type, e.event_start_date, e.event_end_date,
               o.name AS organisation_name,
               (SELECT GROUP_CONCAT(venue, ' · ') FROM venue_bookings WHERE event_id = e.id) AS venues
               FROM events e
               LEFT JOIN organisations o ON o.id = e.organisation_id
               WHERE ${where.join(" AND ")}
               ORDER BY CASE e.status
                 WHEN 'confirmed' THEN 1
                 WHEN 'approved' THEN 2
                 WHEN 'tentative' THEN 3
                 WHEN 'enquiry' THEN 4
                 ELSE 5
               END, e.updated_at DESC
               LIMIT 10`;

  const { results } = await db.prepare(sql).bind(...binds).all();
  return results;
}

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

// GET /duplicates — warn when a likely duplicate event already exists.
eventRoutes.get("/duplicates", requireUser, async (c) => {
  const org = c.req.query("org")?.trim();
  const title = c.req.query("title")?.trim();
  const date = c.req.query("date")?.trim();
  const exclude = c.req.query("exclude")?.trim();
  const venues = c.req.query("venues")?.split("|").map((venue) => venue.trim()).filter(Boolean) ?? [];

  if (!org || !title || !date) return c.json({ duplicates: [] });

  const duplicates = await findLikelyDuplicateEvents(c.env.DB, {
    orgId: org,
    title,
    date,
    venues,
    excludeEventId: exclude,
  });
  return c.json({ duplicates });
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

  if (!d.event_start_date) return c.json({ error: "Event start date is required", field: "event_start_date" }, 422);

  const dateIssue = getEventDateIssues(d)[0];
  if (dateIssue) return c.json({ error: dateIssue.message, field: dateIssue.path }, 422);

  const duplicates = await findLikelyDuplicateEvents(db, {
    orgId: d.organisation_id,
    title: d.title,
    date: d.event_start_date ?? "",
    venues: d.venue_bookings.map((booking) => booking.venue),
  });
  if (duplicates.length > 0) {
    return c.json({
      error: "A possible duplicate already exists for this organisation on that date. Open the existing record or change the event name or venue before saving.",
      duplicates,
    }, 409);
  }

  const insertEvent = db.prepare(
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
  );

  // Initial status history entry.
  const insertHistory = db.prepare(
    `INSERT INTO event_status_history (id, event_id, from_status, to_status, changed_by, changed_at, reason)
     VALUES (?, ?, NULL, 'enquiry', ?, ?, ?)`
  ).bind(makeId("sh"), id, user.id, now, "Event created");

  const createBookings = d.venue_bookings.map((booking) => ({
    ...booking,
    id: undefined,
    schedule_entries: booking.schedule_entries.map((schedule) => ({ ...schedule, id: undefined })),
  }));
  const venueWrites = await venueBookingSyncStatements(db, id, createBookings, now);
  await db.batch([insertEvent, insertHistory, ...venueWrites]);

  await audit({ db, actor: actorFrom(user), action: "event.created", targetType: "event", targetId: id, detail: { title: d.title } });
  await eventActivity(db, id, "created", actorFrom(user).id, { title: d.title });
  await ensureChecklistForEvent(db, id);
  // The event form is the source of truth for requirements — propagate its
  // values into the Operations checklist so newly captured requirements show
  // up on the Operations tab instead of the seeded "Not Required" defaults.
  await syncAdditionalRequirementsChecklist(db, id);
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

  const current = await db.prepare("SELECT * FROM events WHERE id = ? AND is_archived = 0").bind(id).first<Record<string, unknown>>();
  if (!current) return c.json({ error: "Not found" }, 404);
  const validationBookings = d.venue_bookings !== undefined
    ? d.venue_bookings
    : [{ schedule_entries: (await db.prepare(
        "SELECT activity_type, activity_date FROM schedule_entries WHERE event_id = ?"
      ).bind(id).all<{ activity_type: string; activity_date: string }>()).results }];
  const merged = {
    ...current,
    ...d,
    event_start_date: d.event_start_date !== undefined ? d.event_start_date : current.event_start_date as string | null,
    event_end_date: d.event_end_date !== undefined ? d.event_end_date : current.event_end_date as string | null,
    venue_bookings: validationBookings,
  };
  if (d.event_start_date === null) return c.json({ error: "Event start date cannot be cleared", field: "event_start_date" }, 422);
  const dateIssue = getEventDateIssues(merged)[0];
  if (dateIssue) return c.json({ error: dateIssue.message, field: dateIssue.path }, 422);
  const mergedVenues = d.venue_bookings !== undefined
    ? d.venue_bookings.map((booking) => booking.venue)
    : (await db.prepare("SELECT venue FROM venue_bookings WHERE event_id = ?").bind(id).all<{ venue: string }>()).results.map((row) => row.venue);
  const duplicates = await findLikelyDuplicateEvents(db, {
    orgId: String(nextValueFrom(current, d, "organisation_id") ?? ""),
    title: String(nextValueFrom(current, d, "title") ?? ""),
    date: String(merged.event_start_date ?? ""),
    venues: mergedVenues,
    excludeEventId: id,
  });
  if (duplicates.length > 0) {
    return c.json({ error: "A possible duplicate already exists for this organisation on that date.", duplicates }, 409);
  }
  if (d.event_start_date !== undefined || d.event_end_date !== undefined) {
    const finalShowDate = merged.event_end_date ?? merged.event_start_date ?? null;
    const checklistIssue = await postShowChecklistIssue(db, id, finalShowDate);
    if (checklistIssue) return c.json({ error: checklistIssue }, 422);
  }

  const nextValue = (key: string) => nextValueFrom(current, d, key);
  const updateEvent = db.prepare(
    `UPDATE events SET title = ?, description = ?,
       organisation_id = ?, primary_contact_id = ?,
       event_type = ?,
       program_officer = ?,
       event_owner = ?, event_owner_id = ?,
       event_start_date = ?, event_end_date = ?,
       enquiry_source = ?, priority = ?,
       requirements = ?, notes = ?,
       updated_at = ? WHERE id = ?`
  ).bind(
    nextValue("title"), nextValue("description"), nextValue("organisation_id"), nextValue("primary_contact_id"),
    nextValue("event_type"), nextValue("program_officer"), nextValue("event_owner"), nextValue("event_owner_id"),
    merged.event_start_date ?? null, merged.event_end_date ?? null, nextValue("enquiry_source"), nextValue("priority"),
    d.requirements !== undefined ? (d.requirements ? JSON.stringify(d.requirements) : null) : current.requirements,
    nextValue("notes"), now, id
  );

  if (d.venue_bookings !== undefined) {
    let venueWrites: D1PreparedStatement[];
    try {
      venueWrites = await venueBookingSyncStatements(db, id, d.venue_bookings, now);
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400);
    }
    await db.batch([updateEvent, ...venueWrites]);
  } else {
    await updateEvent.run();
  }
  if (d.event_owner_id !== undefined) {
    await syncAutomaticTaskOwnerForEvent(db, id, d.event_owner_id ?? null);
  }
  if (d.event_start_date !== undefined || d.event_end_date !== undefined) {
    await reconcileFileToAccountsReminderForEvent(db, id);
  }

  await audit({ db, actor: actorFrom(user), action: "event.updated", targetType: "event", targetId: id });
  await eventActivity(db, id, "updated", actorFrom(user).id);
  // Keep the Operations checklist's "Event Reference" rows in step with edits to
  // the event (title/type/description) so the Operations tab never lags behind.
  await syncEventReferenceChecklist(db, id);
  // Reconcile the Requirements step with the Operations checklist. Where the
  // form carries a value it wins; form-silent fields leave manual ops edits in
  // place (see syncAdditionalRequirementsChecklist for the field mapping).
  await syncAdditionalRequirementsChecklist(db, id);
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

  // The financials gate fields (costing_email, payment_status) live in the
  // checklist; pull them for the confirmation gate.
  const { results: finRows } = await db.prepare(
    "SELECT field_key, value FROM checklist_items WHERE event_id = ? AND field_key IN ('costing_email', 'payment_status')"
  ).bind(id).all<{ field_key: string; value: string | null }>();
  let costingEmail: string | null = null;
  let paymentStatus: string | null = null;
  for (const row of finRows ?? []) {
    if (row.field_key === "costing_email") costingEmail = row.value ?? null;
    if (row.field_key === "payment_status") paymentStatus = row.value ?? null;
  }

  const from = event.status;
  if (!canTransition(from, to)) {
    return c.json({ error: `Invalid transition: ${STATUS_LABELS[from]} → ${STATUS_LABELS[to]}` }, 422);
  }
  // Confirmation gate: costing email sent, payment received, signed
  // confirmation, and VFH approval — unless approval is marked Not Required.
  if (to === "confirmed" && !canConfirm({
    eventType: event.event_type,
    confirmationStatus: event.confirmation_status,
    approvalStatus: event.approval_status,
    costingEmail,
    paymentStatus,
  })) {
    return c.json({ error: "Confirmation requires costing email sent, payment received, and signed confirmation. VFH events also require approval received or approved (unless approval is marked Not Required)." }, 422);
  }
  const lifecycleBlockers = blockersForTransition({ id, title: "", ...event, costing_email: costingEmail, payment_status: paymentStatus, ops_completion: null, accounts_completion: null, overall_completion: null }, to);
  if (lifecycleBlockers.length > 0) {
    return c.json({ error: lifecycleBlockers.join(" ") }, 422);
  }
  // Cancellation and regret both require a reason.
  if ((to === "cancelled" || to === "regret") && !parsed.data.reason) {
    return c.json({ error: "A reason is required to cancel or decline an event" }, 422);
  }
  // Override-gated transitions require Admin or Venue Manager.
  if (requiresOverride(from, to)) {
    if (!can(user.permissions, "conflict.override")) {
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

  await reconcileTasksForLifecycleTransition(db, id, from, to, user.id);
  await reconcileFileToAccountsReminderForEvent(db, id);

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
