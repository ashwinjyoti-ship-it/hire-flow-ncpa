import clsx from "clsx";
import { getEventStatusSurface } from "../lib/event-status-surface";
import { STATUS_LABELS } from "../../worker/lib/state-machine";
import type { EventStatus } from "../../worker/lib/state-machine";

/** Status pill: dot + label. Colour is never the sole signal (per accessibility spec). */
export function StatusBadge({ status, size = "sm" }: { status: EventStatus; size?: "sm" | "md" }) {
  const label = STATUS_LABELS[status] ?? status;
  const surface = getEventStatusSurface(status);
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full etched",
        surface.badge,
        size === "sm" ? "px-2 py-0.5 text-[11px] font-medium" : "px-3 py-1 text-xs font-semibold"
      )}
    >
      <span className={clsx("h-1.5 w-1.5 rounded-full evt-dot", surface.dot ?? "bg-ink-muted")} />
      {label}
    </span>
  );
}
