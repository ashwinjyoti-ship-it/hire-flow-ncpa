/**
 * Event status state machine. Server-side validation blocks invalid transitions.
 *
 * Primary lifecycle:
 *   Draft → Inquiry → Availability Check → Awaiting Approval (VFH) →
 *     Waitlisted/Tentative → Confirmed → In Progress → Completed → Closed
 *
 * Side-paths:
 *   Awaiting Approval → Cancelled
 *   Approved → Cancelled
 *   Confirmed → Cancelled
 *   In Progress → Cancelled (Admin/Venue Manager + mandatory reason)
 *
 * Waitlisted may transition to: Awaiting Approval, Approved, Confirmed, Cancelled.
 * Draft exists only as an internal unsent form state before Inquiry.
 */

export type EventStatus =
  | "draft"
  | "inquiry"
  | "availability_check"
  | "awaiting_approval"
  | "waitlisted"
  | "tentative"
  | "approved"
  | "confirmed"
  | "in_progress"
  | "completed"
  | "closed"
  | "cancelled"
  | "rejected";

/** Valid forward transitions from each status. */
const TRANSITIONS: Record<EventStatus, EventStatus[]> = {
  draft: ["inquiry", "cancelled"],
  inquiry: ["availability_check", "awaiting_approval", "waitlisted", "tentative", "confirmed", "cancelled", "rejected"],
  availability_check: ["awaiting_approval", "waitlisted", "tentative", "confirmed", "cancelled", "rejected", "inquiry"],
  awaiting_approval: ["approved", "waitlisted", "tentative", "cancelled", "rejected"],
  waitlisted: ["awaiting_approval", "approved", "confirmed", "tentative", "cancelled"],
  tentative: ["awaiting_approval", "confirmed", "waitlisted", "cancelled", "rejected"],
  approved: ["confirmed", "cancelled"],
  confirmed: ["in_progress", "completed", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: ["closed"],
  closed: [],
  cancelled: ["inquiry", "tentative"], // reopen with manager override
  rejected: ["inquiry", "tentative"],
};

/** Whether the transition is allowed. */
export function canTransition(from: EventStatus, to: EventStatus): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

/** Whether the transition requires Admin/Venue Manager + a reason. */
export function requiresOverride(from: EventStatus, to: EventStatus): boolean {
  // Cancelling an in-progress event, or reopening a terminal/cancelled state.
  if (from === "in_progress" && to === "cancelled") return true;
  if (from === "cancelled" || from === "rejected" || from === "closed") return true;
  // Confirmed → Cancelled is a sensitive change.
  if (from === "confirmed" && to === "cancelled") return true;
  void from;
  void to;
  return false;
}

/** Whether the approval workflow applies (VFH only). */
export function requiresApproval(eventType: string | null): boolean {
  return eventType === "VFH";
}

/** Whether "Save as Confirmed" is enabled: signed confirmation (+ approval if VFH). */
export function canConfirm(args: {
  eventType: string | null;
  confirmationStatus: string | null;
  approvalStatus: string | null;
}): boolean {
  const signed = args.confirmationStatus === "signed_received";
  if (!signed) return false;
  if (requiresApproval(args.eventType)) {
    return args.approvalStatus === "received" || args.approvalStatus === "approved";
  }
  return true;
}

export const STATUS_LABELS: Record<EventStatus, string> = {
  draft: "Draft",
  inquiry: "Inquiry",
  availability_check: "Availability Check",
  awaiting_approval: "Awaiting Approval",
  waitlisted: "Waitlisted",
  tentative: "Tentative",
  approved: "Approved",
  confirmed: "Confirmed",
  in_progress: "In Progress",
  completed: "Completed",
  closed: "Closed",
  cancelled: "Cancelled",
  rejected: "Rejected",
};

/** Status token key (maps to the Tailwind status colour tokens). */
export const STATUS_TOKEN: Record<EventStatus, string> = {
  draft: "draft",
  inquiry: "inquiry",
  availability_check: "availability",
  awaiting_approval: "awaitingApproval",
  waitlisted: "waitlisted",
  tentative: "tentative",
  approved: "approved",
  confirmed: "confirmed",
  in_progress: "inProgress",
  completed: "completed",
  closed: "closed",
  cancelled: "cancelled",
  rejected: "rejected",
};
