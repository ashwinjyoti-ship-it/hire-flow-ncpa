import clsx from "clsx";
import { STATUS_LABELS, STATUS_TOKEN } from "../../worker/lib/state-machine";
import type { EventStatus } from "../../worker/lib/state-machine";

const TOKEN_BG: Record<string, string> = {
  enquiry: "bg-status-enquiry/15 text-ink-secondary",
  tentative: "bg-status-tentative/15 text-status-tentative",
  approved: "bg-status-approved/15 text-sage-text",
  confirmed: "bg-status-confirmed/15 text-sage-text",
  regret: "bg-status-regret/15 text-status-regret",
  cancelled: "bg-status-cancelled/15 text-status-cancelled",
};

const DOT_BG: Record<string, string> = {
  enquiry: "bg-status-enquiry",
  tentative: "bg-status-tentative",
  approved: "bg-status-approved",
  confirmed: "bg-status-confirmed",
  regret: "bg-status-regret",
  cancelled: "bg-status-cancelled",
};

/** Status pill: dot + label. Colour is never the sole signal (per accessibility spec). */
export function StatusBadge({ status, size = "sm" }: { status: EventStatus; size?: "sm" | "md" }) {
  const token = STATUS_TOKEN[status] ?? "enquiry";
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
