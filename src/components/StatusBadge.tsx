import clsx from "clsx";
import { STATUS_LABELS, STATUS_TOKEN } from "../../worker/lib/state-machine";
import type { EventStatus } from "../../worker/lib/state-machine";

const TOKEN_BG: Record<string, string> = {
  inquiry: "bg-status-inquiry/15 text-ink-secondary",
  availability: "bg-status-availability/15 text-status-availability",
  awaitingApproval: "bg-status-awaitingApproval/15 text-status-awaitingApproval",
  waitlisted: "bg-status-waitlisted/15 text-status-waitlisted",
  tentative: "bg-status-tentative/15 text-status-tentative",
  confirmed: "bg-status-confirmed/15 text-sage-text",
  inProgress: "bg-status-inProgress/15 text-status-inProgress",
  completed: "bg-status-completed/15 text-status-completed",
  closed: "bg-status-closed/15 text-status-closed",
  cancelled: "bg-status-cancelled/15 text-status-cancelled",
  rejected: "bg-status-rejected/15 text-status-rejected",
  approved: "bg-status-approved/15 text-sage-text",
  draft: "bg-status-draft/15 text-ink-muted",
};

const DOT_BG: Record<string, string> = {
  inquiry: "bg-status-inquiry",
  availability: "bg-status-availability",
  awaitingApproval: "bg-status-awaitingApproval",
  waitlisted: "bg-status-waitlisted",
  tentative: "bg-status-tentative",
  confirmed: "bg-status-confirmed",
  inProgress: "bg-status-inProgress",
  completed: "bg-status-completed",
  closed: "bg-status-closed",
  cancelled: "bg-status-cancelled",
  rejected: "bg-status-rejected",
  approved: "bg-status-approved",
  draft: "bg-status-draft",
};

/** Status pill: dot + label. Colour is never the sole signal (per accessibility spec). */
export function StatusBadge({ status, size = "sm" }: { status: EventStatus; size?: "sm" | "md" }) {
  const token = STATUS_TOKEN[status] ?? "draft";
  const label = STATUS_LABELS[status] ?? status;
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full etched",
        TOKEN_BG[token] ?? "bg-marble-shadow/40 text-ink-secondary",
        size === "sm" ? "px-2 py-0.5 text-[11px] font-medium" : "px-3 py-1 text-xs font-semibold"
      )}
    >
      <span className={clsx("h-1.5 w-1.5 rounded-full evt-dot", DOT_BG[token] ?? "bg-ink-muted")} />
      {label}
    </span>
  );
}
