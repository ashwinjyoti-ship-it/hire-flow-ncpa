import {
  COSTING_EMAIL_BLOCKER,
  PAYMENT_COMPLETED_BLOCKER,
} from "../../worker/lib/financial-sequence";
import { getEventPocEditLink } from "./event-edit-form";

/**
 * Maps lifecycle blocker copy → Operations checklist field to open/scroll to.
 * Keys must match `blockersForTransition()` in worker/lib/operations.ts exactly.
 *
 * Intentionally unmapped (not a checklist field):
 * - "Approved is only used for VFH events."
 */
export const BLOCKER_TARGETS: Record<
  string,
  { tab: "operations" | "accounts"; fieldKey: string; label: string }
> = {
  [COSTING_EMAIL_BLOCKER]: {
    tab: "operations",
    fieldKey: "costing_email",
    label: "Costing Email",
  },
  [PAYMENT_COMPLETED_BLOCKER]: {
    tab: "operations",
    fieldKey: "payment_status",
    label: "Payment Status",
  },
  "Confirmation letter must be made.": {
    tab: "operations",
    fieldKey: "confirmation_made",
    label: "Confirmation Letter Made",
  },
  "Confirmation letter must be couriered.": {
    tab: "operations",
    fieldKey: "confirmation_couriered",
    label: "Confirmation Letter Couriered",
  },
  "Signed confirmation must be received.": {
    tab: "operations",
    fieldKey: "confirmation_signed_received",
    label: "Signed Copy Received",
  },
  "VFH approval must be received or approved.": {
    tab: "operations",
    fieldKey: "approval_received_on",
    label: "Approval Received On",
  },
  "VFH approval must be received before marking the event approved.": {
    tab: "operations",
    fieldKey: "approval_received_on",
    label: "Approval Received On",
  },
  "POC not filled, cannot confirm.": {
    tab: "operations",
    fieldKey: "poc_name",
    label: "POC Name",
  },
};

/** Every actionable blocker string emitted by `blockersForTransition`. */
export const ACTIONABLE_LIFECYCLE_BLOCKERS = [
  COSTING_EMAIL_BLOCKER,
  PAYMENT_COMPLETED_BLOCKER,
  "Confirmation letter must be made.",
  "Confirmation letter must be couriered.",
  "Signed confirmation must be received.",
  "VFH approval must be received or approved.",
  "VFH approval must be received before marking the event approved.",
  "POC not filled, cannot confirm.",
] as const;

/** Resolve a lifecycle blocker target to the page the user should open. */
export function resolveBlockerWorkHref(
  eventId: string,
  target: { tab: "operations" | "accounts"; fieldKey: string },
): string {
  if (target.fieldKey === "poc_name") return getEventPocEditLink(eventId);
  return `/events/${eventId}?tab=${target.tab}&field=${encodeURIComponent(target.fieldKey)}`;
}
