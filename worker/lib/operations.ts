import type { AuthUser } from "../env";
import { eventActivity } from "./audit";
import { isCateringMealPaxKey } from "./catering-meals";
import {
  deriveExecutionSectionStatus,
  EXECUTION_SECTIONS,
  shouldPreserveExecutionSectionValue,
} from "./requirement-sections";
import { isChecklistFieldVisible, type ChecklistVisibilityItem } from "./checklist-visibility";
import { dueAfterDaysForRule, getChecklistIntervals } from "./checklist-intervals";
import { getPostShowDateWarning } from "./checklist-date-policy";
import { calculateEventFormReadiness, readinessTaskCopy, readinessTaskRule } from "./event-readiness";
import { parseVenueBookingsForReadiness, VENUE_BOOKINGS_FOR_READINESS_SQL } from "./venue-schedule-readiness";
import {
  areFinancialsReadyForConfirmationLetterDelivery,
  CONFIRMATION_COURIERED_REQUIRES_MADE_MESSAGE,
  CONFIRMATION_LETTER_REQUIRES_FINANCIALS_MESSAGE,
  CONFIRMATION_SIGNED_REQUIRES_COURIERED_MESSAGE,
  COSTING_EMAIL_BLOCKER,
  hasInvalidPaymentBeforeCosting,
  hasInvalidPaymentBeforeProforma,
  hasInvalidProformaBeforeCosting,
  isAdvancingConfirmationLetterDelivery,
  isConfirmationLetterCouriered,
  isConfirmationLetterDeliveryField,
  isConfirmationLetterMade,
  isCostingEmailSent,
  isPaymentGateSatisfied,
  isPaymentMarkedCompleted,
  isProformaMarkedSent,
  isProformaSatisfiedForConfirmationLetter,
  PAYMENT_COMPLETED_BLOCKER,
  PAYMENT_REQUIRES_COSTING_MESSAGE,
  PAYMENT_REQUIRES_PROFORMA_MESSAGE,
  PROFORMA_SENT_REQUIRES_COSTING_MESSAGE,
} from "./financial-sequence";
import { makeId } from "./id";
import {
  accountsStartDate,
  canGenerateTaskForPhase,
  finalShowDate,
  getActiveWorkflowPhase,
  isFileClosedValue,
  type LifecycleWorkflowPhase,
  WORKFLOW_PHASE_LABELS,
  workflowPhaseForTaskRule,
} from "./lifecycle-workflow-phase";
import { POC_FIELD_KEYS } from "./poc-fields";
import {
  evaluatePocCompletionForEvent,
  POC_CONFIRMATION_BLOCKER,
  POC_TASK_RULE,
  POC_TASK_TITLE,
} from "./poc-completion";
import { canConfirm, canTransition, STATUS_LABELS, type EventStatus } from "./state-machine";

export {
  accountsStartDate,
  finalShowDate,
  getActiveWorkflowPhase,
  isFileClosedValue,
  WORKFLOW_PHASE_LABELS,
  type LifecycleWorkflowPhase,
};

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
  poc_complete?: boolean;
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

export type LifecycleWorkflowSnapshot = {
  activePhase: LifecycleWorkflowPhase;
  label: string;
  firstShowDate: string | null;
  finalShowDate: string | null;
  accountsStartDate: string | null;
  fileClosed: boolean;
};

/** Resolve the single active lifecycle workflow phase for an event. */
export async function resolveEventWorkflowPhase(
  db: D1Database,
  eventId: string,
  today = todayIso(),
): Promise<LifecycleWorkflowSnapshot | null> {
  const event = await db.prepare(
    `SELECT status, event_start_date, event_end_date FROM events WHERE id = ? AND is_archived = 0`
  ).bind(eventId).first<{
    status: string;
    event_start_date: string | null;
    event_end_date: string | null;
  }>();
  if (!event) return null;

  const closedRow = await db.prepare(
    `SELECT value FROM checklist_items WHERE event_id = ? AND field_key = 'file_closed' LIMIT 1`
  ).bind(eventId).first<{ value: string | null }>();
  const fileClosed = isFileClosedValue(closedRow?.value);
  const activePhase = getActiveWorkflowPhase({
    status: event.status,
    eventStartDate: event.event_start_date,
    eventEndDate: event.event_end_date,
    fileClosed,
  }, today);
  const firstShow = event.event_start_date ?? null;
  const finalShow = finalShowDate(event.event_start_date, event.event_end_date);
  return {
    activePhase,
    label: WORKFLOW_PHASE_LABELS[activePhase],
    firstShowDate: firstShow,
    finalShowDate: finalShow,
    accountsStartDate: accountsStartDate(event.event_start_date, event.event_end_date),
    fileClosed,
  };
}

async function cancelOpenTasksOutsidePhase(
  db: D1Database,
  eventId: string,
  activePhase: LifecycleWorkflowPhase,
): Promise<number> {
  const { results } = await db.prepare(
    `SELECT id, source_rule FROM tasks
     WHERE event_id = ? AND task_type = 'automatic' AND status IN ('open','in_progress')
       AND source_rule IS NOT NULL`
  ).bind(eventId).all<{ id: string; source_rule: string }>();

  const now = new Date().toISOString();
  let changed = 0;
  for (const task of results ?? []) {
    if (canGenerateTaskForPhase(task.source_rule, activePhase)) continue;
    // Only cancel rules we explicitly phase-map; leave unknown automatic tasks alone.
    if (!workflowPhaseForTaskRule(task.source_rule)) continue;
    await db.prepare(
      `UPDATE tasks
       SET status = 'cancelled',
           completion_note = ?,
           updated_at = ?
       WHERE id = ? AND status IN ('open','in_progress')`
    ).bind(
      `Cancelled automatically because the ${WORKFLOW_PHASE_LABELS[activePhase]} workflow is active.`,
      now,
      task.id,
    ).run();
    changed += 1;
  }
  return changed;
}

/** Cancel open auto-tasks that do not belong to the event's active workflow phase. */
export async function reconcileWorkflowPhaseTasksForEvent(
  db: D1Database,
  eventId: string,
  today = todayIso(),
): Promise<number> {
  const snapshot = await resolveEventWorkflowPhase(db, eventId, today);
  if (!snapshot) return 0;
  return cancelOpenTasksOutsidePhase(db, eventId, snapshot.activePhase);
}

const DONE_VALUES = new Set(["yes", "sent", "approved", "received", "completed", "ready", "applicable", "full received", "verified", "refunded", "payment processed"]);
const NOT_APPLICABLE_VALUES = new Set(["not required", "n/a", "n.a.", "not applicable", "no applicable"]);
// Negative / placeholder defaults. A checklist field sitting at one of these is
// "not done" (not_started), not "in progress" — it only counts as done once the
// user marks a positive value. Covers every dropdown default in the seed.
const NOT_DONE_VALUES = new Set([
  "no", "not sent", "incomplete", "not required", "pending", "awaiting",
  "requested", "open", "not ready", "not recorded", "not started", "not received",
]);
const IN_PROGRESS_VALUES = new Set(["captured on form"]);

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetweenIso(fromIso: string, toIso: string): number {
  return Math.round(
    (new Date(`${toIso}T00:00:00.000Z`).getTime() - new Date(`${fromIso}T00:00:00.000Z`).getTime()) / 86_400_000
  );
}

const ACCOUNTS_FILE_TRACKING_KEYS = [
  "file_sent_to_accounts",
  "file_received_back_edit_1",
  "file_sent_back_after_edit_1",
  "file_received_back_edit_2",
  "file_sent_back_after_edit_2",
  "final_file_received",
] as const;

type AccountsFileTrackingKey = (typeof ACCOUNTS_FILE_TRACKING_KEYS)[number];
type AccountsFileTracking = Record<AccountsFileTrackingKey, string | null>;

async function getAccountsFileTracking(db: D1Database, eventId: string): Promise<AccountsFileTracking> {
  const tracking = Object.fromEntries(ACCOUNTS_FILE_TRACKING_KEYS.map((key) => [key, null])) as AccountsFileTracking;
  const placeholders = ACCOUNTS_FILE_TRACKING_KEYS.map(() => "?").join(", ");
  const { results } = await db.prepare(
    `SELECT field_key, value FROM checklist_items
     WHERE event_id = ? AND field_key IN (${placeholders})`
  ).bind(eventId, ...ACCOUNTS_FILE_TRACKING_KEYS).all<{ field_key: string; value: string | null }>();
  for (const row of results ?? []) {
    const trimmed = row.value?.trim();
    if (trimmed) tracking[row.field_key as AccountsFileTrackingKey] = trimmed;
  }
  return tracking;
}

async function getChecklistItemIdByFieldKey(db: D1Database, eventId: string, fieldKey: string): Promise<string | null> {
  const row = await db.prepare("SELECT id FROM checklist_items WHERE event_id = ? AND field_key = ?")
    .bind(eventId, fieldKey).first<{ id: string }>();
  return row?.id ?? null;
}

async function completeAutomaticTasksForChecklistItem(
  db: D1Database,
  eventId: string,
  checklistItemId: string,
  rules: string[],
  userId: string,
  completionNote: string,
): Promise<void> {
  if (!rules.length) return;
  const now = new Date().toISOString();
  for (const rule of rules) {
    await db.prepare(
      `UPDATE tasks
       SET status = 'completed', completed_at = ?, completed_by = ?, completion_note = ?, updated_at = ?
       WHERE event_id = ? AND source_checklist_item_id = ? AND source_rule = ?
         AND status IN ('open','in_progress')`
    ).bind(now, userId, completionNote, now, eventId, checklistItemId, rule).run();
  }
}

async function cancelAutomaticTasksForChecklistItem(
  db: D1Database,
  eventId: string,
  checklistItemId: string,
  rules: string[],
  reason: string,
): Promise<void> {
  if (!rules.length) return;
  const now = new Date().toISOString();
  for (const rule of rules) {
    await db.prepare(
      `UPDATE tasks
       SET status = 'cancelled', completion_note = ?, updated_at = ?
       WHERE event_id = ? AND source_checklist_item_id = ? AND source_rule = ?
         AND status IN ('open','in_progress')`
    ).bind(reason, now, eventId, checklistItemId, rule).run();
  }
}

