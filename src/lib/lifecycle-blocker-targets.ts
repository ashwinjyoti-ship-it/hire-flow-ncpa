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
  "Costing email must be sent.": {
    tab: "operations",
    fieldKey: "costing_email",
    label: "Costing Email",
  },
  "Payment must be completed.": {
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
  "Costing email must be sent.",
  "Payment must be completed.",
  "Confirmation letter must be made.",
  "Confirmation letter must be couriered.",
  "Signed confirmation must be received.",
  "VFH approval must be received or approved.",
  "VFH approval must be received before marking the event approved.",
  "POC not filled, cannot confirm.",
] as const;
