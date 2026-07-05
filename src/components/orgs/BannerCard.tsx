/** One horizontal card inside the "Same time last year" banner. */
import { formatDate } from "../../lib/use-lookups";
import type { OrgSummary } from "./types";

export function BannerCard({
  org,
  onReachOut,
}: {
  org: OrgSummary;
  onReachOut: (org: OrgSummary) => void;
}) {
  return (
    <div className="carved-card flex w-72 shrink-0 flex-col gap-2 rounded-2xl bg-marble-highlight/60 p-4">
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-semibold text-ink-primary etched-deep">{org.name}</h4>
        <span className="carved-btn shrink-0 rounded-full bg-neutral-btn px-2 py-0.5 text-[10px] font-medium text-ink-secondary etched">
          {org.event_count} event{org.event_count === 1 ? "" : "s"}
        </span>
      </div>
      <dl className="space-y-1 text-xs">
        <div className="flex items-center justify-between gap-2">
          <dt className="text-ink-muted etched">Last year</dt>
          <dd className="font-medium text-ink-primary etched-deep">{formatDate(org.last_event_date)}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-ink-muted etched">Contact</dt>
          <dd className="font-medium text-ink-primary etched-deep">{org.primary_contact_name ?? "—"}</dd>
        </div>
      </dl>
      <button
        type="button"
        onClick={() => onReachOut(org)}
        className="carved-btn-sage mt-1 self-start rounded-full bg-sage-btn px-4 py-1.5 text-xs font-semibold text-sage-text etched hover:bg-sage-btn-hover"
      >
        Reach out →
      </button>
    </div>
  );
}