export async function maybeCompleteAccountsFileTasks(
  db: D1Database,
  eventId: string,
  fieldKey: string,
  value: string | null | undefined,
  userId: string,
): Promise<void> {
  if (!(ACCOUNTS_FILE_TRACKING_KEYS as readonly string[]).includes(fieldKey)) return;

  const trimmed = (value ?? "").trim();
  const note = "Completed automatically from checklist update.";

  if (fieldKey === "final_file_received") {
    if (trimmed) {
      await completeTasksForSourceRules(db, eventId, ["accounts_file", "accounts_file_send_back"], userId, note);
    } else {
      await reopenAutomaticallyCompletedTasks(db, eventId, ["accounts_file", "accounts_file_send_back"]);
    }
    return;
  }

  if (!trimmed) return;

  if (fieldKey === "file_received_back_edit_1") {
    const sentItemId = await getChecklistItemIdByFieldKey(db, eventId, "file_sent_to_accounts");
    if (sentItemId) {
      await completeAutomaticTasksForChecklistItem(db, eventId, sentItemId, ["accounts_file"], userId, note);
    }
    return;
  }

  if (fieldKey === "file_sent_back_after_edit_1") {
    const edit1ItemId = await getChecklistItemIdByFieldKey(db, eventId, "file_received_back_edit_1");
    if (edit1ItemId) {
      await completeAutomaticTasksForChecklistItem(db, eventId, edit1ItemId, ["accounts_file_send_back"], userId, note);
    }
    return;
  }

  if (fieldKey === "file_received_back_edit_2") {
    const sentBack1ItemId = await getChecklistItemIdByFieldKey(db, eventId, "file_sent_back_after_edit_1");
    if (sentBack1ItemId) {
      await completeAutomaticTasksForChecklistItem(db, eventId, sentBack1ItemId, ["accounts_file"], userId, note);
    }
    return;
  }

  if (fieldKey === "file_sent_back_after_edit_2") {
    const edit2ItemId = await getChecklistItemIdByFieldKey(db, eventId, "file_received_back_edit_2");
    if (edit2ItemId) {
      await completeAutomaticTasksForChecklistItem(db, eventId, edit2ItemId, ["accounts_file_send_back"], userId, note);
    }
  }
}

