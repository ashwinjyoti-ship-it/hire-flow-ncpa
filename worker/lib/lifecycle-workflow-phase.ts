/**
 * Single-focus lifecycle workflow phases for the event detail form.
 *
 * Confirm → Event prep (ops actions + form readiness, until first show date)
 * → Accounts (day after last show).
 * Completed phases stay collapsible; only one phase is active at a time.
 *
 * Event prep runs two parallel tracks (neither gates the other):
 * - Ops actions: NOC, OnStage/Emailer, Monthly Chart, Technical Meeting
 * - Event form readiness: required event-form sections
 */

/** Ops checklist sections that belong to the Confirm workflow. */
export const CONFIRM_CHECKLIST_SECTIONS = [
  "Event Reference",
  "Approval",
  "Financials",
  "Confirmation Letter",
] as const;

/** Ops checklist sections that belong to Event prep (parallel with form readiness). */
export const EVENT_PREP_OPS_SECTIONS = [
  "NOC",
  "Onstage/Emailer",
  "Monthly Chart",
  "Technical Meeting & Minutes",
] as const;

export const POST_EVENT_CHECKLIST_SECTION = "Post-Event Closure";

export function isConfirmChecklistSection(section: string): boolean {
  return (CONFIRM_CHECKLIST_SECTIONS as readonly string[]).includes(section);
}

export function isEventPrepOpsSection(section: string): boolean {
  return (EVENT_PREP_OPS_SECTIONS as readonly string[]).includes(section);
}

export type LifecycleWorkflowPhase =
  | "confirm"
  | "event"
  | "duringEvent"
  | "accounts"
  | "complete"
  | "terminal";

export type LifecycleWorkflowPhaseInput = {
  status: string;
  eventStartDate: string | null | undefined;
  eventEndDate: string | null | undefined;
  /** True when the Close File checklist field has a completed value. */
  fileClosed?: boolean;
};

/** Final show date: end date, or start date for single-day events. */
export function finalShowDate(
  eventStartDate: string | null | undefined,
  eventEndDate: string | null | undefined,
): string | null {
  return eventEndDate ?? eventStartDate ?? null;
}

/** Accounts workflow opens the morning after the final show date (calendar next day). */
export function accountsStartDate(
  eventStartDate: string | null | undefined,
  eventEndDate: string | null | undefined,
): string | null {
  const end = finalShowDate(eventStartDate, eventEndDate);
  if (!end) return null;
  return addDaysIso(end, 1);
}

export function getActiveWorkflowPhase(
  input: LifecycleWorkflowPhaseInput,
  today: string,
): LifecycleWorkflowPhase {
  const status = input.status;
  if (status === "cancelled" || status === "regret") return "terminal";
  if (status !== "confirmed") return "confirm";
  if (input.fileClosed) return "complete";

  const start = input.eventStartDate ?? null;
  const end = finalShowDate(input.eventStartDate, input.eventEndDate);

  // Confirmed without dates: stay on event-form readiness.
  if (!start) return "event";

  // Event readiness window: through first show date (inclusive).
  if (today <= start) return "event";

  // Multi-day show in progress (after first day, through final show day).
  if (end && today <= end) return "duringEvent";

  // Day after final show → Accounts (Feedback, file tracking, close file).
  return "accounts";
}

/** Phases that have already finished (eligible to collapse with expand). */
export function completedWorkflowPhases(
  active: LifecycleWorkflowPhase,
): LifecycleWorkflowPhase[] {
  switch (active) {
    case "confirm":
      return [];
    case "event":
      return ["confirm"];
    case "duringEvent":
      return ["confirm", "event"];
    case "accounts":
      return ["confirm", "event"];
    case "complete":
      return ["confirm", "event", "accounts"];
    case "terminal":
      return [];
  }
}

export function isWorkflowPhaseVisible(
  phase: LifecycleWorkflowPhase,
  active: LifecycleWorkflowPhase,
): boolean {
  if (phase === active) return true;
  if (phase === "duringEvent" || phase === "terminal" || phase === "complete") return false;
  return completedWorkflowPhases(active).includes(phase);
}

/** Map automatic task `source_rule` → workflow phase that may generate it. */
export function workflowPhaseForTaskRule(sourceRule: string | null | undefined): LifecycleWorkflowPhase | null {
  if (!sourceRule) return null;
  if (sourceRule === "poc_incomplete") return "confirm";
  if (sourceRule === "approval_followup") return "confirm";
  if (sourceRule === "confirmation_letter") return "confirm";
  if (sourceRule === "instalment") return "confirm";
  if (sourceRule === "venue_booking_payment_followup") return "confirm";
  if (sourceRule.startsWith("event_form_readiness:")) return "event";
  if (sourceRule === "onstage") return "event";
  if (sourceRule === "technical_meeting") return "event";
  if (sourceRule === "feedback") return "accounts";
  if (sourceRule === "send_file_to_accounts") return "accounts";
  if (sourceRule === "accounts_file") return "accounts";
  if (sourceRule === "accounts_file_send_back") return "accounts";
  if (sourceRule === "tds_send_to_accounts") return "accounts";
  return null;
}

/**
 * Whether an automatic task rule may be created for the event's active phase.
 * Payment follow-ups stay allowed through the show (confirm / event / duringEvent).
 */
export function canGenerateTaskForPhase(
  sourceRule: string | null | undefined,
  activePhase: LifecycleWorkflowPhase,
): boolean {
  if (activePhase === "terminal" || activePhase === "complete") return false;
  if (sourceRule === "instalment" || sourceRule === "venue_booking_payment_followup") {
    return activePhase === "confirm" || activePhase === "event" || activePhase === "duringEvent";
  }
  const rulePhase = workflowPhaseForTaskRule(sourceRule);
  if (!rulePhase) return true; // unknown / manual — allow
  return rulePhase === activePhase;
}

export const WORKFLOW_PHASE_LABELS: Record<LifecycleWorkflowPhase, string> = {
  confirm: "Confirm",
  event: "Event prep",
  duringEvent: "Event in progress",
  accounts: "Accounts",
  complete: "File closed",
  terminal: "Closed",
};

/** Field keys that deep-link into the Event prep ops track (not Confirm). */
const EVENT_PREP_FIELD_PREFIXES = ["noc_", "onstage_", "emailer"] as const;
const EVENT_PREP_FIELD_KEYS = new Set([
  "noc_sent",
  "noc_sent_on",
  "onstage_required",
  "onstage_asked_client",
  "onstage_received_from_client",
  "onstage_sent_to_team",
  "onstage_verified",
  "onstage_complete",
  "emailer",
  "emailer_asked_client",
  "emailer_received_from_client",
  "emailer_sent_to_team",
  "emailer_sent",
  "monthly_chart_sent",
  "technical_meeting_date",
  "minutes_of_meeting",
]);

export function isEventPrepOpsFieldKey(fieldKey: string | null | undefined): boolean {
  if (!fieldKey) return false;
  if (EVENT_PREP_FIELD_KEYS.has(fieldKey)) return true;
  return EVENT_PREP_FIELD_PREFIXES.some((prefix) => fieldKey.startsWith(prefix));
}

export function isFileClosedValue(value: string | null | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  if (!v) return false;
  if (v === "no" || v === "not closed") return false;
  // Date fields store ISO dates; dropdown may store "Yes".
  return true;
}

function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
