import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { apiGet, type EventSummary } from "../lib/api";
import { formatDate } from "../lib/use-lookups";
import type { EventStatus } from "../../worker/lib/state-machine";

type EventsResponse = { events: EventSummary[] };
type CalResponse = { byDate: Record<string, unknown> };

export function DashboardPage() {
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const monthStartIso = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, "0")}-${String(monthStart.getDate()).padStart(2, "0")}`;
  const monthEndIso = `${monthEnd.getFullYear()}-${String(monthEnd.getMonth() + 1).padStart(2, "0")}-${String(monthEnd.getDate()).padStart(2, "0")}`;
  const in7 = new Date(today.getTime() + 7 * 86400_000);
  const in7Iso = `${in7.getFullYear()}-${String(in7.getMonth() + 1).padStart(2, "0")}-${String(in7.getDate()).padStart(2, "0")}`;

  const { data } = useQuery({
    queryKey: ["events", "dashboard", monthStartIso, monthEndIso],
    queryFn: () => apiGet<EventsResponse>(`/events?from=${monthStartIso}&to=${monthEndIso}`),
  });
  const { data: cal } = useQuery({
    queryKey: ["calendar", "dashboard", todayIso, in7Iso],
    queryFn: () => apiGet<CalResponse>(`/calendar?from=${todayIso}&to=${in7Iso}`),
  });

  const events = data?.events ?? [];
  const todayEntries = (cal?.byDate?.[todayIso] as Array<{ id: string; title: string; venue: string; activity_type: string; start_time: string | null; event_id: string }> | undefined) ?? [];

  const counts: Record<string, number> = { enquiry: 0, tentative: 0, approved: 0, confirmed: 0, regret: 0, cancelled: 0 };
  for (const e of events) {
    if (e.status in counts) counts[e.status] = (counts[e.status] ?? 0) + 1;
  }

  return (
    <div>
      <PageHeader title="Dashboard" subtitle={`${today.toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "Asia/Kolkata" })} operational overview`} />

      {/* Summary cards */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <SummaryCard label="Enquiries" value={counts.enquiry ?? 0} status="enquiry" href={`/calendar?view=lifecycle&status=enquiry&from=${monthStartIso}`} />
        <SummaryCard label="Tentative" value={counts.tentative ?? 0} status="tentative" href={`/calendar?view=lifecycle&status=tentative&from=${monthStartIso}`} />
        <SummaryCard label="Confirmed" value={counts.confirmed ?? 0} status="confirmed" href={`/calendar?view=lifecycle&status=confirmed&from=${monthStartIso}`} />
        <SummaryCard label="Regret" value={counts.regret ?? 0} status="regret" href={`/calendar?view=lifecycle&status=regret&from=${monthStartIso}`} />
        <SummaryCard label="Cancelled" value={counts.cancelled ?? 0} status="cancelled" href={`/calendar?view=lifecycle&status=cancelled&from=${monthStartIso}`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Today section */}
        <section className="carved-card rounded-2xl bg-marble-highlight/50 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-sage etched">Today</h2>
            <Link to="/calendar" className="text-xs text-sage-text hover:underline">Calendar →</Link>
          </div>
          {todayEntries.length === 0 ? (
            <p className="text-sm text-ink-muted etched">No activities scheduled today.</p>
          ) : (
            <ul className="space-y-2">
              {todayEntries.map((e) => (
                <li key={e.id}>
                  <Link to={`/events/${e.event_id}`} className="flex items-center gap-3 rounded-lg bg-marble-shadow/30 px-3 py-2 hover:bg-marble-shadow/50">
                    <span className="w-16 shrink-0 text-xs font-medium text-ink-secondary etched">{e.start_time ?? "—"}</span>
                    <span className="flex-1 truncate text-sm font-medium text-ink-primary etched-deep">{e.title}</span>
                    <span className="shrink-0 text-xs text-ink-muted etched">{e.venue}</span>
                    <span className="shrink-0 text-[10px] uppercase tracking-wider text-sage etched">{e.activity_type.replace(/_/g, " ")}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Recent events needing attention */}
        <section className="carved-card rounded-2xl bg-marble-highlight/50 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-sage etched">Active Events</h2>
            <Link to="/calendar?view=lifecycle" className="text-xs text-sage-text hover:underline">Lifecycle →</Link>
          </div>
          {events.length === 0 ? (
            <p className="text-sm text-ink-muted etched">No active events.</p>
          ) : (
            <ul className="space-y-2">
              {events.slice(0, 8).map((e) => (
                <li key={e.id}>
                  <Link to={`/events/${e.id}`} className="flex items-center gap-3 rounded-lg bg-marble-shadow/30 px-3 py-2 hover:bg-marble-shadow/50">
                    <span className="flex-1 truncate">
                      <span className="block text-sm font-medium text-ink-primary etched-deep">{e.title}</span>
                      <span className="block text-[11px] text-ink-muted etched">{e.venues ?? "—"} · {e.event_start_date ? formatDate(e.event_start_date) : "—"}</span>
                    </span>
                    <StatusBadge status={e.status as EventStatus} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, status, href }: { label: string; value: number; status: EventStatus; href: string }) {
  return (
    <Link to={href} className="carved-card rounded-2xl bg-marble-highlight/50 p-4 transition-colors hover:bg-marble-highlight/80">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted etched">{label}</span>
        <StatusBadge status={status} />
      </div>
      <div className="text-3xl font-semibold text-ink-primary etched-deep">{value}</div>
    </Link>
  );
}