function normalise(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function itemStatusForValue(item: { field_type: string; value: string | null; is_computed?: number }, today = todayIso()): string {
  if (item.is_computed) {
    const computed = (item.value ?? "").trim();
    if (!computed || computed === "—") return "not_started";
    return "completed";
  }
  const value = normalise(item.value);
  if (!value) return "not_started";
  if (NOT_APPLICABLE_VALUES.has(value)) return "not_applicable";
  if (item.field_type === "dropdown" || item.field_type === "status") {
    if (DONE_VALUES.has(value)) return "completed";
    if (IN_PROGRESS_VALUES.has(value)) return "in_progress";
    // A negative default is "not started"; only a non-default, non-done value
    // (e.g. an intermediate free-text choice) is "in progress".
    if (NOT_DONE_VALUES.has(value)) return "not_started";
    return "in_progress";
  }
  if (item.field_type === "date") return value <= today ? "completed" : "in_progress";
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

  if (!results.length) {
    // Heal Approval dependents for existing VFH events (idempotent).
    await syncApprovalDependentChecklistFromEvent(db, eventId);
    await syncNocDependentChecklistFromEvent(db, eventId);
    await syncTdsDependentChecklistFromEvent(db, eventId);
    await syncOnstageDependentChecklistFromEvent(db, eventId);
    await syncEmailerDependentChecklistFromEvent(db, eventId);
    await syncInstalmentDependentChecklistFromEvent(db, eventId);
    await recalculateEventCompletion(db, eventId);
    return;
  }

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
  // After seeding, mark Approval dependents N/A when default is Not Required.
  await syncApprovalDependentChecklistFromEvent(db, eventId);
  await syncNocDependentChecklistFromEvent(db, eventId);
  await syncTdsDependentChecklistFromEvent(db, eventId);
  await syncOnstageDependentChecklistFromEvent(db, eventId);
  await syncEmailerDependentChecklistFromEvent(db, eventId);
  await syncInstalmentDependentChecklistFromEvent(db, eventId);
  await syncEventReferenceChecklist(db, eventId);
  await recalculateEventCompletion(db, eventId);
}

export async function getChecklistItems(db: D1Database, eventId: string): Promise<ChecklistItemRow[]> {
  await ensureChecklistForEvent(db, eventId);
  // Heal Completed payment stored while Costing Email is still No so the
  // Financials UI does not show a green COMPLETED badge for an invalid sequence.
  await reconcileFinancialSequenceForEvent(db, eventId);
  // Heal Couriered / Signed set while financials are still incomplete.
  await reconcileConfirmationLetterAgainstFinancials(db, eventId);
  await reconcileConfirmationLetterDeliveryChain(db, eventId);
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
    `SELECT ci.module, ci.status, ci.due_date, ci.field_key, ci.value, cd.is_computed, cd.visibility_rule
     FROM checklist_items ci
     JOIN checklist_definitions cd ON cd.id = ci.definition_id
     WHERE ci.event_id = ? AND ci.field_key != 'event_status'`
  ).bind(eventId).all<{
    module: ChecklistModule;
    status: string;
    due_date: string | null;
    field_key: string;
    value: string | null;
    is_computed: number;
    visibility_rule: string | null;
  }>();

  const visibilityByKey = new Map<string, ChecklistVisibilityItem>(
    results.map((item) => [item.field_key, {
      field_key: item.field_key,
      value: item.value,
      visibility_rule: item.visibility_rule,
    }]),
  );

  const today = todayIso();
  const counters: Record<ChecklistModule, { done: number; total: number }> = {
    operations: { done: 0, total: 0 },
    accounts: { done: 0, total: 0 },
  };

  for (const item of results) {
    if (item.is_computed) continue;
    if (!isChecklistFieldVisible(item, visibilityByKey)) continue;
    if (item.due_date && item.due_date > today && item.status !== "completed") continue;
    // not_applicable means the field does not apply to this event (hidden gates,
    // N/A defaults, etc.) — exclude it from the rollup so untouched work does
    // not show fake progress.
    if (item.status === "not_applicable") continue;
    counters[item.module].total++;
    if (item.status === "completed") counters[item.module].done++;
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

  // Financial sequence: Proforma Sent requires Costing Email = Yes.
  if (current.field_key === "proforma_invoice" && isProformaMarkedSent(value)) {
    const costing = await db.prepare(
      "SELECT value FROM checklist_items WHERE event_id = ? AND field_key = 'costing_email' LIMIT 1"
    ).bind(current.event_id).first<{ value: string | null }>();
    if (!isCostingEmailSent(costing?.value)) {
      throw new Error(PROFORMA_SENT_REQUIRES_COSTING_MESSAGE);
    }
  }

  // Financial sequence: Payment Status = Completed requires Costing Email = Yes,
  // then Proforma Invoice = Sent or Not Applicable.
  if (current.field_key === "payment_status" && isPaymentMarkedCompleted(value)) {
    const financials = await getConfirmationLetterFinancials(db, current.event_id);
    if (!isCostingEmailSent(financials.costingEmail)) {
      throw new Error(PAYMENT_REQUIRES_COSTING_MESSAGE);
    }
    if (!isProformaSatisfiedForConfirmationLetter(financials.proformaInvoice)) {
      throw new Error(PAYMENT_REQUIRES_PROFORMA_MESSAGE);
    }
  }

  // Confirmation Letter delivery (Couriered / Signed) requires Made → Couriered →
  // Signed order, plus financials before Couriered / Signed.
  if (
    isConfirmationLetterDeliveryField(current.field_key)
    && isAdvancingConfirmationLetterDelivery(current.field_key, value)
  ) {
    const letter = await getConfirmationLetterDeliveryState(db, current.event_id);
    if (current.field_key === "confirmation_couriered") {
      if (!isConfirmationLetterMade(letter.made)) {
        throw new Error(CONFIRMATION_COURIERED_REQUIRES_MADE_MESSAGE);
      }
    }
    if (current.field_key === "confirmation_signed_received") {
      if (!isConfirmationLetterCouriered(letter.couriered)) {
        throw new Error(CONFIRMATION_SIGNED_REQUIRES_COURIERED_MESSAGE);
      }
    }
    const financials = await getConfirmationLetterFinancials(db, current.event_id);
    if (!areFinancialsReadyForConfirmationLetterDelivery(financials)) {
      throw new Error(CONFIRMATION_LETTER_REQUIRES_FINANCIALS_MESSAGE);
    }
  }

  const completedAt = status === "completed" && !current.completed_at ? now : status === "completed" ? current.completed_at : null;
  const completedBy = status === "completed" ? current.completed_by ?? user.id : null;
  const dueDate = current.field_type === "date" ? value : current.due_date;

  if (current.module === "operations" && current.field_type === "date" && value) {
    const event = await db.prepare(
      "SELECT event_start_date, event_end_date FROM events WHERE id = ?"
    ).bind(current.event_id).first<{ event_start_date: string | null; event_end_date: string | null }>();
    const finalShowDate = event?.event_end_date ?? event?.event_start_date ?? null;
    const warning = getPostShowDateWarning(current.field_key, value, finalShowDate);
    if (warning) throw new Error(warning);
  }

  await db.prepare(
    `UPDATE checklist_items
     SET value = ?, status = ?, due_date = ?, completed_at = ?, completed_by = ?,
         last_updated_at = ?, last_updated_by = ?
     WHERE id = ?`
  ).bind(value ?? null, status, dueDate ?? null, completedAt, completedBy, now, user.id, itemId).run();

  // If Costing Email moves off Yes, reset proforma Sent and any Completed payment
  // so the UI and confirmation gate stay aligned with the financial sequence.
  if (current.field_key === "costing_email") {
    await reconcileFinancialSequenceForEvent(db, current.event_id);
  }
  // If proforma regresses, reset Completed payment and roll back letter delivery.
  if (current.field_key === "proforma_invoice") {
    await reconcileFinancialSequenceForEvent(db, current.event_id);
    await reconcileConfirmationLetterAgainstFinancials(db, current.event_id);
  }
  // If financials regress, roll Couriered / Signed back so the letter cannot
  // stay ahead of Costing / Proforma / Payment.
  if (
    current.field_key === "costing_email"
    || current.field_key === "payment_status"
  ) {
    await reconcileConfirmationLetterAgainstFinancials(db, current.event_id);
  }
  // If Made or Couriered regresses, roll back later confirmation-letter steps.
  if (
    current.field_key === "confirmation_made"
    || current.field_key === "confirmation_couriered"
  ) {
    await reconcileConfirmationLetterDeliveryChain(db, current.event_id);
  }

  if (dateChanged) {
    await db.prepare(
      `INSERT INTO checklist_corrections (id, checklist_item_id, old_value, new_value, corrected_by, corrected_at, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(makeId("corr"), itemId, current.value, value, user.id, now, args.correctionReason).run();
  }

  await syncEventFieldsFromChecklist(db, current.event_id, current.field_key, value);
  // Mirror requirement checklist edits back into the event form's requirements
  // JSON so the Add/Edit Event form reflects Operations-tab changes. Section
  // rollup rows (exec_*) are checklist-only.
  await syncRequirementsFromChecklistItem(db, current.event_id, current.field_key, value ?? null);
  await syncPocFromChecklistItem(db, current.event_id, current.field_key, value ?? null);
  await reconcilePocTaskForEvent(db, current.event_id);
  await maybeCreateTaskForChecklistItem(db, { ...current, value: value ?? null, status, due_date: dueDate ?? null }, user.id);
  await maybeCompleteTasksForChecklistUpdate(db, current.event_id, current.field_key, value, user.id);
  if (current.field_key === "file_closed" || current.field_key === "feedback_sent" || current.module === "accounts") {
    await reconcileWorkflowPhaseTasksForEvent(db, current.event_id);
  }
  if (current.field_key === "file_closed" && isFileClosedValue(value)) {
    const closedNow = new Date().toISOString();
    await db.prepare(
      `UPDATE tasks
       SET status = 'cancelled', completion_note = ?, updated_at = ?
       WHERE event_id = ? AND task_type = 'automatic' AND status IN ('open','in_progress')`
    ).bind("Cancelled automatically because the file was closed.", closedNow, current.event_id).run();
  }
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
    // Hide/skip Approval Sent On, Approval Received On, and Genre Head when
    // approval is Not Required; reopen them when Required again.
    await syncApprovalDependentChecklist(db, eventId, value);
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
  if (fieldKey === "noc_sent") {
    await syncNocDependentChecklist(db, eventId, value);
  }
  if (fieldKey === "tds_certificate_from_client") {
    await syncTdsDependentChecklist(db, eventId, value);
  }
  if (fieldKey === "onstage_required") {
    await syncOnstageDependentChecklist(db, eventId, value);
  }
  if (fieldKey === "emailer") {
    await syncEmailerDependentChecklist(db, eventId, value);
  }
  if (fieldKey === "instalment") {
    await syncInstalmentDependentChecklist(db, eventId, value);
  }
}

/** NOC date only applies when NOC Sent? = Sent. */
export const NOC_DEPENDENT_FIELD_KEYS = ["noc_sent_on"] as const;

/** TDS processing fields only apply when TDS Certificate — From Client = Received. */
export const TDS_DEPENDENT_FIELD_KEYS = [
  "tds_received_from_client_date",
  "tds_certificate_sent_to_accounts",
  "tds_accounts_refund_or_action",
  "tds_payment_and_advice_sent",
  "tds_proof_sent_to_client",
] as const;

export async function syncNocDependentChecklist(
  db: D1Database,
  eventId: string,
  nocSent: string | null | undefined,
): Promise<void> {
  const v = normalise(nocSent);
  const notApplicable = v !== "sent" && v !== "yes";
  const now = new Date().toISOString();
  for (const fieldKey of NOC_DEPENDENT_FIELD_KEYS) {
    await db.prepare(
      `UPDATE checklist_items
       SET status = ?, value = CASE WHEN ? THEN value ELSE NULL END,
           due_date = CASE WHEN ? THEN due_date ELSE NULL END,
           completed_at = CASE WHEN ? THEN completed_at ELSE NULL END,
           completed_by = CASE WHEN ? THEN completed_by ELSE NULL END,
           last_updated_at = ?
       WHERE event_id = ? AND field_key = ?`
    ).bind(
      notApplicable ? "not_applicable" : "not_started",
      notApplicable ? 0 : 1,
      notApplicable ? 0 : 1,
      notApplicable ? 0 : 1,
      notApplicable ? 0 : 1,
      now,
      eventId,
      fieldKey,
    ).run();
  }
}

/** Checklist fields that only apply when Approval Required? = Required (VFH). */
export const APPROVAL_DEPENDENT_FIELD_KEYS = [
  "approval_sent_on",
  "approval_received_on",
  "genre_head",
] as const;

/**
 * When Approval Required? is Not Required, mark the dependent Approval fields
 * not_applicable so they drop out of pending work / completion. When Required,
 * re-derive each field's status from its current value so the thread reopens.
 */
export async function syncApprovalDependentChecklist(
  db: D1Database,
  eventId: string,
  approvalRequiredValue: string | null | undefined,
): Promise<void> {
  const now = new Date().toISOString();
  if (normalise(approvalRequiredValue) === "not required") {
    await db.prepare(
      `UPDATE checklist_items
       SET status = 'not_applicable', last_updated_at = ?
       WHERE event_id = ?
         AND field_key IN ('approval_sent_on', 'approval_received_on', 'genre_head')
         AND status != 'not_applicable'`
    ).bind(now, eventId).run();
    return;
  }

  const { results } = await db.prepare(
    `SELECT ci.id, ci.value, cd.field_type, cd.is_computed
     FROM checklist_items ci
     JOIN checklist_definitions cd ON cd.id = ci.definition_id
     WHERE ci.event_id = ?
       AND ci.field_key IN ('approval_sent_on', 'approval_received_on', 'genre_head')`
  ).bind(eventId).all<{ id: string; value: string | null; field_type: string; is_computed: number }>();

  for (const row of results ?? []) {
    const status = itemStatusForValue({
      field_type: row.field_type,
      value: row.value,
      is_computed: row.is_computed,
    });
    await db.prepare(
      "UPDATE checklist_items SET status = ?, last_updated_at = ? WHERE id = ?"
    ).bind(status, now, row.id).run();
  }
}

async function syncApprovalDependentChecklistFromEvent(db: D1Database, eventId: string): Promise<void> {
  const row = await db.prepare(
    "SELECT value FROM checklist_items WHERE event_id = ? AND field_key = 'approval_required'"
  ).bind(eventId).first<{ value: string | null }>();
  if (!row) return;
  await syncApprovalDependentChecklist(db, eventId, row.value);
}

async function syncNocDependentChecklistFromEvent(db: D1Database, eventId: string): Promise<void> {
  const row = await db.prepare(
    "SELECT value FROM checklist_items WHERE event_id = ? AND field_key = 'noc_sent'"
  ).bind(eventId).first<{ value: string | null }>();
  if (!row) return;
  await syncNocDependentChecklist(db, eventId, row.value);
}

/** OnStage pipeline only applies when OnStage Required? = Required. */
export const ONSTAGE_DEPENDENT_FIELD_KEYS = [
  "onstage_asked_client",
  "onstage_received_from_client",
  "onstage_sent_to_team",
  "onstage_verified",
  "onstage_complete",
] as const;

/** Emailer date fields only apply when Emailer = Yes. */
export const EMAILER_DEPENDENT_FIELD_KEYS = [
  "emailer_asked_client",
  "emailer_received_from_client",
  "emailer_sent_to_team",
  "emailer_sent",
] as const;

/**
 * When OnStage Required? is Not Required, mark the OnStage pipeline fields
 * not_applicable. Emailer is independent and keeps its own Yes/No gate.
 */
export async function syncOnstageDependentChecklist(
  db: D1Database,
  eventId: string,
  onstageRequiredValue: string | null | undefined,
): Promise<void> {
  const now = new Date().toISOString();
  if (normalise(onstageRequiredValue) === "not required") {
    await db.prepare(
      `UPDATE checklist_items
       SET status = 'not_applicable', last_updated_at = ?
       WHERE event_id = ?
         AND field_key IN (
           'onstage_asked_client',
           'onstage_received_from_client',
           'onstage_sent_to_team',
           'onstage_verified',
           'onstage_complete'
         )
         AND status != 'not_applicable'`
    ).bind(now, eventId).run();
    return;
  }

  const { results } = await db.prepare(
    `SELECT ci.id, ci.field_key, ci.value, cd.field_type, cd.is_computed
     FROM checklist_items ci
     JOIN checklist_definitions cd ON cd.id = ci.definition_id
     WHERE ci.event_id = ?
       AND ci.field_key IN (
         'onstage_asked_client',
         'onstage_received_from_client',
         'onstage_sent_to_team',
         'onstage_verified',
         'onstage_complete'
       )`
  ).bind(eventId).all<{ id: string; field_key: string; value: string | null; field_type: string; is_computed: number }>();

  for (const row of results ?? []) {
    const status = itemStatusForValue({
      field_type: row.field_type,
      value: row.value,
      is_computed: row.is_computed,
    });
    await db.prepare(
      "UPDATE checklist_items SET status = ?, last_updated_at = ? WHERE id = ?"
    ).bind(status, now, row.id).run();
  }
}

async function syncOnstageDependentChecklistFromEvent(db: D1Database, eventId: string): Promise<void> {
  const row = await db.prepare(
    "SELECT value FROM checklist_items WHERE event_id = ? AND field_key = 'onstage_required'"
  ).bind(eventId).first<{ value: string | null }>();
  if (!row) return;
  await syncOnstageDependentChecklist(db, eventId, row.value);
}

/**
 * When Emailer is No, mark the Emailer date fields not_applicable.
 * When Yes, re-derive each date field's status from its current value.
 */
export async function syncEmailerDependentChecklist(
  db: D1Database,
  eventId: string,
  emailerValue: string | null | undefined,
): Promise<void> {
  const now = new Date().toISOString();
  if (normalise(emailerValue) !== "yes") {
    await db.prepare(
      `UPDATE checklist_items
       SET status = 'not_applicable', last_updated_at = ?
       WHERE event_id = ?
         AND field_key IN (
           'emailer_asked_client',
           'emailer_received_from_client',
           'emailer_sent_to_team',
           'emailer_sent'
         )
         AND status != 'not_applicable'`
    ).bind(now, eventId).run();
    return;
  }

  const { results } = await db.prepare(
    `SELECT ci.id, ci.value, cd.field_type, cd.is_computed
     FROM checklist_items ci
     JOIN checklist_definitions cd ON cd.id = ci.definition_id
     WHERE ci.event_id = ?
       AND ci.field_key IN (
         'emailer_asked_client',
         'emailer_received_from_client',
         'emailer_sent_to_team',
         'emailer_sent'
       )`
  ).bind(eventId).all<{ id: string; value: string | null; field_type: string; is_computed: number }>();

  for (const row of results ?? []) {
    const status = itemStatusForValue({
      field_type: row.field_type,
      value: row.value,
      is_computed: row.is_computed,
    });
    await db.prepare(
      "UPDATE checklist_items SET status = ?, last_updated_at = ? WHERE id = ?"
    ).bind(status, now, row.id).run();
  }
}

async function syncEmailerDependentChecklistFromEvent(db: D1Database, eventId: string): Promise<void> {
  const row = await db.prepare(
    "SELECT value FROM checklist_items WHERE event_id = ? AND field_key = 'emailer'"
  ).bind(eventId).first<{ value: string | null }>();
  if (!row) return;
  await syncEmailerDependentChecklist(db, eventId, row.value);
}

/** Installment date fields only apply when Instalment = Yes. */
export const INSTALMENT_DEPENDENT_FIELD_KEYS = [
  "installment_1_expected_date",
  "installment_2_expected_date",
  "installment_3_expected_date",
  "installment_4_expected_date",
  "installment_5_expected_date",
] as const;

export async function syncInstalmentDependentChecklist(
  db: D1Database,
  eventId: string,
  instalmentValue: string | null | undefined,
): Promise<void> {
  const now = new Date().toISOString();
  if (normalise(instalmentValue) !== "yes") {
    await db.prepare(
      `UPDATE checklist_items
       SET status = 'not_applicable', last_updated_at = ?
       WHERE event_id = ?
         AND field_key IN (
           'installment_1_expected_date',
           'installment_2_expected_date',
           'installment_3_expected_date',
           'installment_4_expected_date',
           'installment_5_expected_date'
         )
         AND status != 'not_applicable'`
    ).bind(now, eventId).run();
    return;
  }

  const { results } = await db.prepare(
    `SELECT ci.id, ci.value, cd.field_type, cd.is_computed
     FROM checklist_items ci
     JOIN checklist_definitions cd ON cd.id = ci.definition_id
     WHERE ci.event_id = ?
       AND ci.field_key IN (
         'installment_1_expected_date',
         'installment_2_expected_date',
         'installment_3_expected_date',
         'installment_4_expected_date',
         'installment_5_expected_date'
       )`
  ).bind(eventId).all<{ id: string; value: string | null; field_type: string; is_computed: number }>();

  for (const row of results ?? []) {
    const status = itemStatusForValue({
      field_type: row.field_type,
      value: row.value,
      is_computed: row.is_computed,
    });
    await db.prepare(
      "UPDATE checklist_items SET status = ?, last_updated_at = ? WHERE id = ?"
    ).bind(status, now, row.id).run();
  }
}

async function syncInstalmentDependentChecklistFromEvent(db: D1Database, eventId: string): Promise<void> {
  const row = await db.prepare(
    "SELECT value FROM checklist_items WHERE event_id = ? AND field_key = 'instalment'"
  ).bind(eventId).first<{ value: string | null }>();
  if (!row) return;
  await syncInstalmentDependentChecklist(db, eventId, row.value);
}

/**
 * When TDS Certificate — From Client is not Received, mark the processing
 * fields not_applicable so they drop out of pending work / completion.
 * When Received, re-derive each field's status from its current value.
 */
export async function syncTdsDependentChecklist(
  db: D1Database,
  eventId: string,
  tdsFromClient: string | null | undefined,
): Promise<void> {
  const now = new Date().toISOString();
  if (normalise(tdsFromClient) !== "received") {
    await db.prepare(
      `UPDATE checklist_items
       SET status = 'not_applicable', last_updated_at = ?
       WHERE event_id = ?
         AND field_key IN (
           'tds_received_from_client_date',
           'tds_certificate_sent_to_accounts',
           'tds_accounts_refund_or_action',
           'tds_payment_and_advice_sent',
           'tds_proof_sent_to_client'
         )
         AND status != 'not_applicable'`
    ).bind(now, eventId).run();
    return;
  }

  const { results } = await db.prepare(
    `SELECT ci.id, ci.value, cd.field_type, cd.is_computed
     FROM checklist_items ci
     JOIN checklist_definitions cd ON cd.id = ci.definition_id
     WHERE ci.event_id = ?
       AND ci.field_key IN (
         'tds_received_from_client_date',
         'tds_certificate_sent_to_accounts',
         'tds_accounts_refund_or_action',
         'tds_payment_and_advice_sent',
         'tds_proof_sent_to_client'
       )`
  ).bind(eventId).all<{ id: string; value: string | null; field_type: string; is_computed: number }>();

  for (const row of results ?? []) {
    const status = itemStatusForValue({
      field_type: row.field_type,
      value: row.value,
      is_computed: row.is_computed,
    });
    await db.prepare(
      `UPDATE checklist_items
       SET status = ?,
           completed_at = CASE WHEN ? = 'completed' THEN COALESCE(completed_at, ?) ELSE NULL END,
           completed_by = CASE WHEN ? = 'completed' THEN completed_by ELSE NULL END,
           last_updated_at = ?
       WHERE id = ?`
    ).bind(status, status, now, status, now, row.id).run();
  }
}

async function syncTdsDependentChecklistFromEvent(db: D1Database, eventId: string): Promise<void> {
  const row = await db.prepare(
    "SELECT value FROM checklist_items WHERE event_id = ? AND field_key = 'tds_certificate_from_client'"
  ).bind(eventId).first<{ value: string | null }>();
  if (!row) return;
  await syncTdsDependentChecklist(db, eventId, row.value);
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
 *   event_dates    <- events.event_start_date / event_end_date
 *   venue          <- comma-joined venue_bookings.venue
 *
 * These are computed identification rows, so they always follow the event form.
 */
export async function syncEventReferenceChecklist(db: D1Database, eventId: string): Promise<void> {
  const event = await db.prepare(
    "SELECT id, title, event_type, event_start_date, event_end_date FROM events WHERE id = ?"
  ).bind(eventId).first<{ id: string; title: string; event_type: string | null; event_start_date: string | null; event_end_date: string | null }>();
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
    event_dates: event.event_start_date
      ? event.event_end_date && event.event_end_date !== event.event_start_date
        ? `${event.event_start_date} – ${event.event_end_date}`
        : event.event_start_date
      : null,
    venue: venueValue,
  };

  const now = new Date().toISOString();
  for (const [fieldKey, value] of Object.entries(fieldToValue)) {
    if (!value) continue; // nothing to copy for this field
    const status = itemStatusForValue({ field_type: "text", value });
    await db.prepare(
      `UPDATE checklist_items
       SET value = ?, status = ?, completed_at = COALESCE(completed_at, ?),
           completed_by = COALESCE(completed_by, NULL), last_updated_at = ?
       WHERE event_id = ? AND field_key = ?`
    ).bind(value, status, now, now, eventId, fieldKey).run();
  }
  await recalculateEventCompletion(db, eventId);
}

/**
 * Sync the event form Requirements step into the Operations checklist.
 *
 * - Six section-level rows (Event Requirements) roll up each form card.
 * - Operations Details rows carry vendor/pax detail for coordination.
 *
 * Section rows auto-set "Captured on form" when meaningful form data exists.
 * Ops may manually promote to Verified or Not applicable; sync never
 * overwrites those.
 */
function parseRequirementsJson(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

const AFFIRMATIVE = new Set(["Yes", "Required", "Keep"]);
const JOINABLE = new Set([
  "sound", "light", "green_room_amenities", "parking", "security", "housekeeping",
  "licenses", "licenses_status", "stage_setup", "foyer_setup", "orchestra_pit_chairs_note", "digital_standee_note",
  "car_display_note", "bike_display_note", "stalls_note", "telecasting_media_note",
  "liquor_licence_details", "catering_provider", "decorator_name", "recording_type",
]);

function aggregateRequirementSources(
  sources: Array<Record<string, unknown>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const src of sources) {
    for (const [key, value] of Object.entries(src)) {
      if (value == null || (typeof value === "string" && value.trim() === "")) continue;
      const current = out[key];
      if (current == null || (typeof current === "string" && current.trim() === "")) {
        out[key] = value;
        continue;
      }
      if (typeof value === "string" && AFFIRMATIVE.has(value) && !(typeof current === "string" && AFFIRMATIVE.has(current))) {
        out[key] = value;
        continue;
      }
      if (key === "crew_cards" || key === "camera_count" || isCateringMealPaxKey(key)) {
        out[key] = String(Math.max(Number(current) || 0, Number(value) || 0));
        continue;
      }
      if (JOINABLE.has(key) && typeof current === "string" && typeof value === "string" && current !== value) {
        const parts = current.split(" · ").map((p) => p.trim()).filter(Boolean);
        if (!parts.includes(value.trim())) out[key] = [...parts, value.trim()].join(" · ");
      }
    }
  }
  return out;
}

export async function syncAdditionalRequirementsChecklist(db: D1Database, eventId: string): Promise<void> {
  const row = await db.prepare("SELECT requirements FROM events WHERE id = ?")
    .bind(eventId).first<{ requirements: string | null }>();
  const { results: bookingRows } = await db.prepare(
    "SELECT requirements FROM venue_bookings WHERE event_id = ?"
  ).bind(eventId).all<{ requirements: string | null }>();

  const sources = [
    parseRequirementsJson(row?.requirements),
    ...(bookingRows ?? []).map((b) => parseRequirementsJson(b.requirements)),
  ];
  const reqs = aggregateRequirementSources(sources);
  if (Object.keys(reqs).length === 0) return;

  const str = (v: unknown): string | null => {
    const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
    return s.length ? s : null;
  };

  const now = new Date().toISOString();

  for (const section of EXECUTION_SECTIONS) {
    const derived = deriveExecutionSectionStatus(section.fieldKey, reqs);
    const current = await db.prepare(
      "SELECT value FROM checklist_items WHERE event_id = ? AND field_key = ?"
    ).bind(eventId, section.fieldKey).first<{ value: string | null }>();
    if (shouldPreserveExecutionSectionValue(current?.value)) continue;
    const status = itemStatusForValue({ field_type: "dropdown", value: derived });
    await db.prepare(
      `UPDATE checklist_items
       SET value = ?, status = ?, last_updated_at = ?
       WHERE event_id = ? AND field_key = ?`
    ).bind(derived, status, now, eventId, section.fieldKey).run();
  }

  type Pending = { fieldKey: string; fieldType: string; value: string | null };
  const detailUpdates: Pending[] = [
    { fieldKey: "no_of_crew_cards", fieldType: "number", value: str(reqs.crew_cards) },
    { fieldKey: "licenses_status", fieldType: "dropdown", value: str(reqs.licenses_status) },
    { fieldKey: "licenses", fieldType: "textarea", value: str(reqs.licenses) },
    { fieldKey: "caterer_name", fieldType: "text", value: str(reqs.catering_provider) },
    { fieldKey: "decorator_name", fieldType: "text", value: str(reqs.decorator_name) },
  ];

  for (const { fieldKey, fieldType, value } of detailUpdates) {
    if (value === null) continue;
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
 * Reverse-sync Operations Details checklist edits into the event form.
 * Section rollup rows (exec_*) are checklist-only and do not mirror back.
 */
export async function syncRequirementsFromChecklistItem(
  db: D1Database,
  eventId: string,
  fieldKey: string,
  value: string | null,
): Promise<void> {
  const PASSTHROUGH: Record<string, string> = {
    no_of_crew_cards: "crew_cards",
    licenses_status: "licenses_status",
    licenses: "licenses",
    caterer_name: "catering_provider",
    decorator_name: "decorator_name",
  };

  let formKey: string | null = null;
  let formValue: string | null = null;

  if (fieldKey in PASSTHROUGH) {
    const fk = PASSTHROUGH[fieldKey]!;
    const v = value == null ? "" : String(value).trim();
    if (v.length) {
      formKey = fk;
      formValue = v;
    }
  }

  if (formKey === null || formValue === null) return;

  const row = await db.prepare("SELECT requirements FROM events WHERE id = ?")
    .bind(eventId).first<{ requirements: string | null }>();
  if (!row) return;

  const reqs = parseRequirementsJson(row.requirements);
  reqs[formKey] = formValue;
  const now = new Date().toISOString();
  await db.prepare("UPDATE events SET requirements = ?, updated_at = ? WHERE id = ?")
    .bind(JSON.stringify(reqs), now, eventId).run();

  // Mirror into each venue booking so the per-venue form stays in sync with ops.
  // Checklist is event-scoped, so the same decision applies to every hall.
  const { results: bookings } = await db.prepare(
    "SELECT id, requirements FROM venue_bookings WHERE event_id = ?"
  ).bind(eventId).all<{ id: string; requirements: string | null }>();
  for (const booking of bookings ?? []) {
    const venueReqs = parseRequirementsJson(booking.requirements);
    venueReqs[formKey] = formValue;
    await db.prepare(
      "UPDATE venue_bookings SET requirements = ?, updated_at = ? WHERE id = ? AND event_id = ?"
    ).bind(JSON.stringify(venueReqs), now, booking.id, eventId).run();
  }
}

/**
 * Mirror the event form's Point of Contact step into the Operations checklist.
 * Values are copied 1:1 by field_key. Where the form is silent we leave any
 * manual Operations-tab entry in place.
 */
export async function syncPocChecklist(db: D1Database, eventId: string): Promise<void> {
  const row = await db.prepare("SELECT requirements FROM events WHERE id = ?")
    .bind(eventId).first<{ requirements: string | null }>();
  const reqs = parseRequirementsJson(row?.requirements);
  const str = (v: unknown): string | null => {
    const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
    return s.length ? s : null;
  };

  const { results: definitions } = await db.prepare(
    `SELECT field_key, field_type FROM checklist_definitions WHERE field_key IN (${POC_FIELD_KEYS.map(() => "?").join(", ")})`
  ).bind(...POC_FIELD_KEYS).all<{ field_key: string; field_type: string }>();
  const fieldTypes = new Map((definitions ?? []).map((def) => [def.field_key, def.field_type]));

  const now = new Date().toISOString();
  for (const fieldKey of POC_FIELD_KEYS) {
    const value = str(reqs[fieldKey]);
    if (value === null) continue;
    const fieldType = fieldTypes.get(fieldKey) ?? "text";
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
 * Reverse-sync Point of Contact checklist edits into events.requirements so the
 * add/edit event form reflects Operations-tab changes.
 */
export async function syncPocFromChecklistItem(
  db: D1Database,
  eventId: string,
  fieldKey: string,
  value: string | null,
): Promise<void> {
  if (!(POC_FIELD_KEYS as readonly string[]).includes(fieldKey)) return;
  const trimmed = value == null ? "" : String(value).trim();
  if (!trimmed.length) return;

  const row = await db.prepare("SELECT requirements FROM events WHERE id = ?")
    .bind(eventId).first<{ requirements: string | null }>();
  if (!row) return;

  const reqs = parseRequirementsJson(row.requirements);
  reqs[fieldKey] = trimmed;
  const now = new Date().toISOString();
  await db.prepare("UPDATE events SET requirements = ?, updated_at = ? WHERE id = ?")
    .bind(JSON.stringify(reqs), now, eventId).run();
}

/** Merge checklist POC values into requirements for read/edit hydration. */
export async function mergePocRequirementsForRead(
  db: D1Database,
  eventId: string,
  requirements: string | null | undefined,
): Promise<Record<string, unknown>> {
  const reqs = parseRequirementsJson(requirements);
  const { results } = await db.prepare(
    `SELECT field_key, value FROM checklist_items
     WHERE event_id = ? AND field_key IN (${POC_FIELD_KEYS.map(() => "?").join(", ")})`
  ).bind(eventId, ...POC_FIELD_KEYS).all<{ field_key: string; value: string | null }>();

  for (const row of results ?? []) {
    const current = reqs[row.field_key];
    const hasFormValue = current != null && !(typeof current === "string" && current.trim() === "");
    if (hasFormValue) continue;
    const checklistValue = row.value?.trim();
    if (checklistValue) reqs[row.field_key] = checklistValue;
  }
  return reqs;
}

/** Keep a single automatic task open until required POC fields (and organisation) are filled. */
export async function reconcilePocTaskForEvent(db: D1Database, eventId: string, today = todayIso()): Promise<number> {
  const event = await db.prepare(
    `SELECT id, status, event_owner_id FROM events WHERE id = ? AND is_archived = 0`
  ).bind(eventId).first<{ id: string; status: EventStatus; event_owner_id: string | null }>();
  if (!event) return 0;

  const poc = await evaluatePocCompletionForEvent(db, eventId);
  const idempotency = `poc:${eventId}:complete-poc`;
  const now = new Date().toISOString();
  const terminal = event.status === "cancelled" || event.status === "regret";

  if (terminal || event.status === "confirmed") {
    await db.prepare(
      `UPDATE tasks
       SET status = 'cancelled', completion_note = ?, updated_at = ?
       WHERE idempotency_key = ? AND status IN ('open','in_progress')`
    ).bind("Cancelled automatically because the POC reminder no longer applies.", now, idempotency).run();
    return 0;
  }

  if (poc.complete) {
    await db.prepare(
      `UPDATE tasks
       SET status = 'completed', completed_at = COALESCE(completed_at, ?), completion_note = ?, updated_at = ?
       WHERE idempotency_key = ? AND status IN ('open','in_progress')`
    ).bind(now, "Completed automatically because Point of Contact is fully filled.", now, idempotency).run();
    return 0;
  }

  const pocItem = await db.prepare(
    "SELECT id FROM checklist_items WHERE event_id = ? AND field_key = 'poc_name' LIMIT 1"
  ).bind(eventId).first<{ id: string }>();

  const inserted = await db.prepare(
    `INSERT INTO tasks
     (id, title, description, event_id, source_checklist_item_id, task_type, source_rule,
      idempotency_key, assignee_id, due_date, priority, status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'automatic', ?, ?, ?, ?, 'high', 'open', NULL, ?, ?)
     ON CONFLICT(idempotency_key) DO UPDATE SET
       title = excluded.title,
       description = excluded.description,
       assignee_id = excluded.assignee_id,
       priority = excluded.priority,
       status = CASE WHEN tasks.status IN ('open','in_progress') THEN 'open' ELSE tasks.status END,
       completion_note = CASE WHEN tasks.status IN ('open','in_progress') THEN NULL ELSE tasks.completion_note END,
       completed_at = CASE WHEN tasks.status IN ('open','in_progress') THEN NULL ELSE tasks.completed_at END,
       updated_at = excluded.updated_at`
  ).bind(
    makeId("task"),
    POC_TASK_TITLE,
    `Point of Contact is incomplete (${poc.filledCount}/${poc.totalCount} fields). Missing: ${poc.missingLabels.join(", ")}.`,
    eventId,
    pocItem?.id ?? null,
    POC_TASK_RULE,
    idempotency,
    event.event_owner_id,
    today,
    now,
    now,
  ).run();

  return (inserted.meta?.changes ?? 1) > 0 ? 1 : 0;
}

export const TENTATIVE_VENUE_PAYMENT_TASK_RULE = "venue_booking_payment_followup";
const TENTATIVE_VENUE_PAYMENT_COMPLETED_NOTE = "Completed automatically because the venue booking was confirmed.";
const TENTATIVE_VENUE_PAYMENT_CANCELLED_NOTE = "Cancelled automatically because the tentative venue booking no longer applies.";

/** Keep one payment follow-up task open for every tentative venue booking. */
export async function reconcileTentativeVenuePaymentTasksForEvent(
  db: D1Database,
  eventId: string,
  today = todayIso(),
): Promise<number> {
  const event = await db.prepare(
    `SELECT id, status, event_owner_id, is_archived
     FROM events WHERE id = ?`
  ).bind(eventId).first<{
    id: string;
    status: EventStatus;
    event_owner_id: string | null;
    is_archived: number;
  }>();
  if (!event) return 0;

  const { results: bookings } = await db.prepare(
    `SELECT id, venue, booking_status
     FROM venue_bookings WHERE event_id = ?`
  ).bind(eventId).all<{ id: string; venue: string; booking_status: string }>();
  const { results: existingTasks } = await db.prepare(
    `SELECT id, venue_booking_id
     FROM tasks WHERE event_id = ? AND source_rule = ? AND task_type = 'automatic'`
  ).bind(eventId, TENTATIVE_VENUE_PAYMENT_TASK_RULE).all<{ id: string; venue_booking_id: string | null }>();

  const currentBookingIds = new Set((bookings ?? []).map((booking) => booking.id));
  const eventInactive = Boolean(event.is_archived) || event.status === "cancelled" || event.status === "regret";
  const now = new Date().toISOString();
  let changed = 0;

  for (const booking of bookings ?? []) {
    const idempotency = `venue-booking:${booking.id}:payment-follow-up`;
    if (eventInactive || booking.booking_status !== "tentative") {
      const completed = booking.booking_status === "confirmed" && !eventInactive;
      const result = await db.prepare(
        `UPDATE tasks
         SET status = ?, completed_at = CASE WHEN ? = 'completed' THEN COALESCE(completed_at, ?) ELSE NULL END,
             completion_note = ?, updated_at = ?
         WHERE idempotency_key = ? AND status IN ('open','in_progress')`
      ).bind(
        completed ? "completed" : "cancelled",
        completed ? "completed" : "cancelled",
        now,
        completed ? TENTATIVE_VENUE_PAYMENT_COMPLETED_NOTE : TENTATIVE_VENUE_PAYMENT_CANCELLED_NOTE,
        now,
        idempotency,
      ).run();
      changed += result.meta?.changes ?? 0;
      continue;
    }

    const title = `Follow up with client for payment — ${booking.venue}`;
    const taskId = makeId("task");
    const result = await db.prepare(
      `INSERT INTO tasks
       (id, title, description, event_id, venue_booking_id, task_type, source_rule,
        idempotency_key, assignee_id, due_date, priority, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'automatic', ?, ?, ?, ?, 'medium', 'open', NULL, ?, ?)
       ON CONFLICT(idempotency_key) DO UPDATE SET
         title = excluded.title,
         description = excluded.description,
         venue_booking_id = excluded.venue_booking_id,
         assignee_id = excluded.assignee_id,
         due_date = COALESCE(tasks.due_date, excluded.due_date),
         status = CASE
           WHEN tasks.status = 'cancelled' AND tasks.completion_note = ? THEN 'open'
           WHEN tasks.status = 'completed' AND tasks.completion_note = ? THEN 'open'
           ELSE tasks.status
         END,
         completed_at = CASE
           WHEN tasks.completion_note IN (?, ?) THEN NULL
           ELSE tasks.completed_at
         END,
         completion_note = CASE
           WHEN tasks.completion_note IN (?, ?) THEN NULL
           ELSE tasks.completion_note
         END,
         updated_at = excluded.updated_at`
    ).bind(
      taskId,
      title,
      `Follow up with the client for payment so the ${booking.venue} booking can be confirmed.`,
      eventId,
      booking.id,
      TENTATIVE_VENUE_PAYMENT_TASK_RULE,
      idempotency,
      event.event_owner_id,
      today,
      now,
      now,
      TENTATIVE_VENUE_PAYMENT_CANCELLED_NOTE,
      TENTATIVE_VENUE_PAYMENT_COMPLETED_NOTE,
      TENTATIVE_VENUE_PAYMENT_CANCELLED_NOTE,
      TENTATIVE_VENUE_PAYMENT_COMPLETED_NOTE,
      TENTATIVE_VENUE_PAYMENT_CANCELLED_NOTE,
      TENTATIVE_VENUE_PAYMENT_COMPLETED_NOTE,
    ).run();
    changed += result.meta?.changes ?? 1;
    await createNotification(db, {
      idempotencyKey: `task-created:${idempotency}`,
      recipientId: event.event_owner_id,
      recipientPermission: event.event_owner_id ? null : "task.assign",
      title: "Payment follow-up task created",
      body: `${booking.venue} is tentative and needs client payment follow-up before confirmation.`,
      relatedEventId: eventId,
      relatedTaskId: taskId,
    });
  }

  for (const task of existingTasks ?? []) {
    if (task.venue_booking_id && currentBookingIds.has(task.venue_booking_id)) continue;
    const result = await db.prepare(
      `UPDATE tasks SET status = 'cancelled', completion_note = ?, updated_at = ?
       WHERE id = ? AND status IN ('open','in_progress')`
    ).bind(TENTATIVE_VENUE_PAYMENT_CANCELLED_NOTE, now, task.id).run();
    changed += result.meta?.changes ?? 0;
  }

  return changed;
}

export async function reconcileAllTentativeVenuePaymentTasks(db: D1Database, today = todayIso()): Promise<number> {
  const { results } = await db.prepare(
    `SELECT DISTINCT e.id
     FROM events e
     WHERE e.is_archived = 0 AND e.status NOT IN ('cancelled','regret')
       AND (
         EXISTS (SELECT 1 FROM venue_bookings vb WHERE vb.event_id = e.id AND vb.booking_status = 'tentative')
         OR EXISTS (SELECT 1 FROM tasks t WHERE t.event_id = e.id AND t.source_rule = ? AND t.task_type = 'automatic')
       )`
  ).bind(TENTATIVE_VENUE_PAYMENT_TASK_RULE).all<{ id: string }>();
  let changed = 0;
  for (const event of results ?? []) {
    changed += await reconcileTentativeVenuePaymentTasksForEvent(db, event.id, today);
  }
  return changed;
}

/** Keep one smart task per incomplete event-form section, due before the event starts. */
export async function reconcileReadinessTasksForEvent(db: D1Database, eventId: string, today = todayIso()): Promise<number> {
  const event = await db.prepare(
    `SELECT id, status, requirements, event_start_date, event_end_date, event_owner_id
     FROM events WHERE id = ? AND is_archived = 0`
  ).bind(eventId).first<{
    id: string;
    status: EventStatus;
    requirements: string | null;
    event_start_date: string | null;
    event_end_date: string | null;
    event_owner_id: string | null;
  }>();
  if (!event) return 0;

  const workflow = await resolveEventWorkflowPhase(db, eventId, today);
  const readinessPhaseActive = workflow?.activePhase === "event";

  const { results: venueRows } = await db.prepare(VENUE_BOOKINGS_FOR_READINESS_SQL).bind(eventId).all<{
    venue: string | null;
    schedule_json: unknown;
  }>();
  const readiness = calculateEventFormReadiness(event.requirements, parseVenueBookingsForReadiness(venueRows));
  const now = new Date().toISOString();
  const terminal = event.status === "cancelled" || event.status === "regret";
  let changed = 0;

  for (const section of readiness.sections) {
    const sourceRule = readinessTaskRule(section.key);
    const idempotency = `readiness:${eventId}:${section.key}`;
    const complete = section.state === "complete" || section.state === "not_applicable";
    if (terminal || complete || !readinessPhaseActive) {
      const cancelInactive = !terminal && !complete && !readinessPhaseActive;
      const result = await db.prepare(
        `UPDATE tasks
         SET status = ?, completed_at = CASE WHEN ? = 'completed' THEN COALESCE(completed_at, ?) ELSE NULL END,
             completion_note = ?, updated_at = ?
         WHERE idempotency_key = ? AND status IN ('open','in_progress')`
      ).bind(
        terminal || cancelInactive ? "cancelled" : "completed",
        terminal || cancelInactive ? "cancelled" : "completed",
        now,
        terminal
          ? "Cancelled automatically because the event is no longer active."
          : cancelInactive
            ? "Cancelled automatically because event readiness is no longer the active workflow."
            : "Completed automatically because this event-form section is ready.",
        now,
        idempotency,
      ).run();
      changed += result.meta?.changes ?? 0;
      continue;
    }

    const { title, description } = readinessTaskCopy(section);
    const result = await db.prepare(
      `INSERT INTO tasks
       (id, title, description, event_id, task_type, source_rule, idempotency_key,
        assignee_id, due_date, priority, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'automatic', ?, ?, ?, ?, 'high', 'open', NULL, ?, ?)
       ON CONFLICT(idempotency_key) DO UPDATE SET
         title = excluded.title,
         description = excluded.description,
         assignee_id = excluded.assignee_id,
         due_date = excluded.due_date,
         priority = excluded.priority,
         status = 'open',
         completed_at = NULL,
         completed_by = NULL,
         completion_note = NULL,
         updated_at = excluded.updated_at`
    ).bind(
      makeId("task"),
      title,
      description,
      eventId,
      sourceRule,
      idempotency,
      event.event_owner_id,
      event.event_start_date,
      now,
      now,
    ).run();
    changed += result.meta?.changes ?? 1;
  }
  return changed;
}

export async function reconcileAllReadinessTasks(db: D1Database): Promise<number> {
  const { results } = await db.prepare(
    `SELECT id FROM events WHERE is_archived = 0 AND status NOT IN ('cancelled','regret')`
  ).all<{ id: string }>();
  let changed = 0;
  for (const event of results ?? []) changed += await reconcileReadinessTasksForEvent(db, event.id);
  return changed;
}

/** Sweep active pipeline events so POC auto-tasks exist even if not recently edited. */
export async function reconcileAllPocTasks(db: D1Database, today = todayIso()): Promise<number> {
  const { results } = await db.prepare(
    `SELECT id FROM events
     WHERE is_archived = 0 AND status IN ('enquiry','tentative','approved')`
  ).all<{ id: string }>();
  let changed = 0;
  for (const row of results ?? []) {
    changed += await reconcilePocTaskForEvent(db, row.id, today);
  }
  return changed;
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

  const workflow = await resolveEventWorkflowPhase(db, item.event_id);
  if (workflow && !canGenerateTaskForPhase(rule.rule, workflow.activePhase)) {
    return;
  }

  const intervals = await getChecklistIntervals(db);
  const dueAfterDays = dueAfterDaysForRule(intervals, rule.rule, Number(rule.due_after_days ?? 0));

  if ((ACCOUNTS_FILE_TRACKING_KEYS as readonly string[]).includes(item.field_key)) {
    const tracking = await getAccountsFileTracking(db, item.event_id);
    if (tracking.final_file_received) return;

    if (item.field_key === "file_sent_to_accounts" && item.value) {
      const edit1 = tracking.file_received_back_edit_1;
      if (edit1 && daysBetweenIso(item.value, edit1) < dueAfterDays) {
        await cancelAutomaticTasksForChecklistItem(
          db,
          item.event_id,
          item.id,
          ["accounts_file"],
          "Edit 1 received within the follow-up window.",
        );
        return;
      }
    }
  }

  const baseDate = item.due_date ?? todayIso();
  const dueDate = addDays(baseDate, dueAfterDays);
  const idempotency = `checklist:${item.id}:${rule.rule}`;
  const now = new Date().toISOString();

  // Phase 8b: auto-assign the task to the event's owner when one is linked, so
  // the owner's "My tasks" list picks it up. Falls back to unassigned (the
  // notification still routes to the venue_manager role).
  const ownerRow = await db.prepare("SELECT event_owner_id FROM events WHERE id = ?").bind(item.event_id)
    .first<{ event_owner_id: string | null }>();
  const assigneeId = ownerRow?.event_owner_id ?? null;

  await db.prepare(
    `INSERT INTO tasks
     (id, title, description, event_id, source_checklist_item_id, task_type, source_rule,
      idempotency_key, assignee_id, due_date, priority, status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'automatic', ?, ?, ?, ?, 'medium', 'open', ?, ?, ?)
     ON CONFLICT(idempotency_key) DO UPDATE SET
       assignee_id = CASE WHEN tasks.status IN ('open','in_progress') THEN excluded.assignee_id ELSE tasks.assignee_id END,
       due_date = excluded.due_date,
       updated_at = excluded.updated_at`
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
    recipientPermission: assigneeId ? undefined : "task.assign",
    title: "Follow-up task created",
    body: `${rule.title} for ${item.label}.`,
    relatedEventId: item.event_id,
  });
}

async function maybeCompleteTasksForChecklistUpdate(db: D1Database, eventId: string, fieldKey: string, value: string | null | undefined, userId: string): Promise<void> {
  await maybeCompleteAccountsFileTasks(db, eventId, fieldKey, value, userId);

  const v = normalise(value);
  const completionByField: Record<string, { rule: string; complete: boolean }> = {
    approval_required: { rule: "approval_followup", complete: v === "not required" },
    approval_received_on: { rule: "approval_followup", complete: Boolean(v) },
    confirmation_signed_received: { rule: "confirmation_letter", complete: v === "yes" },
    onstage_required: { rule: "onstage", complete: v === "not required" },
    onstage_received_from_client: { rule: "onstage", complete: Boolean(v) },
    feedback_received: { rule: "feedback", complete: Boolean(v) },
    minutes_of_meeting: { rule: "technical_meeting", complete: v === "yes" },
    file_sent_to_accounts: { rule: "send_file_to_accounts", complete: Boolean(v) },
    tds_certificate_sent_to_accounts: { rule: "tds_send_to_accounts", complete: Boolean(v) },
    payment_status: { rule: "instalment", complete: v === "completed" },
  };
  const action = completionByField[fieldKey];
  if (!action) return;
  if (action.complete) {
    await completeTasksForSourceRules(db, eventId, [action.rule], userId, "Completed automatically from checklist update.");
  } else {
    await reopenAutomaticallyCompletedTasks(db, eventId, [action.rule]);
  }
}

async function reopenAutomaticallyCompletedTasks(db: D1Database, eventId: string, rules: string[]): Promise<void> {
  const now = new Date().toISOString();
  for (const rule of rules) {
    await db.prepare(
      `UPDATE tasks
       SET status = 'open', completed_at = NULL, completed_by = NULL, completion_note = NULL, updated_at = ?
       WHERE event_id = ? AND source_rule = ? AND task_type = 'automatic' AND status = 'completed'
         AND completion_note LIKE 'Completed automatically%'
         AND EXISTS (SELECT 1 FROM events e WHERE e.id = tasks.event_id AND e.status NOT IN ('cancelled','regret'))`
    ).bind(now, eventId, rule).run();
  }
}

export async function syncAutomaticTaskOwnerForEvent(db: D1Database, eventId: string, ownerId: string | null): Promise<void> {
  await db.prepare(
    `UPDATE tasks SET assignee_id = ?, updated_at = ?
     WHERE event_id = ? AND task_type = 'automatic' AND status IN ('open','in_progress')`
  ).bind(ownerId, new Date().toISOString(), eventId).run();
}

export async function reconcileTasksForLifecycleTransition(
  db: D1Database,
  eventId: string,
  from: EventStatus,
  to: EventStatus,
  userId: string,
): Promise<void> {
  const now = new Date().toISOString();
  if (to === "cancelled" || to === "regret") {
    await db.prepare(
      `UPDATE tasks
       SET status = 'cancelled', completion_note = ?, completed_at = NULL, completed_by = NULL, updated_at = ?
       WHERE event_id = ? AND status IN ('open','in_progress')`
    ).bind(`Cancelled automatically because event became ${to}.`, now, eventId).run();
    return;
  }

  if (from === "cancelled" || from === "regret") {
    await db.prepare(
      `UPDATE tasks
       SET status = 'open', completion_note = NULL, updated_at = ?
       WHERE event_id = ? AND task_type = 'automatic' AND status = 'cancelled'
         AND completion_note LIKE 'Cancelled automatically because event became %'`
    ).bind(now, eventId).run();
  }

  await completeTasksForSourceRules(
    db,
    eventId,
    taskRulesCompletedByLifecycleTransition(from, to),
    userId,
    "Completed automatically from lifecycle transition.",
  );
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

export async function reconcileFileToAccountsReminderForEvent(db: D1Database, eventId: string, today = todayIso()): Promise<number> {
  const intervals = await getChecklistIntervals(db);
  const dueAfterDays = intervals.send_file_to_accounts;

  const event = await db.prepare(
    `SELECT e.id AS event_id, e.status AS event_status, e.event_end_date, e.event_start_date,
            e.event_owner_id, ci.id AS checklist_item_id, ci.value AS file_sent_value
     FROM events e
     JOIN checklist_items ci ON ci.event_id = e.id
       AND ci.module = 'accounts'
       AND ci.field_key = 'file_sent_to_accounts'
     WHERE e.id = ?`
  ).bind(eventId).first<{
    event_id: string;
    event_status: string;
    event_end_date: string | null;
    event_start_date: string | null;
    event_owner_id: string | null;
    checklist_item_id: string;
    file_sent_value: string | null;
  }>();
  if (!event) return 0;
  const workflow = await resolveEventWorkflowPhase(db, eventId, today);
  const showDate = finalShowDate(event.event_start_date, event.event_end_date);
  const eligible = workflow?.activePhase === "accounts"
    && Boolean(showDate)
    && !normalise(event.file_sent_value);
  const idempotency = `post-event:${event.event_id}:send-file-to-accounts`;
  const now = new Date().toISOString();
  if (!eligible || !showDate) {
    await db.prepare(
      `UPDATE tasks SET status = 'cancelled', completion_note = 'Cancelled automatically because the reminder is no longer due.', updated_at = ?
       WHERE idempotency_key = ? AND status IN ('open','in_progress')`
    ).bind(now, idempotency).run();
    return 0;
  }

  const dueDate = addDays(showDate, dueAfterDays);
  const inserted = await db.prepare(
      `INSERT INTO tasks
       (id, title, description, event_id, source_checklist_item_id, task_type, source_rule,
        idempotency_key, assignee_id, due_date, priority, status, created_at, updated_at)
       VALUES (?, 'Send file to accounts', 'Event is over; send the venue hire file to Accounts.',
        ?, ?, 'automatic', 'send_file_to_accounts', ?, ?, ?, ?, 'open', ?, ?)
       ON CONFLICT(idempotency_key) DO UPDATE SET
         assignee_id = excluded.assignee_id,
         due_date = excluded.due_date,
         priority = excluded.priority,
         status = CASE
           WHEN tasks.status = 'cancelled' AND tasks.completion_note = 'Cancelled automatically because the reminder is no longer due.' THEN 'open'
           ELSE tasks.status
         END,
         completion_note = CASE
           WHEN tasks.status = 'cancelled' AND tasks.completion_note = 'Cancelled automatically because the reminder is no longer due.' THEN NULL
           ELSE tasks.completion_note
         END,
         updated_at = excluded.updated_at`
    ).bind(
      makeId("task"),
      event.event_id,
      event.checklist_item_id,
      idempotency,
      event.event_owner_id,
      dueDate,
      dueDate < today ? "high" : "medium",
      now,
      now
    ).run();
  return inserted.meta.changes > 0 ? 1 : 0;
}

async function createFileToAccountsReminders(db: D1Database, today: string): Promise<number> {
  const { results } = await db.prepare(
    `SELECT e.id FROM events e
     JOIN checklist_items ci ON ci.event_id = e.id AND ci.field_key = 'file_sent_to_accounts'
     WHERE e.status = 'confirmed' OR EXISTS (
       SELECT 1 FROM tasks t WHERE t.event_id = e.id AND t.source_rule = 'send_file_to_accounts' AND t.status IN ('open','in_progress')
     )`
  ).all<{ id: string }>();
  let changed = 0;
  for (const event of results) {
    changed += await reconcileFileToAccountsReminderForEvent(db, event.id, today);
  }
  return changed;
}

/**
 * Reset financial fields that are ahead of their prerequisites:
 * - Proforma Sent while Costing Email is still No → Not Sent
 * - Payment Completed while costing or proforma is not satisfied → Incomplete
 */
export async function reconcileFinancialSequenceForEvent(db: D1Database, eventId: string): Promise<boolean> {
  const { results } = await db.prepare(
    `SELECT id, field_key, value
     FROM checklist_items
     WHERE event_id = ? AND field_key IN ('costing_email', 'proforma_invoice', 'payment_status')`
  ).bind(eventId).all<{ id: string; field_key: string; value: string | null }>();

  let costingValue: string | null = null;
  let proformaRow: { id: string; value: string | null } | null = null;
  let paymentRow: { id: string; value: string | null } | null = null;
  for (const row of results ?? []) {
    if (row.field_key === "costing_email") costingValue = row.value;
    if (row.field_key === "proforma_invoice") proformaRow = { id: row.id, value: row.value };
    if (row.field_key === "payment_status") paymentRow = { id: row.id, value: row.value };
  }

  const now = new Date().toISOString();
  let changed = false;

  if (proformaRow && hasInvalidProformaBeforeCosting(costingValue, proformaRow.value)) {
    const resetValue = "Not Sent";
    const status = itemStatusForValue({ field_type: "dropdown", value: resetValue });
    await db.prepare(
      `UPDATE checklist_items
       SET value = ?, status = ?, completed_at = NULL, completed_by = NULL, last_updated_at = ?
       WHERE id = ?`
    ).bind(resetValue, status, now, proformaRow.id).run();
    proformaRow.value = resetValue;
    changed = true;
  }

  if (
    paymentRow
    && (
      hasInvalidPaymentBeforeCosting(costingValue, paymentRow.value)
      || hasInvalidPaymentBeforeProforma(proformaRow?.value, paymentRow.value)
    )
  ) {
    const resetValue = "Incomplete";
    const status = itemStatusForValue({ field_type: "dropdown", value: resetValue });
    await db.prepare(
      `UPDATE checklist_items
       SET value = ?, status = ?, completed_at = NULL, completed_by = NULL, last_updated_at = ?
       WHERE id = ?`
    ).bind(resetValue, status, now, paymentRow.id).run();
    await reopenAutomaticallyCompletedTasks(db, eventId, ["instalment"]);
    changed = true;
  }

  if (changed) await recalculateEventCompletion(db, eventId);
  return changed;
}

async function getConfirmationLetterFinancials(
  db: D1Database,
  eventId: string,
): Promise<{ costingEmail: string | null; proformaInvoice: string | null; paymentStatus: string | null }> {
  const { results } = await db.prepare(
    `SELECT field_key, value FROM checklist_items
     WHERE event_id = ? AND field_key IN ('costing_email', 'proforma_invoice', 'payment_status')`
  ).bind(eventId).all<{ field_key: string; value: string | null }>();

  let costingEmail: string | null = null;
  let proformaInvoice: string | null = null;
  let paymentStatus: string | null = null;
  for (const row of results ?? []) {
    if (row.field_key === "costing_email") costingEmail = row.value;
    if (row.field_key === "proforma_invoice") proformaInvoice = row.value;
    if (row.field_key === "payment_status") paymentStatus = row.value;
  }
  return { costingEmail, proformaInvoice, paymentStatus };
}

async function getConfirmationLetterDeliveryState(
  db: D1Database,
  eventId: string,
): Promise<{ made: string | null; couriered: string | null; signed: string | null }> {
  const { results } = await db.prepare(
    `SELECT field_key, value FROM checklist_items
     WHERE event_id = ? AND field_key IN ('confirmation_made', 'confirmation_couriered', 'confirmation_signed_received')`
  ).bind(eventId).all<{ field_key: string; value: string | null }>();

  let made: string | null = null;
  let couriered: string | null = null;
  let signed: string | null = null;
  for (const row of results ?? []) {
    if (row.field_key === "confirmation_made") made = row.value;
    if (row.field_key === "confirmation_couriered") couriered = row.value;
    if (row.field_key === "confirmation_signed_received") signed = row.value;
  }
  return { made, couriered, signed };
}

/**
 * Roll back Couriered / Signed Copy Received when financials are incomplete.
 * Made is left alone — only delivery steps require Costing + Proforma + Payment.
 */
export async function reconcileConfirmationLetterAgainstFinancials(
  db: D1Database,
  eventId: string,
): Promise<boolean> {
  const financials = await getConfirmationLetterFinancials(db, eventId);
  if (areFinancialsReadyForConfirmationLetterDelivery(financials)) return false;

  const { results } = await db.prepare(
    `SELECT id, field_key, value
     FROM checklist_items
     WHERE event_id = ? AND field_key IN ('confirmation_made', 'confirmation_couriered', 'confirmation_signed_received')`
  ).bind(eventId).all<{ id: string; field_key: string; value: string | null }>();

  let madeValue: string | null = null;
  let courieredRow: { id: string; value: string | null } | null = null;
  let signedRow: { id: string; value: string | null } | null = null;
  for (const row of results ?? []) {
    if (row.field_key === "confirmation_made") madeValue = row.value;
    if (row.field_key === "confirmation_couriered") courieredRow = { id: row.id, value: row.value };
    if (row.field_key === "confirmation_signed_received") signedRow = { id: row.id, value: row.value };
  }

  const courieredSet = Boolean((courieredRow?.value ?? "").trim());
  const signedYes = (signedRow?.value ?? "").trim().toLowerCase() === "yes";
  if (!courieredSet && !signedYes) return false;

  const now = new Date().toISOString();
  if (signedRow && signedYes) {
    const status = itemStatusForValue({ field_type: "dropdown", value: "No" });
    await db.prepare(
      `UPDATE checklist_items
       SET value = ?, status = ?, completed_at = NULL, completed_by = NULL, last_updated_at = ?
       WHERE id = ?`
    ).bind("No", status, now, signedRow.id).run();
  }
  if (courieredRow && courieredSet) {
    const status = itemStatusForValue({ field_type: "date", value: null });
    await db.prepare(
      `UPDATE checklist_items
       SET value = NULL, status = ?, due_date = NULL, completed_at = NULL, completed_by = NULL, last_updated_at = ?
       WHERE id = ?`
    ).bind(status, now, courieredRow.id).run();
  }

  const confirmationStatus = (madeValue ?? "").trim().toLowerCase() === "yes" ? "made" : "none";
  await db.prepare("UPDATE events SET confirmation_status = ?, updated_at = ? WHERE id = ?")
    .bind(confirmationStatus, now, eventId).run();

  await reopenAutomaticallyCompletedTasks(db, eventId, ["confirmation_letter"]);
  await recalculateEventCompletion(db, eventId);
  return true;
}

/**
 * Roll back Couriered / Signed when Made is No or Signed is set without Couriered.
 * Made may still be set before financials; only delivery steps are chained here.
 */
export async function reconcileConfirmationLetterDeliveryChain(
  db: D1Database,
  eventId: string,
): Promise<boolean> {
  const { results } = await db.prepare(
    `SELECT id, field_key, value
     FROM checklist_items
     WHERE event_id = ? AND field_key IN ('confirmation_made', 'confirmation_couriered', 'confirmation_signed_received')`
  ).bind(eventId).all<{ id: string; field_key: string; value: string | null }>();

  let madeValue: string | null = null;
  let courieredRow: { id: string; value: string | null } | null = null;
  let signedRow: { id: string; value: string | null } | null = null;
  for (const row of results ?? []) {
    if (row.field_key === "confirmation_made") madeValue = row.value;
    if (row.field_key === "confirmation_couriered") courieredRow = { id: row.id, value: row.value };
    if (row.field_key === "confirmation_signed_received") signedRow = { id: row.id, value: row.value };
  }

  const madeYes = isConfirmationLetterMade(madeValue);
  const courieredSet = isConfirmationLetterCouriered(courieredRow?.value);
  const signedYes = (signedRow?.value ?? "").trim().toLowerCase() === "yes";

  const needsSignedReset = signedYes && (!madeYes || !courieredSet);
  const needsCourieredReset = courieredSet && !madeYes;
  if (!needsSignedReset && !needsCourieredReset) return false;

  const now = new Date().toISOString();
  if (signedRow && needsSignedReset) {
    const status = itemStatusForValue({ field_type: "dropdown", value: "No" });
    await db.prepare(
      `UPDATE checklist_items
       SET value = ?, status = ?, completed_at = NULL, completed_by = NULL, last_updated_at = ?
       WHERE id = ?`
    ).bind("No", status, now, signedRow.id).run();
  }
  if (courieredRow && needsCourieredReset) {
    const status = itemStatusForValue({ field_type: "date", value: null });
    await db.prepare(
      `UPDATE checklist_items
       SET value = NULL, status = ?, due_date = NULL, completed_at = NULL, completed_by = NULL, last_updated_at = ?
       WHERE id = ?`
    ).bind(status, now, courieredRow.id).run();
  }

  const confirmationStatus = madeYes ? "made" : "none";
  await db.prepare("UPDATE events SET confirmation_status = ?, updated_at = ? WHERE id = ?")
    .bind(confirmationStatus, now, eventId).run();

  await reopenAutomaticallyCompletedTasks(db, eventId, ["confirmation_letter"]);
  await recalculateEventCompletion(db, eventId);
  return true;
}

export async function getEventLifecycle(db: D1Database, eventId: string): Promise<{ event: EventLifecycleRow; readiness: LifecycleReadiness; poc: import("./poc-completion").PocCompletionStatus }> {
  const event = await db.prepare(
    `SELECT id, title, status, event_type, approval_status, confirmation_status,
            ops_completion, accounts_completion, overall_completion
     FROM events WHERE id = ?`
  ).bind(eventId).first<EventLifecycleRow>();
  if (!event) throw new Error("Event not found");
  // Heal invalid Completed-without-costing before reading gate values.
  await reconcileFinancialSequenceForEvent(db, eventId);
  // Heal Couriered / Signed set ahead of financials or delivery chain, then re-read status.
  await reconcileConfirmationLetterAgainstFinancials(db, eventId);
  await reconcileConfirmationLetterDeliveryChain(db, eventId);
  const refreshed = await db.prepare(
    "SELECT confirmation_status FROM events WHERE id = ?"
  ).bind(eventId).first<{ confirmation_status: string | null }>();
  if (refreshed) event.confirmation_status = refreshed.confirmation_status;
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
  const poc = await evaluatePocCompletionForEvent(db, eventId);
  event.poc_complete = poc.complete;
  return { event, readiness: buildLifecycleReadiness(event), poc };
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
    // Financials gate — costing email = Yes, then payment = Completed.
    // Payment Completed while costing is still No does not satisfy the gate
    // (invalid sequence). Proforma / instalment tracking do NOT gate.
    if (!isCostingEmailSent(event.costing_email)) {
      blockers.push(COSTING_EMAIL_BLOCKER);
    }
    if (!isPaymentGateSatisfied(event.costing_email, event.payment_status)) {
      blockers.push(PAYMENT_COMPLETED_BLOCKER);
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
    if (event.poc_complete === false) {
      blockers.push(POC_CONFIRMATION_BLOCKER);
    }
  }
  return blockers;
}

export type CreateNotificationInput = {
  idempotencyKey: string;
  recipientId?: string | null;
  /** Address everyone who holds this permission (instead of one user). */
  recipientPermission?: string | null;
  title: string;
  body?: string | null;
  relatedEventId?: string | null;
  relatedTaskId?: string | null;
  channel?: "in_app" | "email";
};

export async function createNotification(db: D1Database, input: CreateNotificationInput): Promise<void> {
  await db.prepare(
    `INSERT OR IGNORE INTO notifications
     (id, idempotency_key, recipient_id, recipient_permission, title, body, channel,
      related_event_id, related_task_id, email_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    makeId("ntf"),
    input.idempotencyKey,
    input.recipientId ?? null,
    input.recipientPermission ?? null,
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

  const { results: datedEvents } = await db.prepare(
    `SELECT DISTINCT ci.event_id
     FROM checklist_items ci
     JOIN checklist_definitions cd ON cd.id = ci.definition_id
     WHERE cd.field_type = 'date' AND ci.due_date IS NOT NULL`
  ).all<{ event_id: string }>();
  await db.prepare(
    `UPDATE checklist_items
     SET status = CASE WHEN due_date <= ? THEN 'completed' ELSE 'in_progress' END,
         completed_at = CASE WHEN due_date <= ? THEN COALESCE(completed_at, ?) ELSE NULL END,
         completed_by = CASE WHEN due_date <= ? THEN completed_by ELSE NULL END,
         last_updated_at = ?
     WHERE due_date IS NOT NULL
       AND definition_id IN (SELECT id FROM checklist_definitions WHERE field_type = 'date')`
  ).bind(today, today, now, today, now).run();
  for (const row of datedEvents) await recalculateEventCompletion(db, row.event_id);

  tasks += await rescheduleAllAutomaticTasks(db, today);

  const { results: dueTasks } = await db.prepare(
    `SELECT t.id, t.title, t.event_id, t.assignee_id, e.event_owner
     FROM tasks t
     LEFT JOIN events e ON e.id = t.event_id
     WHERE t.status IN ('open','in_progress') AND t.due_date IS NOT NULL AND t.due_date <= ?
       AND (t.event_id IS NULL OR e.status NOT IN ('cancelled','regret'))`
  ).bind(today).all<{ id: string; title: string; event_id: string | null; assignee_id: string | null; event_owner: string | null }>();
  for (const task of dueTasks) {
    await createNotification(db, {
      idempotencyKey: `task-due:${task.id}:${today}`,
      recipientId: task.assignee_id,
      recipientPermission: task.assignee_id ? null : "task.assign",
      title: "Task due",
      body: task.title,
      relatedEventId: task.event_id,
      relatedTaskId: task.id,
    });
    notifications++;
  }

  await db.prepare(
    "INSERT INTO scheduler_runs (ran_at, job, note, rows_affected) VALUES (?, ?, ?, ?)"
  ).bind(now, "operational_jobs", "Reconciled automatic tasks and due notifications", tasks + notifications).run();

  return { tasks, notifications };
}

export async function rescheduleAllAutomaticTasks(db: D1Database, today = todayIso()): Promise<number> {
  let changed = 0;
  const { results: items } = await db.prepare(
    `SELECT ci.*, cd.field_type, cd.options, cd.is_computed, cd.triggers_task, cd.visibility_rule, cd.sort_order
     FROM checklist_items ci
     JOIN checklist_definitions cd ON cd.id = ci.definition_id
     WHERE ci.value IS NOT NULL AND ci.value != '' AND cd.triggers_task IS NOT NULL`
  ).all<ChecklistItemRow>();
  for (const item of items) {
    await maybeCreateTaskForChecklistItem(db, item, null);
    changed++;
  }
  changed += await createFileToAccountsReminders(db, today);
  changed += await reconcileAllPocTasks(db, today);
  changed += await reconcileAllTentativeVenuePaymentTasks(db, today);
  changed += await reconcileAllReadinessTasks(db);
  const { results: activeEvents } = await db.prepare(
    `SELECT id FROM events WHERE is_archived = 0 AND status NOT IN ('cancelled','regret')`
  ).all<{ id: string }>();
  for (const row of activeEvents ?? []) {
    changed += await reconcileWorkflowPhaseTasksForEvent(db, row.id, today);
  }
  return changed;
}
