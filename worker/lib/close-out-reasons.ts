/**
 * Structured reasons for regret and cancel transitions (analytics-ready codes).
 */

export const CLOSE_OUT_REASON_CODES = [
  "not_approved",
  "cost",
  "dates",
  "capacity",
  "competitor",
  "client_no_response",
  "scope_mismatch",
  "other",
] as const;

export type CloseOutReasonCode = (typeof CLOSE_OUT_REASON_CODES)[number];

export const CLOSE_OUT_REASON_LABELS: Record<CloseOutReasonCode, string> = {
  not_approved: "Not approved",
  cost: "Cost",
  dates: "Dates",
  capacity: "Seating capacity",
  competitor: "Competitor",
  client_no_response: "Client no response",
  scope_mismatch: "Scope mismatch",
  other: "Other",
};

const VFH_ONLY_CODES = new Set<CloseOutReasonCode>(["not_approved"]);

export function isCloseOutReasonCode(value: string): value is CloseOutReasonCode {
  return (CLOSE_OUT_REASON_CODES as readonly string[]).includes(value);
}

export function closeOutReasonsForEventType(eventType: string | null): CloseOutReasonCode[] {
  const vfh = eventType === "VFH";
  return CLOSE_OUT_REASON_CODES.filter((code) => vfh || !VFH_ONLY_CODES.has(code));
}

export function closeOutReasonLabel(code: string | null | undefined): string {
  if (!code) return "—";
  if (isCloseOutReasonCode(code)) return CLOSE_OUT_REASON_LABELS[code];
  return code;
}

export function requiresStructuredCloseOutReason(to: string): boolean {
  return to === "regret" || to === "cancelled";
}

export type CloseOutReasonValidation =
  | { ok: true; reason: CloseOutReasonCode; note: string | null }
  | { ok: false; error: string };

export function validateCloseOutReasonInput(args: {
  reason: string | null | undefined;
  note: string | null | undefined;
  eventType: string | null;
}): CloseOutReasonValidation {
  const code = args.reason?.trim() ?? "";
  if (!code) {
    return { ok: false, error: "A reason is required to cancel or decline an event" };
  }
  if (!isCloseOutReasonCode(code)) {
    return { ok: false, error: "Invalid close-out reason" };
  }
  const allowed = closeOutReasonsForEventType(args.eventType);
  if (!allowed.includes(code)) {
    return { ok: false, error: "This reason is not available for this event type" };
  }

  const note = args.note?.trim() ?? "";
  if (code === "other") {
    if (!note) {
      return { ok: false, error: "Please describe the reason when selecting Other" };
    }
    return { ok: true, reason: code, note };
  }

  return { ok: true, reason: code, note: note || null };
}
