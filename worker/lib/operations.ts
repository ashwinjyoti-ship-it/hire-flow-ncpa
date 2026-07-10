import type { AuthUser } from "../env";
import { eventActivity } from "./audit";
import { makeId } from "./id";
import { canConfirm, canTransition, STATUS_LABELS, type EventStatus } from "./state-machine";

export type ChecklistModule = "operations" | "accounts";

export type ChecklistItemRow = {
  id: string;
  event_id: string;
  definition_id: string;
  module: ChecklistModule;
  section: string;
  field_key: string;
  label: string;
  status: string;
  value: string | null;
  due_date: string | null;
  completed_at: string | null;
  completed_by: string | null;
  last_updated_at: string | null;
  last_updated_by: string | null;
  field_type: string;
  options: string | null;
  is_computed: number;
  triggers_task: string | null;
  visibility_rule: string | null;
  sort_order: number;
};

export type EventLifecycleRow = {
  id: string;
  title: string;
  status: EventStatus;
  event_type: string | null;
  approval_status: string | null;
  confirmation_status: string | null;
  /**
   * Financials gate values pulled from checklist fields (costing_email,
   * payment_status). Surfaced here so the confirmation gate can require them
   * without adding events columns; crossed in as part of lifecycle readiness.
   */
  costing_email?: string | null;
  payment_status?: string | null;
  ops_completion: number | null;
  accounts_completion: number | null;
  overall_completion: number | null;
};

export type LifecycleAction = {
  status: EventStatus;
  label: string;
  allowed: boolean;
  recommended: boolean;
  blockers: string[];
};

export type LifecycleReadiness = {
  current: EventStatus;
  canConfirm: boolean;
  blockers: string[];
  nextAction: LifecycleAction | null;
  actions: LifecycleAction[];
};

