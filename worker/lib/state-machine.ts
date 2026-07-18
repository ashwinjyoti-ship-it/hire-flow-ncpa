/**
 * Event status state machine. Server-side validation blocks invalid transitions.
 *
 * Canonical lifecycle:
 *   Enquiry → (Approved, VFH only) → Confirmed
 *
 * Tentative is not a normal progress milestone. It marks enquiries where the
 * client is unsure and the event should remain in follow-up before confirmation.
 *
 * Terminal / decline paths:
 *   Enquiry / Tentative / Approved → Regret      (declined before confirmation)
 *   Enquiry / Tentative / Approved / Confirmed → Cancelled  (booking called off)
 *
 * Regret and Cancelled are terminal. Reopening from either requires Admin /
 * Venue Manager override + a mandatory reason.
 */

import { isCostingEmailSent, isPaymentGateSatisfied } from "./financial-sequence";

export type EventStatus =
  | "enquiry"
  | "tentative"
  | "approved"
  | "confirmed"
  | "regret"
  | "cancelled";

/** Valid forward transitions from each status. */
const TRANSITIONS: Record<EventStatus, EventStatus[]> = {
  enquiry: ["tentative", "approved", "confirmed", "regret", "cancelled"],
  // `tentative` is a client-uncertain holding state. From here: approve/confirm or back out.
  tentative: ["approved", "confirmed", "regret", "cancelled"],
  // `approved` is the VFH approval gate. From here: confirm or back out.
  approved: ["confirmed", "regret", "cancelled"],
  confirmed: ["cancelled"],
  regret: [],
  cancelled: ["enquiry", "tentative"], // reopen with manager override
};

/** Whether the transition is allowed. */
export function canTransition(from: EventStatus, to: EventStatus): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

/** Whether the transition requires Admin/Venue Manager + a reason. */
export function requiresOverride(from: EventStatus, to: EventStatus): boolean {
  // Cancelling a confirmed booking is a sensitive change.
  if (from === "confirmed" && to === "cancelled") return true;
  // Reopening a terminal state (cancelled/regret) requires override.
  if (from === "cancelled" || from === "regret") return true;
  return false;
}

/** Whether the approval workflow applies (VFH only). */
export function requiresApproval(eventType: string | null): boolean {
  return eventType === "VFH";
}

/**
 * Whether "Save as Confirmed" is enabled. Requires:
 *  - Costing email = Yes (first post-inquiry financial step).
 *  - Payment Status = Completed after costing (invalid Completed-without-costing
 *    does not satisfy the gate).
 *  - Signed confirmation.
 *  - VFH approval received/approved — UNLESS approval is marked Not Required,
 *    in which case the approval checklist must not impede confirmation.
 */
export function canConfirm(args: {
  eventType: string | null;
  confirmationStatus: string | null;
  approvalStatus: string | null;
  costingEmail?: string | null;
  paymentStatus?: string | null;
}): boolean {
  // Financials gate — costing → payment sequence.
  if (!isCostingEmailSent(args.costingEmail)) {
    return false;
  }
  if (!isPaymentGateSatisfied(args.costingEmail, args.paymentStatus)) {
    return false;
  }
  const signed = args.confirmationStatus === "signed_received";
  if (!signed) return false;
  if (requiresApproval(args.eventType)) {
    // Approval marked Not Required: the approval checklist does not gate.
    if (args.approvalStatus === "not_required") return true;
    return args.approvalStatus === "received" || args.approvalStatus === "approved";
  }
  return true;
}

export const STATUS_LABELS: Record<EventStatus, string> = {
  enquiry: "Enquiry",
  tentative: "Tentative",
  approved: "Approved",
  confirmed: "Confirmed",
  regret: "Regret",
  cancelled: "Cancelled",
};

/** Status token key (maps to the Tailwind status colour tokens). */
export const STATUS_TOKEN: Record<EventStatus, string> = {
  enquiry: "enquiry",
  tentative: "tentative",
  approved: "approved",
  confirmed: "confirmed",
  regret: "regret",
  cancelled: "cancelled",
};
