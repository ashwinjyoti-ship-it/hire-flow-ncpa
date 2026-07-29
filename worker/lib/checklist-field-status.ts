/**
 * Context-aware checklist field status for gate controllers and selection fields.
 *
 * Generic `itemStatusForValue` treats any non-done dropdown value (e.g. "Required",
 * "Theatre") as in_progress forever. Gate controllers and lookup selections need
 * workflow-aware status instead.
 */

import {
  INSTALMENT_COUNT,
  instalmentExpectedDateFieldKey,
  instalmentReceivedFieldKey,
  isInstalmentReceivedValue,
} from "./instalments";

export type ChecklistFieldValues = Record<string, string | null | undefined>;

function normalise(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/** Dropdown fields where any non-empty choice is a completed answer. */
export const SELECTION_COMPLETE_FIELD_KEYS = new Set(["genre_head"]);

export type GateControllerFieldKey =
  | "approval_required"
  | "onstage_required"
  | "emailer"
  | "instalment";

export const GATE_CONTROLLER_FIELD_KEYS = new Set<GateControllerFieldKey>([
  "approval_required",
  "onstage_required",
  "emailer",
  "instalment",
]);

export function approvalRequiredStatus(
  approvalRequired: string | null | undefined,
  approvalReceivedOn: string | null | undefined,
): string {
  const gate = normalise(approvalRequired);
  if (gate === "not required") return "not_applicable";
  if (gate === "required") {
    return (approvalReceivedOn ?? "").trim() ? "completed" : "in_progress";
  }
  return "not_started";
}

export function genreHeadStatus(
  value: string | null | undefined,
  approvalRequired: string | null | undefined,
): string {
  if (normalise(approvalRequired) === "not required") return "not_applicable";
  return (value ?? "").trim() ? "completed" : "not_started";
}

export function onstageRequiredStatus(
  onstageRequired: string | null | undefined,
  onstageCompleteOn: string | null | undefined,
): string {
  const gate = normalise(onstageRequired);
  if (gate === "not required") return "not_applicable";
  if (gate === "required") {
    return (onstageCompleteOn ?? "").trim() ? "completed" : "in_progress";
  }
  return "not_started";
}

export function emailerGateStatus(
  emailer: string | null | undefined,
  emailerSentOn: string | null | undefined,
): string {
  const gate = normalise(emailer);
  if (!gate || gate === "no") return "not_applicable";
  if (gate === "yes") {
    return (emailerSentOn ?? "").trim() ? "completed" : "in_progress";
  }
  return "not_started";
}

export function instalmentGateStatus(
  instalment: string | null | undefined,
  values: ChecklistFieldValues,
): string {
  const gate = normalise(instalment);
  if (!gate || gate === "no") return "not_applicable";
  if (gate !== "yes") return "not_started";

  let hasAnyExpected = false;
  let allExpectedReceived = true;
  for (let number = 1; number <= INSTALMENT_COUNT; number += 1) {
    const expected = (values[instalmentExpectedDateFieldKey(number)] ?? "").trim();
    if (!expected) continue;
    hasAnyExpected = true;
    if (!isInstalmentReceivedValue(values[instalmentReceivedFieldKey(number)])) {
      allExpectedReceived = false;
    }
  }
  if (!hasAnyExpected) return "in_progress";
  return allExpectedReceived ? "completed" : "in_progress";
}

/** Derive persisted status for a gate controller or selection field. */
export function gateControllerStatus(
  fieldKey: string,
  values: ChecklistFieldValues,
): string | null {
  switch (fieldKey) {
    case "approval_required":
      return approvalRequiredStatus(values.approval_required, values.approval_received_on);
    case "genre_head":
      return genreHeadStatus(values.genre_head, values.approval_required);
    case "onstage_required":
      return onstageRequiredStatus(values.onstage_required, values.onstage_complete);
    case "emailer":
      return emailerGateStatus(values.emailer, values.emailer_sent);
    case "instalment":
      return instalmentGateStatus(values.instalment, values);
    default:
      return null;
  }
}

/** Keys read when syncing gate controller statuses for an event. */
export const GATE_CONTROLLER_SYNC_FIELD_KEYS = [
  "approval_required",
  "approval_received_on",
  "genre_head",
  "onstage_required",
  "onstage_complete",
  "emailer",
  "emailer_sent",
  "instalment",
  ...Array.from({ length: INSTALMENT_COUNT }, (_, index) => instalmentExpectedDateFieldKey(index + 1)),
  ...Array.from({ length: INSTALMENT_COUNT }, (_, index) => instalmentReceivedFieldKey(index + 1)),
] as const;

/** Fields whose stored status is overwritten by gate-controller sync. */
export const GATE_CONTROLLER_STATUS_FIELD_KEYS = [
  "approval_required",
  "genre_head",
  "onstage_required",
  "emailer",
  "instalment",
] as const;

export type ChecklistSectionRollupStatus = "not_started" | "in_progress" | "completed" | "not_applicable";

/** Roll up visible checklist field statuses into a section-level badge. */
export function rollupChecklistSectionStatus(
  items: Array<{ status: string }>,
): ChecklistSectionRollupStatus {
  if (!items.length) return "not_applicable";
  const statuses = items.map((item) => item.status);
  if (statuses.every((status) => status === "not_applicable")) return "not_applicable";
  const relevant = statuses.filter((status) => status !== "not_applicable");
  if (!relevant.length) return "not_applicable";
  if (relevant.every((status) => status === "completed")) return "completed";
  if (relevant.some((status) => status === "in_progress")) return "in_progress";
  if (relevant.some((status) => status === "completed")) return "in_progress";
  return "not_started";
}