const DONE_VALUES = new Set(["yes", "sent", "approved", "received", "completed", "ready", "applicable", "full received"]);
const NOT_APPLICABLE_VALUES = new Set(["not required", "n/a", "n.a.", "not applicable"]);
// Negative / placeholder defaults. A checklist field sitting at one of these is
// "not done" (not_started), not "in progress" — it only counts as done once the
// user marks a positive value. Covers every dropdown default in the seed.
const NOT_DONE_VALUES = new Set([
  "no", "not sent", "incomplete", "not required", "pending", "awaiting",
  "requested", "open", "not ready", "not recorded",
]);

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function normalise(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function itemStatusForValue(item: { field_type: string; value: string | null; is_computed?: number }): string {
  if (item.is_computed) return "not_applicable";
  const value = normalise(item.value);
  if (!value) return "not_started";
  if (NOT_APPLICABLE_VALUES.has(value)) return "not_applicable";
  if (item.field_type === "dropdown" || item.field_type === "status") {
    if (DONE_VALUES.has(value)) return "completed";
    // A negative default is "not started"; only a non-default, non-done value
    // (e.g. an intermediate free-text choice) is "in progress".
    if (NOT_DONE_VALUES.has(value)) return "not_started";
    return "in_progress";
  }
  return "completed";
}

export async function ensureChecklistForEvent(db: D1Database, eventId: string): Promise<void> {
  const event = await db.prepare("SELECT id, event_type FROM events WHERE id = ?").bind(eventId).first<{ id: string; event_type: string | null }>();
  if (!event) throw new Error("Event not found");

  const { results } = await db.prepare(
    `SELECT id, module, section, field_key, label, field_type, default_value, is_computed, sort_order
     FROM checklist_definitions cd
     WHERE (cd.vfh_only = 0 OR ? = 'VFH')
       AND NOT EXISTS (
         SELECT 1
         FROM checklist_items ci
         WHERE ci.event_id = ?
           AND ci.field_key = cd.field_key
       )
     ORDER BY module, sort_order`
  ).bind(event.event_type, eventId).all<{
    id: string;
    module: ChecklistModule;
    section: string;
    field_key: string;
    label: string;
    field_type: string;
    default_value: string | null;
    is_computed: number;
    sort_order: number;
  }>();

  // Backfill the "Event Reference" rows (event_name/type/nature/venue) from the
  // event form's own data. This MUST run before the early-return below: existing
  // events already have all their checklist rows seeded, so `results` is empty
  // and the function would otherwise return without ever syncing — leaving the
  // Operations tab blank for every event created before this fix landed.
  await syncEventReferenceChecklist(db, eventId);

  if (!results.length) return;

  const now = new Date().toISOString();
  for (const def of results) {
    const value = def.default_value ?? null;
    const status = itemStatusForValue({ field_type: def.field_type, value, is_computed: def.is_computed });
    await db.prepare(
      `INSERT OR IGNORE INTO checklist_items
       (id, event_id, definition_id, module, section, field_key, label, status, value, due_date,
        completed_at, completed_by, last_updated_at, last_updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL)`
    ).bind(
      makeId("cli"),
      eventId,
      def.id,
      def.module,
      def.section,
      def.field_key,
      def.label,
      status,
      value,
      def.field_type === "date" ? value : null,
      status === "completed" ? now : null,
      now
    ).run();
  }
  await recalculateEventCompletion(db, eventId);
}

export async function getChecklistItems(db: D1Database, eventId: string): Promise<ChecklistItemRow[]> {
  await ensureChecklistForEvent(db, eventId);
  const { results } = await db.prepare(
    `SELECT ci.*, cd.field_type, cd.options, cd.is_computed, cd.triggers_task, cd.visibility_rule, cd.sort_order
     FROM checklist_items ci
     JOIN checklist_definitions cd ON cd.id = ci.definition_id
     WHERE ci.event_id = ? AND ci.field_key != 'event_status'
     ORDER BY ci.module, cd.sort_order`
  ).bind(eventId).all<ChecklistItemRow>();
  return results;
}

export async function recalculateEventCompletion(db: D1Database, eventId: string): Promise<{ operations: number; accounts: number; overall: number }> {
  const { results } = await db.prepare(
    `SELECT ci.module, ci.status, ci.due_date, cd.is_computed
     FROM checklist_items ci
     JOIN checklist_definitions cd ON cd.id = ci.definition_id
     WHERE ci.event_id = ? AND ci.field_key != 'event_status'`
  ).bind(eventId).all<{ module: ChecklistModule; status: string; due_date: string | null; is_computed: number }>();

  const today = todayIso();
  const counters: Record<ChecklistModule, { done: number; total: number }> = {
    operations: { done: 0, total: 0 },
    accounts: { done: 0, total: 0 },
  };

  for (const item of results) {
    if (item.is_computed) continue;
    if (item.due_date && item.due_date > today && item.status !== "completed") continue;
    counters[item.module].total++;
    if (item.status === "completed" || item.status === "not_applicable") counters[item.module].done++;
  }

  const operations = counters.operations.total ? counters.operations.done / counters.operations.total : 0;
  const accounts = counters.accounts.total ? counters.accounts.done / counters.accounts.total : 0;
  const total = counters.operations.total + counters.accounts.total;
  const done = counters.operations.done + counters.accounts.done;
  const overall = total ? done / total : 0;

  await db.prepare(
    "UPDATE events SET ops_completion = ?, accounts_completion = ?, overall_completion = ?, updated_at = ? WHERE id = ?"
  ).bind(operations, accounts, overall, new Date().toISOString(), eventId).run();

  return { operations, accounts, overall };
}

export async function updateChecklistItem(args: {
  db: D1Database;
  itemId: string;
  eventId?: string;
  value?: string | null;
  status?: string;
  correctionReason?: string | null;
  user: AuthUser;
}): Promise<ChecklistItemRow> {
  const { db, itemId, user } = args;
  const current = await db.prepare(
    `SELECT ci.*, cd.field_type, cd.options, cd.is_computed, cd.triggers_task, cd.visibility_rule, cd.sort_order
     FROM checklist_items ci
     JOIN checklist_definitions cd ON cd.id = ci.definition_id
     WHERE ci.id = ?`
  ).bind(itemId).first<ChecklistItemRow>();
  if (!current) throw new Error("Checklist item not found");
  if (args.eventId && current.event_id !== args.eventId) throw new Error("Checklist item not found");
  if (current.is_computed) throw new Error("Computed checklist fields cannot be edited");

  const now = new Date().toISOString();
  const value = args.value === undefined ? current.value : args.value;
  const status = args.status ?? itemStatusForValue({ field_type: current.field_type, value, is_computed: current.is_computed });
  const dateChanged = current.field_type === "date" && current.value && value && current.value !== value;
  if (dateChanged && !args.correctionReason?.trim()) {
    throw new Error("A correction reason is required to change an existing date");
  }
  const completedAt = status === "completed" && !current.completed_at ? now : status === "completed" ? current.completed_at : null;
  const completedBy = status === "completed" ? current.completed_by ?? user.id : null;
  const dueDate = current.field_type === "date" ? value : current.due_date;

  await db.prepare(
    `UPDATE checklist_items
     SET value = ?, status = ?, due_date = ?, completed_at = ?, completed_by = ?,
         last_updated_at = ?, last_updated_by = ?
     WHERE id = ?`
  ).bind(value ?? null, status, dueDate ?? null, completedAt, completedBy, now, user.id, itemId).run();

  if (dateChanged) {
    await db.prepare(
      `INSERT INTO checklist_corrections (id, checklist_item_id, old_value, new_value, corrected_by, corrected_at, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(makeId("corr"), itemId, current.value, value, user.id, now, args.correctionReason).run();
  }

  await syncEventFieldsFromChecklist(db, current.event_id, current.field_key, value);
  // Mirror requirement checklist edits back into the event form's requirements
  // JSON so the Add/Edit Event form reflects Operations-tab changes. No-op for
  // non-requirement fields (and for req_sound, which is form->checklist only).
  await syncRequirementsFromChecklistItem(db, current.event_id, current.field_key, value ?? null);
  await maybeCreateTaskForChecklistItem(db, { ...current, value: value ?? null, status }, user.id);
  await maybeCompleteTasksForChecklistUpdate(db, current.event_id, current.field_key, value, user.id);
  await recalculateEventCompletion(db, current.event_id);
  await eventActivity(db, current.event_id, "checklist_updated", user.id, {
    field: current.field_key,
    label: current.label,
    value,
    status,
  });

  const updated = await db.prepare(
    `SELECT ci.*, cd.field_type, cd.options, cd.is_computed, cd.triggers_task, cd.visibility_rule, cd.sort_order
     FROM checklist_items ci
     JOIN checklist_definitions cd ON cd.id = ci.definition_id
     WHERE ci.id = ?`
  ).bind(itemId).first<ChecklistItemRow>();
  if (!updated) throw new Error("Checklist item not found after update");
  return updated;
}

async function syncEventFieldsFromChecklist(db: D1Database, eventId: string, fieldKey: string, value: string | null | undefined): Promise<void> {
  const v = normalise(value);
  const now = new Date().toISOString();
  if (fieldKey === "approval_required") {
    // The approval checklist must not impede confirmation when approval is
    // marked Not Required. Drive events.approval_status from this dropdown so
    // the gate (which reads approval_status) honours the user's choice.
    if (v === "not required") {
      await db.prepare("UPDATE events SET approval_status = 'not_required', updated_at = ? WHERE id = ?")
        .bind(now, eventId).run();
    } else if (v === "required") {
      // Reset to pending unless approval has already been received/approved —
      // so choosing "Required" (re)opens the approval thread.
      await db.prepare("UPDATE events SET approval_status = 'pending', updated_at = ? WHERE id = ? AND approval_status NOT IN ('received','approved')")
        .bind(now, eventId).run();
    }
  }
  if (fieldKey === "approval_sent_on" && v) {
    await db.prepare("UPDATE events SET approval_status = 'sent', updated_at = ? WHERE id = ? AND approval_status NOT IN ('received','approved')")
      .bind(now, eventId).run();
  }
  if (fieldKey === "approval_received_on" && v) {
    await db.prepare("UPDATE events SET approval_status = 'received', updated_at = ? WHERE id = ?")
      .bind(now, eventId).run();
  }
  if (fieldKey === "confirmation_made" && v === "yes") {
    await db.prepare("UPDATE events SET confirmation_status = 'made', updated_at = ? WHERE id = ? AND confirmation_status NOT IN ('couriered','signed_received')")
      .bind(now, eventId).run();
  }
  if (fieldKey === "confirmation_couriered" && v) {
    await db.prepare("UPDATE events SET confirmation_status = 'couriered', updated_at = ? WHERE id = ? AND confirmation_status != 'signed_received'")
      .bind(now, eventId).run();
  }
  if (fieldKey === "confirmation_signed_received" && v === "yes") {
    await db.prepare("UPDATE events SET confirmation_status = 'signed_received', updated_at = ? WHERE id = ?")
      .bind(now, eventId).run();
  }
}

/**
 * Mirror the event's own reference data into the Operations checklist's
 * "Event Reference" rows. These fields (event_name, event_type,
 * nature_of_event, venue) are denormalised copies the Operations tab reads via
 * `checklist_items.value`; at create/edit time they were seeded from
 * `default_value` only (NULL for these four), so the Operations tab rendered
 * them blank even though the event form had captured the values.
 *
 * Source-of-truth mapping:
 *   event_name     <- events.title
 *   event_type     <- events.event_type
 *   nature_of_event<- events.description   (no dedicated column; the form's
 *                                            "Description" carries the nature)
 *   venue          <- comma-joined venue_bookings.venue
 *
 * Only rows whose current value is NULL/empty are written, so a user's manual
 * entry is never clobbered. Status is re-derived from the new value so the
 * completion rollups stay accurate. Safe to call repeatedly (idempotent).
 */
export async function syncEventReferenceChecklist(db: D1Database, eventId: string): Promise<void> {
  const event = await db.prepare(
    "SELECT id, title, event_type, description FROM events WHERE id = ?"
  ).bind(eventId).first<{ id: string; title: string; event_type: string | null; description: string | null }>();
  if (!event) return;

  const { results: venues } = await db.prepare(
    "SELECT venue FROM venue_bookings WHERE event_id = ? ORDER BY sort_order, rowid"
  ).bind(eventId).all<{ venue: string }>();
  const venueValue = (venues ?? []).map((v) => v.venue).filter(Boolean).join(", ") || null;

  // field_key -> source value. Skip empty sources so we don't overwrite a real
  // manual checklist value with NULL.
  const fieldToValue: Record<string, string | null> = {
    event_name: event.title?.trim() || null,
    event_type: event.event_type ?? null,
    nature_of_event: event.description?.trim() || null,
    venue: venueValue,
  };

  const now = new Date().toISOString();
  for (const [fieldKey, value] of Object.entries(fieldToValue)) {
    if (!value) continue; // nothing to copy for this field
    // Only update rows that are currently empty — never clobber a manual entry.
    await db.prepare(
      `UPDATE checklist_items
       SET value = ?, status = 'completed', completed_at = COALESCE(completed_at, ?),
           completed_by = COALESCE(completed_by, NULL), last_updated_at = ?
       WHERE event_id = ? AND field_key = ? AND (value IS NULL OR TRIM(value) = '')`
    ).bind(value, now, now, eventId, fieldKey).run();
  }
  await recalculateEventCompletion(db, eventId);
}

/**
 * Sync the event form's "Requirements" step into the Operations checklist's
 * "Additional Requirements" + "Operations Details" sections. The event form is
 * the source of truth, so where the form carries a value we overwrite the
 * matching checklist row; where the form is silent (blank/null) we leave the
 * checklist untouched, preserving any value entered on the Operations tab.
 *
 * Checklist dropdown fields only accept "Required" / "Not Required", so the
 * form's varied values (Yes/No, Keep/Remove, non-empty text for sound/piano)
 * are normalised. The form's note fields (qty/model text) are intentionally
 * not synced — they live only in events.requirements.
 *
 *   field_key                  source (events.requirements)     -> checklist value
 *   req_sound                  sound (free text)               -> Required if set
 *   req_piano                  piano_required (Yes/No)         -> Required/Not Required
 *   req_liquor_license         liquor_licence                  -> as-is
 *   req_orchestra_pit_chairs   orchestra_pit_chairs (Keep/Rm)  -> Required/Not Required
 *   req_digital_standee        digital_standee (Yes/No)        -> Required/Not Required
 *   req_car_display            car_display (Yes/No)            -> Required/Not Required
 *   req_bike_display           bike_display (Yes/No)           -> Required/Not Required
 *   req_stalls                 stalls (Yes/No)                 -> Required/Not Required
 *   req_telecasting_media      telecasting_media (Yes/No)      -> Required/Not Required
 *   no_of_crew_cards           crew_cards (number)             -> the number string
 *   licenses                   licenses (text)                 -> the text
 *
 * Status is re-derived via itemStatusForValue so completion rollups stay
 * accurate (e.g. "Not Required" => not_applicable, off the pending-work list).
 * Safe to call repeatedly (idempotent).
 */
export async function syncAdditionalRequirementsChecklist(db: D1Database, eventId: string): Promise<void> {
  const row = await db.prepare("SELECT requirements FROM events WHERE id = ?")
    .bind(eventId).first<{ requirements: string | null }>();
  if (!row?.requirements) return;

  let reqs: Record<string, unknown>;
  try {
    reqs = JSON.parse(row.requirements) as Record<string, unknown>;
  } catch {
    return;
  }

  const str = (v: unknown): string | null => {
    const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
    return s.length ? s : null;
  };
  // Normalise a form control value to the checklist's Required/Not Required
  // vocabulary. Returns null when the form is silent (leave checklist as-is).
  const toReq = (v: unknown, yesValues: string[]): string | null => {
    const s = str(v);
    if (!s) return null;
    return yesValues.includes(s) ? "Required" : "Not Required";
  };

  type Pending = { fieldKey: string; fieldType: string; value: string | null };
  const updates: Pending[] = [
    // Free-text fields: any non-empty entry counts as "Required".
    { fieldKey: "req_sound", fieldType: "dropdown", value: str(reqs.sound) ? "Required" : null },
    { fieldKey: "req_piano", fieldType: "dropdown", value: toReq(reqs.piano_required, ["Yes"]) },
    { fieldKey: "req_liquor_license", fieldType: "dropdown", value: toReq(reqs.liquor_licence, ["Required"]) },
    { fieldKey: "req_orchestra_pit_chairs", fieldType: "dropdown", value: toReq(reqs.orchestra_pit_chairs, ["Keep"]) },
    { fieldKey: "req_digital_standee", fieldType: "dropdown", value: toReq(reqs.digital_standee, ["Yes"]) },
    { fieldKey: "req_car_display", fieldType: "dropdown", value: toReq(reqs.car_display, ["Yes"]) },
    { fieldKey: "req_bike_display", fieldType: "dropdown", value: toReq(reqs.bike_display, ["Yes"]) },
    { fieldKey: "req_stalls", fieldType: "dropdown", value: toReq(reqs.stalls, ["Yes"]) },
    { fieldKey: "req_telecasting_media", fieldType: "dropdown", value: toReq(reqs.telecasting_media, ["Yes"]) },
    // Operations Details: pass the raw value through.
    { fieldKey: "no_of_crew_cards", fieldType: "number", value: str(reqs.crew_cards) },
    { fieldKey: "licenses", fieldType: "textarea", value: str(reqs.licenses) },
  ];

  const now = new Date().toISOString();
  for (const { fieldKey, fieldType, value } of updates) {
    if (value === null) continue; // form silent — don't clobber a manual ops value
    const status = itemStatusForValue({ field_type: fieldType, value });
    await db.prepare(
      `UPDATE checklist_items
       SET value = ?, status = ?, last_updated_at = ?
       WHERE event_id = ? AND field_key = ?`
    ).bind(value, status, now, eventId, fieldKey).run();
  }
  await recalculateEventCompletion(db, eventId);
}

/**
 * Reverse-sync counterpart to syncAdditionalRequirementsChecklist: when a
 * requirement checklist field is edited on the Operations tab, reflect the
 * change into the event form's `requirements` JSON so the Add/Edit Event form
 * shows it on next open. The event form remains the source of truth; this is
 * the UX nicety that keeps the two views in step without re-typing.
 *
 * The dropdown checklist fields only carry Required/Not Required, so the value
 * is mapped back into the form field's vocabulary (Yes/No, Keep/Remove, …).
 * The round-trip is stable: every inverse value below is one that
 * syncAdditionalRequirementsChecklist accepts back as the same checklist value.
 *
 *   checklist field_key          -> form requirements key    value
 *   req_piano                    -> piano_required           Yes/No
 *   req_liquor_license           -> liquor_licence           Required/Not Required
 *   req_orchestra_pit_chairs     -> orchestra_pit_chairs     Keep/Remove
 *   req_digital_standee          -> digital_standee          Yes/No
 *   req_car_display              -> car_display              Yes/No
 *   req_bike_display             -> bike_display             Yes/No
 *   req_stalls                   -> stalls                   Yes/No
 *   req_telecasting_media        -> telecasting_media        Yes/No
 *   no_of_crew_cards             -> crew_cards               passthrough (number)
 *   licenses                     -> licenses                 passthrough (text)
 *
 * `req_sound` is intentionally NOT reverse-synced: the form field is free text
 * (e.g. "8-channel PA"), which the checklist cannot represent, so sound flows
 * form->checklist only. Any other fieldKey is a no-op.
 *
 * No completion recalc here — the caller (updateChecklistItem) already runs
 * recalculateEventCompletion in its cascade. Safe to call repeatedly.
 */
export async function syncRequirementsFromChecklistItem(
  db: D1Database,
  eventId: string,
  fieldKey: string,
  value: string | null,
): Promise<void> {
  // Inverse map: checklist field_key -> { formKey, affirmative } where the
  // form value is affirmative (or its negation) when the checklist value is
  // "Required" (or "Not Required"). Passthrough fields use a sentinel.
  const YES_NO: Record<string, { formKey: string; affirmative: string; negative: string }> = {
    req_piano: { formKey: "piano_required", affirmative: "Yes", negative: "No" },
    req_liquor_license: { formKey: "liquor_licence", affirmative: "Required", negative: "Not Required" },
    req_orchestra_pit_chairs: { formKey: "orchestra_pit_chairs", affirmative: "Keep", negative: "Remove" },
    req_digital_standee: { formKey: "digital_standee", affirmative: "Yes", negative: "No" },
    req_car_display: { formKey: "car_display", affirmative: "Yes", negative: "No" },
    req_bike_display: { formKey: "bike_display", affirmative: "Yes", negative: "No" },
    req_stalls: { formKey: "stalls", affirmative: "Yes", negative: "No" },
    req_telecasting_media: { formKey: "telecasting_media", affirmative: "Yes", negative: "No" },
  };
  const PASSTHROUGH: Record<string, string> = {
    no_of_crew_cards: "crew_cards",
    licenses: "licenses",
  };

  let formKey: string | null = null;
  let formValue: string | null = null;

  if (fieldKey in YES_NO) {
    const { formKey: fk, affirmative, negative } = YES_NO[fieldKey]!;
    const v = normalise(value);
    if (v === "required") {
      formKey = fk;
      formValue = affirmative;
    } else if (v === "not required") {
      formKey = fk;
      formValue = negative;
    }
    // Any other/empty value: leave the form field as-is (no-op).
  } else if (fieldKey in PASSTHROUGH) {
    const fk = PASSTHROUGH[fieldKey]!;
    const v = value == null ? "" : String(value).trim();
    if (v.length) {
      formKey = fk;
      formValue = v;
    }
  }

  if (formKey === null || formValue === null) return; // nothing to mirror

  const row = await db.prepare("SELECT requirements FROM events WHERE id = ?")
    .bind(eventId).first<{ requirements: string | null }>();
  if (!row) return;

  let reqs: Record<string, unknown>;
  try {
    reqs = row.requirements ? (JSON.parse(row.requirements) as Record<string, unknown>) : {};
  } catch {
    reqs = {};
  }
  reqs[formKey] = formValue;
  await db.prepare("UPDATE events SET requirements = ?, updated_at = ? WHERE id = ?")
    .bind(JSON.stringify(reqs), new Date().toISOString(), eventId).run();
}

export async function maybeCreateTaskForChecklistItem(db: D1Database, item: ChecklistItemRow, createdBy: string | null): Promise<void> {
  if (!item.triggers_task || !normalise(item.value)) return;
  let rule: { rule: string; title: string; due_after_days: number } | null = null;
  try {
    rule = JSON.parse(item.triggers_task) as { rule: string; title: string; due_after_days: number };
  } catch {
    return;
  }
  if (!rule?.rule) return;
  const baseDate = item.due_date ?? todayIso();
  const dueDate = addDays(baseDate, Number(rule.due_after_days ?? 0));
  const idempotency = `checklist:${item.id}:${rule.rule}`;
  const now = new Date().toISOString();

  // Phase 8b: auto-assign the task to the event's owner when one is linked, so
  // the owner's "My tasks" list picks it up. Falls back to unassigned (the
  // notification still routes to the venue_manager role).
  const ownerRow = await db.prepare("SELECT event_owner_id FROM events WHERE id = ?").bind(item.event_id)
    .first<{ event_owner_id: string | null }>();
  const assigneeId = ownerRow?.event_owner_id ?? null;

  await db.prepare(
    `INSERT OR IGNORE INTO tasks
     (id, title, description, event_id, source_checklist_item_id, task_type, source_rule,
      idempotency_key, assignee_id, due_date, priority, status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'automatic', ?, ?, ?, ?, 'medium', 'open', ?, ?, ?)`
  ).bind(
    makeId("task"),
    rule.title,
    `Generated from ${item.label}.`,
    item.event_id,
    item.id,
    rule.rule,
    idempotency,
    assigneeId,
    dueDate,
    createdBy,
    now,
    now
  ).run();

  await createNotification(db, {
    idempotencyKey: `task-created:${idempotency}`,
    recipientId: assigneeId ?? undefined,
    recipientRole: assigneeId ? undefined : "venue_manager",
    title: "Follow-up task created",
    body: `${rule.title} for ${item.label}.`,
    relatedEventId: item.event_id,
  });
}

async function maybeCompleteTasksForChecklistUpdate(db: D1Database, eventId: string, fieldKey: string, value: string | null | undefined, userId: string): Promise<void> {
  const v = normalise(value);
  const rules: string[] = [];
  if (fieldKey === "approval_received_on" && v) rules.push("approval_followup");
  if (fieldKey === "confirmation_signed_received" && v === "yes") rules.push("confirmation_letter");
  if (fieldKey === "onstage_received_from_client" && v) rules.push("onstage");
  if (fieldKey === "feedback_received" && v) rules.push("feedback");
  if (fieldKey === "file_sent_to_accounts" && v) rules.push("send_file_to_accounts");
  if (fieldKey === "final_file_received" && v === "yes") rules.push("accounts_file");
  // Instalment follow-up tasks close out once payment is completed (the team
  // records this via the Payment Status field). Instalment itself never blocks.
  if (fieldKey === "payment_status" && v === "completed") rules.push("instalment");
  if (!rules.length) return;

  await completeTasksForSourceRules(db, eventId, rules, userId, "Completed automatically from checklist update.");
}

export function taskRulesCompletedByLifecycleTransition(from: EventStatus, to: EventStatus): string[] {
  if (from === "confirmed") return [];
  const rules = new Set<string>();
  if (to === "approved" || to === "confirmed") rules.add("approval_followup");
  if (to === "confirmed") rules.add("confirmation_letter");
  return Array.from(rules);
}

export async function completeTasksForSourceRules(
  db: D1Database,
  eventId: string,
  rules: string[],
  userId: string,
  completionNote: string
): Promise<void> {
  if (!rules.length) return;

  const now = new Date().toISOString();
  for (const rule of rules) {
    await db.prepare(
      `UPDATE tasks
       SET status = 'completed', completed_at = ?, completed_by = ?, completion_note = ?, updated_at = ?
       WHERE event_id = ? AND source_rule = ? AND status IN ('open','in_progress')`
    ).bind(now, userId, completionNote, now, eventId, rule).run();
  }
}

async function createFileToAccountsReminders(db: D1Database, today: string, now: string): Promise<number> {
  const { results } = await db.prepare(
    `SELECT e.id AS event_id,
            e.event_end_date,
            e.event_start_date,
            ci.id AS checklist_item_id
     FROM events e
     JOIN checklist_items ci ON ci.event_id = e.id
       AND ci.module = 'accounts'
       AND ci.field_key = 'file_sent_to_accounts'
     WHERE e.status = 'confirmed'
       AND COALESCE(e.event_end_date, e.event_start_date) IS NOT NULL
       AND COALESCE(e.event_end_date, e.event_start_date) < ?
       AND (ci.value IS NULL OR TRIM(ci.value) = '')`
  ).bind(today).all<{
    event_id: string;
    event_end_date: string | null;
    event_start_date: string | null;
    checklist_item_id: string;
  }>();

  let created = 0;
  for (const event of results) {
    const finalShowDate = event.event_end_date ?? event.event_start_date;
    if (!finalShowDate) continue;
    const dueDate = addDays(finalShowDate, 1);
    const inserted = await db.prepare(
      `INSERT OR IGNORE INTO tasks
       (id, title, description, event_id, source_checklist_item_id, task_type, source_rule,
        idempotency_key, due_date, priority, status, created_at, updated_at)
       VALUES (?, 'Send file to accounts', 'Event is over; send the venue hire file to Accounts.',
        ?, ?, 'automatic', 'send_file_to_accounts', ?, ?, ?, 'open', ?, ?)`
    ).bind(
      makeId("task"),
      event.event_id,
      event.checklist_item_id,
      `post-event:${event.event_id}:send-file-to-accounts`,
      dueDate,
      dueDate < today ? "high" : "medium",
      now,
      now
    ).run();
    if (inserted.meta.changes > 0) created++;
  }
  return created;
}

export async function getEventLifecycle(db: D1Database, eventId: string): Promise<{ event: EventLifecycleRow; readiness: LifecycleReadiness }> {
  const event = await db.prepare(
    `SELECT id, title, status, event_type, approval_status, confirmation_status,
            ops_completion, accounts_completion, overall_completion
     FROM events WHERE id = ?`
  ).bind(eventId).first<EventLifecycleRow>();
  if (!event) throw new Error("Event not found");
  // The financials gate fields (costing_email, payment_status) live in the
  // checklist, not on the events row. Pull them through so the confirmation
  // gate can require them.
  const { results: finRows } = await db.prepare(
    `SELECT ci.field_key, ci.value
     FROM checklist_items ci
     WHERE ci.event_id = ? AND ci.field_key IN ('costing_email', 'payment_status')`
  ).bind(eventId).all<{ field_key: string; value: string | null }>();
  for (const row of finRows ?? []) {
    if (row.field_key === "costing_email") event.costing_email = row.value ?? null;
    if (row.field_key === "payment_status") event.payment_status = row.value ?? null;
  }
  return { event, readiness: buildLifecycleReadiness(event) };
}

export function buildLifecycleReadiness(event: EventLifecycleRow): LifecycleReadiness {
  const actions = (Object.keys(STATUS_LABELS) as EventStatus[])
    .filter((status) => canTransition(event.status, status))
    .filter((status) => status !== "approved" || event.event_type === "VFH")
    .map((status) => {
      const blockers = blockersForTransition(event, status);
      return {
        status,
        label: STATUS_LABELS[status],
        allowed: blockers.length === 0,
        recommended: false,
        blockers,
      };
    });

  const preferredOrder: EventStatus[] = event.event_type === "VFH" ? ["approved", "confirmed"] : ["confirmed"];
  const nextAction = actions.find((a) => a.allowed && preferredOrder.includes(a.status)) ?? null;
  if (nextAction) nextAction.recommended = true;
  const confirmBlockers = blockersForTransition(event, "confirmed");
  return {
    current: event.status,
    canConfirm: canConfirm({
      eventType: event.event_type,
      confirmationStatus: event.confirmation_status,
      approvalStatus: event.approval_status,
      costingEmail: event.costing_email ?? null,
      paymentStatus: event.payment_status ?? null,
    }),
    blockers: confirmBlockers,
    nextAction,
    actions,
  };
}

export function blockersForTransition(event: EventLifecycleRow, to: EventStatus): string[] {
  const blockers: string[] = [];
  if (to === "approved") {
    if (event.event_type !== "VFH") {
      blockers.push("Approved is only used for VFH events.");
    } else if (event.approval_status !== "not_required" && !["received", "approved"].includes(event.approval_status ?? "")) {
      blockers.push("VFH approval must be received before marking the event approved.");
    }
  }
  if (to === "confirmed") {
    // Financials gate — costing email = Yes and payment = Completed. These are
    // the first post-inquiry financial steps; instalment tracking does NOT gate.
    if (!event.costing_email || event.costing_email.toLowerCase() !== "yes") {
      blockers.push("Costing email must be sent.");
    }
    if (!event.payment_status || event.payment_status.toLowerCase() !== "completed") {
      blockers.push("Payment must be completed.");
    }
    if (!event.confirmation_status || event.confirmation_status === "none") {
      blockers.push("Confirmation letter must be made.");
    } else if (event.confirmation_status === "made") {
      blockers.push("Confirmation letter must be couriered.");
    } else if (event.confirmation_status !== "signed_received") {
      blockers.push("Signed confirmation must be received.");
    }
    // The approval checklist must not impede confirmation when approval is
    // marked Not Required.
    if (event.event_type === "VFH" && event.approval_status !== "not_required" && !["received", "approved"].includes(event.approval_status ?? "")) {
      blockers.push("VFH approval must be received or approved.");
    }
  }
  return blockers;
}

export type CreateNotificationInput = {
  idempotencyKey: string;
  recipientId?: string | null;
  recipientRole?: string | null;
  title: string;
  body?: string | null;
  relatedEventId?: string | null;
  relatedTaskId?: string | null;
  channel?: "in_app" | "email";
};

export async function createNotification(db: D1Database, input: CreateNotificationInput): Promise<void> {
  await db.prepare(
    `INSERT OR IGNORE INTO notifications
     (id, idempotency_key, recipient_id, recipient_role, title, body, channel,
      related_event_id, related_task_id, email_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    makeId("ntf"),
    input.idempotencyKey,
    input.recipientId ?? null,
    input.recipientRole ?? null,
    input.title,
    input.body ?? null,
    input.channel ?? "in_app",
    input.relatedEventId ?? null,
    input.relatedTaskId ?? null,
    input.channel === "email" ? "pending" : null,
    new Date().toISOString()
  ).run();
}

export async function runOperationalJobs(db: D1Database): Promise<{ tasks: number; notifications: number }> {
  let tasks = 0;
  let notifications = 0;
  const today = todayIso();
  const now = new Date().toISOString();

  const { results: items } = await db.prepare(
    `SELECT ci.*, cd.field_type, cd.options, cd.is_computed, cd.triggers_task, cd.visibility_rule, cd.sort_order
     FROM checklist_items ci
     JOIN checklist_definitions cd ON cd.id = ci.definition_id
     WHERE ci.value IS NOT NULL AND ci.value != '' AND cd.triggers_task IS NOT NULL`
  ).all<ChecklistItemRow>();
  for (const item of items) {
    await maybeCreateTaskForChecklistItem(db, item, null);
    tasks++;
  }

  tasks += await createFileToAccountsReminders(db, today, now);

  const { results: dueTasks } = await db.prepare(
    `SELECT t.id, t.title, t.event_id, t.assignee_id, e.event_owner
     FROM tasks t
     LEFT JOIN events e ON e.id = t.event_id
     WHERE t.status IN ('open','in_progress') AND t.due_date IS NOT NULL AND t.due_date <= ?`
  ).bind(today).all<{ id: string; title: string; event_id: string | null; assignee_id: string | null; event_owner: string | null }>();
  for (const task of dueTasks) {
    await createNotification(db, {
      idempotencyKey: `task-due:${task.id}:${today}`,
      recipientId: task.assignee_id,
      recipientRole: task.assignee_id ? null : "venue_manager",
      title: "Task due",
      body: task.title,
      relatedEventId: task.event_id,
      relatedTaskId: task.id,
    });
    notifications++;
  }

  await db.prepare(
    "INSERT INTO scheduler_runs (ran_at, job, note, rows_affected) VALUES (?, ?, ?, ?)"
  ).bind(now, "operational_jobs", "Created automatic tasks and due notifications", tasks + notifications).run();

  return { tasks, notifications };
}
