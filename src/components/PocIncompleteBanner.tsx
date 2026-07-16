import { Link } from "react-router-dom";
import type { PocCompletionStatus } from "../../worker/lib/poc-completion";

export function PocIncompleteBanner({
  poc,
  eventId,
  compact = false,
}: {
  poc: PocCompletionStatus;
  eventId: string;
  compact?: boolean;
}) {
  if (poc.complete) return null;

  return (
    <div
      role="alert"
      className={
        "rounded-2xl border border-status-awaitingApproval/35 bg-status-awaitingApproval/12 px-4 py-3 " +
        (compact ? "" : "mb-5")
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-status-awaitingApproval etched-deep">
            Point of Contact incomplete ({poc.filledCount}/{poc.totalCount})
          </p>
          <p className="mt-1 text-xs text-ink-secondary etched">
            {poc.missingLabels.length > 0
              ? `Still needed: ${poc.missingLabels.join(", ")}`
              : "Required Point of Contact fields must be filled before this event can be confirmed."}
          </p>
        </div>
        <Link
          to={`/events/${eventId}/edit?step=0&section=poc`}
          className="carved-btn shrink-0 rounded-full bg-status-awaitingApproval/15 px-3 py-1.5 text-xs font-semibold text-status-awaitingApproval etched"
        >
          Open event form
        </Link>
      </div>
    </div>
  );
}

export function PocStatusBadge({ complete }: { complete: boolean }) {
  if (complete) return null;
  return (
    <span className="rounded-full bg-status-awaitingApproval/15 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-status-awaitingApproval etched">
      POC incomplete
    </span>
  );
}
