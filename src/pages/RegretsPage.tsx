import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { apiGet } from "../lib/api";
import { eventDisplayName } from "../lib/event-display";
import { formatDate } from "../lib/use-lookups";
import { STATUS_LABELS, type EventStatus } from "../../worker/lib/state-machine";
import { closeOutReasonLabel } from "../../worker/lib/close-out-reasons";

type RegretRow = {
  id: string;
  event_code: string | null;
  title: string;
  event_type: string | null;
  event_start_date: string | null;
  organisation_name: string | null;
  venues: string | null;
  event_owner: string | null;
  enquiry_source: string | null;
  lost_from_status: EventStatus | null;
  regret_reason: string | null;
  regret_note: string | null;
  regretted_at: string | null;
  regretted_by_name: string | null;
};

type RegretsResponse = {
  regrets: RegretRow[];
};

export function RegretsPage() {
  const [q, setQ] = useState("");
  const [mine, setMine] = useState(false);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (mine) params.set("mine", "1");
    const built = params.toString();
    return built ? `?${built}` : "";
  }, [q, mine]);

  const { data, isLoading } = useQuery({
    queryKey: ["regrets", q, mine],
    queryFn: () => apiGet<RegretsResponse>(`/events/regrets${queryString}`),
  });

  const regrets = data?.regrets ?? [];

  return (
    <div>
      <PageHeader
        title="Regrets"
        subtitle="Events marked as regret — removed from the lifecycle calendar but kept for lost-business review"
        actions={(
          <Link to="/calendar?view=lifecycle" className="carved-btn rounded-full bg-marble-shadow/40 px-4 py-2 text-xs font-semibold text-ink-secondary etched hover:text-ink-primary">
            Lifecycle calendar →
          </Link>
        )}
      />

      <div className="carved-header mb-5 flex flex-wrap items-center gap-3 rounded-2xl bg-marble-highlight/60 p-3">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search organisation, event, or reason…"
          className="carved input min-w-[14rem] flex-1"
        />
        <label className="flex items-center gap-2 text-xs font-medium text-ink-secondary etched">
          <input
            type="checkbox"
            checked={mine}
            onChange={(e) => setMine(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-ink-muted"
          />
          My events only
        </label>
        <span className="text-xs text-ink-muted etched">{regrets.length} record{regrets.length === 1 ? "" : "s"}</span>
      </div>

      {isLoading ? (
        <p className="text-sm text-ink-muted etched">Loading…</p>
      ) : regrets.length === 0 ? (
        <div className="carved-card rounded-2xl bg-marble-highlight/50 p-10 text-center">
          <p className="text-sm text-ink-secondary etched">No regretted events match your filters.</p>
        </div>
      ) : (
        <div className="carved-card overflow-hidden rounded-2xl bg-marble-highlight/50">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-marble-shadow/40 text-[11px] font-semibold uppercase tracking-wider text-sage etched">
                  <th className="px-4 py-3">Event</th>
                  <th className="px-4 py-3">Organisation</th>
                  <th className="px-4 py-3">Lost at</th>
                  <th className="px-4 py-3">Regretted</th>
                  <th className="px-4 py-3">Reason</th>
                  <th className="px-4 py-3">Venues</th>
                </tr>
              </thead>
              <tbody>
                {regrets.map((row) => (
                  <tr key={row.id} className="border-b border-marble-shadow/25 last:border-0 hover:bg-marble-shadow/20">
                    <td className="px-4 py-3 align-top">
                      <Link to={`/events/${row.id}`} className="font-semibold text-sage-text hover:underline etched-deep">
                        {eventDisplayName(row.title, row.organisation_name)}
                      </Link>
                      {row.event_code && (
                        <div className="mt-0.5 text-[11px] text-ink-muted etched">{row.event_code}</div>
                      )}
                      {row.event_start_date && (
                        <div className="mt-0.5 text-[11px] text-ink-muted etched">Event date {formatDate(row.event_start_date)}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top text-ink-secondary etched">{row.organisation_name ?? "—"}</td>
                    <td className="px-4 py-3 align-top">
                      {row.lost_from_status ? (
                        <StatusBadge status={row.lost_from_status} />
                      ) : (
                        <span className="text-ink-muted etched">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top text-ink-secondary etched">
                      <div>{row.regretted_at ? formatDate(row.regretted_at.slice(0, 10)) : "—"}</div>
                      {row.regretted_by_name && (
                        <div className="mt-0.5 text-[11px] text-ink-muted etched">by {row.regretted_by_name}</div>
                      )}
                    </td>
                    <td className="max-w-xs px-4 py-3 align-top text-ink-secondary etched">
                      <div>{closeOutReasonLabel(row.regret_reason)}</div>
                      {row.regret_note && (
                        <div className="mt-1 text-[11px] text-ink-muted etched">{row.regret_note}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top text-ink-muted etched">{row.venues ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="mt-4 text-xs text-ink-muted etched">
        Regrets are terminal. Reopening an event from regret requires an override on the event record.
        Lost-at stage shows the pipeline status before regret ({Object.entries(STATUS_LABELS).filter(([k]) => k !== "regret" && k !== "cancelled").map(([, v]) => v).slice(0, 3).join(", ")}, etc.).
      </p>
    </div>
  );
}
