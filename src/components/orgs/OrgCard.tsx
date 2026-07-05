/** Result card for one organisation in the right-hand results grid. */
import { Link } from "react-router-dom";
import { formatDate } from "../../lib/use-lookups";
import type { OrgSummary } from "./types";

export function OrgCard({ org }: { org: OrgSummary }) {
  return (
    <div className="carved-card flex flex-col gap-2 rounded-2xl bg-marble-highlight/50 p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink-primary etched-deep">{org.name}</h3>
        {org.org_type && (
          <span className="carved-btn shrink-0 rounded-full bg-neutral-btn px-2 py-0.5 text-[10px] font-medium text-ink-secondary etched">
            {org.org_type}
          </span>
        )}
      </div>

      <dl className="space-y-1 text-xs text-ink-secondary etched">
        <div className="flex items-center justify-between gap-2">
          <dt className="text-ink-muted">Primary contact</dt>
          <dd className="font-medium text-ink-primary etched-deep">{org.primary_contact_name ?? "—"}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-ink-muted">Last event</dt>
          <dd className="font-medium text-ink-primary etched-deep">{formatDate(org.last_event_date)}</dd>
        </div>
      </dl>

      <div className="mt-1 flex items-center justify-between border-t border-ink-muted/10 pt-2">
        <span className="text-xs text-ink-muted etched">
          {org.event_count} event{org.event_count === 1 ? "" : "s"}
        </span>
        {org.event_count > 0 && (
          <Link
            to={`/calendar?org=${encodeURIComponent(org.id)}`}
            className="text-xs font-medium text-sage-text hover:underline etched"
          >
            View events →
          </Link>
        )}
      </div>
    </div>
  );
}
