import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { apiGet, type EventSummary } from "../lib/api";
import { useLookups, formatDate } from "../lib/use-lookups";
import { useAuth } from "../lib/auth";
import { can } from "../lib/can";
import type { EventStatus } from "../../worker/lib/state-machine";
import { STATUS_LABELS, STATUS_TOKEN } from "../../worker/lib/state-machine";

type CalEntry = {
  id: string;
  activity_type: string;
  activity_date: string;
  start_time: string | null;
  end_time: string | null;
  event_id: string;
  title: string;
  status: EventStatus;
  event_type: string | null;
  organisation_name: string | null;
  venue: string;
};
type CalResponse = { entries: CalEntry[]; byDate: Record<string, CalEntry[]> };

type View = "month" | "week" | "day" | "venue" | "list";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function startOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), 1); }
function startOfWeek(d: Date): Date { const x = new Date(d); x.setDate(d.getDate() - d.getDay()); x.setHours(0, 0, 0, 0); return x; }
function isoDate(d: Date): string { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(d.getDate() + n); return x; }

export function CalendarPage() {
  const { user } = useAuth();
  const { data: lookups } = useLookups();
  const [searchParams] = useSearchParams();
  const initialView = (searchParams.get("view") as View | null) ?? "month";
  const initialFrom = searchParams.get("from");
  const [view, setView] = useState<View>(["month", "week", "day", "venue", "list"].includes(initialView) ? initialView : "month");
  const [cursor, setCursor] = useState(() => initialFrom ? new Date(`${initialFrom}T00:00:00`) : new Date());
  const [filters, setFilters] = useState({
    status: searchParams.get("status") ?? "",
    venue: searchParams.get("venue") ?? "",
    type: searchParams.get("type") ?? "",
    owner: searchParams.get("owner") ?? "",
    q: searchParams.get("q") ?? "",
  });
  const [sideEvent, setSideEvent] = useState<CalEntry | null>(null);

  // Determine the visible date range based on the view.
  const range = useMemo(() => {
    if (view === "month") return { from: isoDate(startOfWeek(startOfMonth(cursor))), to: isoDate(addDays(startOfWeek(startOfMonth(cursor)), 41)) };
    if (view === "week") return { from: isoDate(startOfWeek(cursor)), to: isoDate(addDays(startOfWeek(cursor), 6)) };
    if (view === "day") return { from: isoDate(cursor), to: isoDate(cursor) };
    if (view === "list") {
      return { from: isoDate(startOfMonth(cursor)), to: isoDate(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0)) };
    }
    // venue timeline: show a wider span (next 30 days)
    return { from: isoDate(cursor), to: isoDate(addDays(cursor, 29)) };
  }, [view, cursor]);

  const q = new URLSearchParams({ from: range.from, to: range.to, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) });
  const { data, isLoading } = useQuery({
    queryKey: ["calendar", range.from, range.to, filters],
    queryFn: () => apiGet<CalResponse>(`/calendar?${q.toString()}`),
    enabled: view !== "list",
  });

  // List view uses the events endpoint (sortable table, full filter set).
  const listQuery = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => { if (v) listQuery.set(k, v); });
  listQuery.set("from", range.from);
  listQuery.set("to", range.to);
  const { data: listData, isLoading: listLoading } = useQuery<{ events: EventSummary[] }>({
    queryKey: ["events", filters, range.from, range.to],
    queryFn: () => apiGet(`/events?${listQuery.toString()}`),
    enabled: view === "list",
  });

  const byDate = data?.byDate ?? {};
  const today = isoDate(new Date());
  const venues = lookups?.lookups.venue ?? [];
  const owners = lookups?.lookups.handled_by ?? [];

  const title = view === "list"
    ? `${formatDate(range.from)} – ${formatDate(range.to)}`
    : view === "month" || view === "venue"
      ? cursor.toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "Asia/Kolkata" })
      : view === "week"
        ? `${formatDate(range.from)} – ${formatDate(range.to)}`
        : formatDate(range.from);

  const showCreate = can(user?.role ?? "viewer", "event.create");

  return (
    <div>
      <PageHeader
        title={view === "month" ? title : "Calendar"}
        subtitle={view === "month" ? "Operating calendar" : title}
        actions={showCreate ? (
          <Link to="/events/new" className="carved-btn-sage rounded-full bg-sage-btn px-5 py-2 text-sm font-semibold text-sage-text etched">
            + New Event
          </Link>
        ) : null}
      />

      {/* Controls */}
      <div className="carved-header mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-marble-highlight/60 p-3 backdrop-blur-sm">
        <div className="flex items-center gap-1 rounded-full bg-marble-shadow/40 p-1">
          {(["month", "week", "day", "venue", "list"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={"rounded-full px-4 py-1.5 text-xs font-semibold etched " + (view === v ? "bg-sage-btn text-sage-text carved-btn-sage" : "text-ink-muted hover:text-ink-secondary")}
            >
              {v === "venue" ? "Timeline" : v[0]!.toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>

        {(view !== "list" || searchParams.get("from")) && (
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => { if (view === "month" || view === "list") setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1)); else if (view === "week") setCursor(addDays(cursor, -7)); else if (view === "day") setCursor(addDays(cursor, -1)); else setCursor(addDays(cursor, -30)); }} className="carved-btn flex h-8 w-8 items-center justify-center rounded-full bg-neutral-btn text-sage-text" aria-label="Previous">
              <Chevron dir="left" />
            </button>
            <button type="button" onClick={() => setCursor(new Date())} className="carved-btn-sage rounded-full bg-sage-btn px-4 py-1.5 text-xs font-semibold text-sage-text etched">Jump to today</button>
            <button type="button" onClick={() => { if (view === "month" || view === "list") setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)); else if (view === "week") setCursor(addDays(cursor, 7)); else if (view === "day") setCursor(addDays(cursor, 1)); else setCursor(addDays(cursor, 30)); }} className="carved-btn flex h-8 w-8 items-center justify-center rounded-full bg-neutral-btn text-sage-text" aria-label="Next">
              <Chevron dir="right" />
            </button>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={filters.q}
            onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
            placeholder="Search title, org…"
            className="carved rounded-full bg-marble-shadow/40 px-3 py-1.5 text-xs text-ink-primary focus:outline-none"
          />
          <FilterSelect value={filters.status} onChange={(v) => setFilters((f) => ({ ...f, status: v }))} options={[{ value: "", label: "All statuses" }, ...Object.entries(STATUS_LABELS).map(([k, v]) => ({ value: k, label: v }))]} />
          <FilterSelect value={filters.venue} onChange={(v) => setFilters((f) => ({ ...f, venue: v }))} options={[{ value: "", label: "All venues" }, ...venues.map((o) => ({ value: o.value, label: o.value }))]} />
          <FilterSelect value={filters.type} onChange={(v) => setFilters((f) => ({ ...f, type: v }))} options={[{ value: "", label: "All types" }, { value: "EE", label: "EE" }, { value: "FR", label: "FR" }, { value: "VFH", label: "VFH" }, { value: "Free Event", label: "Free Event" }]} />
          <FilterSelect value={filters.owner} onChange={(v) => setFilters((f) => ({ ...f, owner: v }))} options={[{ value: "", label: "All owners" }, ...owners.map((o) => ({ value: o.value, label: o.value }))]} />
        </div>
      </div>

      {/* Legend */}
      {view !== "list" && (
        <div className="mb-4 flex flex-wrap gap-3 text-[11px] text-ink-muted etched">
          {Object.entries(STATUS_LABELS).map(([k, label]) => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <span className={"h-2 w-2 rounded-full " + DOT_CLASS[STATUS_TOKEN[k as EventStatus] ?? "enquiry"]} /> {label}
            </span>
          ))}
        </div>
      )}

      {view === "list" ? (
        <EventsListView events={listData?.events ?? []} loading={listLoading} />
      ) : isLoading ? (
        <div className="text-sm text-ink-muted">Loading…</div>
      ) : view === "month" ? (
        <MonthGrid byDate={byDate} today={today} cursor={cursor} onPick={setSideEvent} />
      ) : view === "week" ? (
        <WeekDayList byDate={byDate} days={7} start={startOfWeek(cursor)} today={today} onPick={setSideEvent} />
      ) : view === "day" ? (
        <WeekDayList byDate={byDate} days={1} start={cursor} today={today} onPick={setSideEvent} />
      ) : (
        <VenueTimeline byDate={byDate} venues={venues.map((v) => v.value)} start={cursor} onPick={setSideEvent} />
      )}

      {/* Side panel */}
      {sideEvent && (
        <div className="fixed inset-0 z-50 flex justify-end bg-ink-primary/20 backdrop-blur-sm" onClick={() => setSideEvent(null)}>
          <aside className="carved-card h-full w-full max-w-md overflow-y-auto scroll-slim rounded-l-2xl bg-marble-highlight p-6" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-sage etched">{sideEvent.activity_type.replace(/_/g, " ")}</div>
                <h3 className="text-lg font-semibold text-ink-primary etched-deep">{sideEvent.title}</h3>
              </div>
              <button type="button" onClick={() => setSideEvent(null)} className="text-ink-muted hover:text-ink-secondary" aria-label="Close">✕</button>
            </div>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-ink-muted">Venue</dt><dd className="font-medium text-ink-primary etched-deep">{sideEvent.venue}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-muted">Date</dt><dd className="font-medium text-ink-primary etched-deep">{formatDate(sideEvent.activity_date)}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-muted">Time</dt><dd className="font-medium text-ink-primary etched-deep">{sideEvent.start_time ?? "—"}{sideEvent.end_time ? ` – ${sideEvent.end_time}` : ""}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-muted">Organisation</dt><dd className="font-medium text-ink-primary etched-deep">{sideEvent.organisation_name ?? "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-muted">Type</dt><dd className="font-medium text-ink-primary etched-deep">{sideEvent.event_type ?? "—"}</dd></div>
            </dl>
            <Link to={`/events/${sideEvent.event_id}`} className="carved-btn-sage mt-6 inline-block rounded-full bg-sage-btn px-5 py-2 text-sm font-semibold text-sage-text etched">
              Open full record →
            </Link>
          </aside>
        </div>
      )}
    </div>
  );
}

// ---- Month grid (one chip per organisation per day) ----
// Days can get crowded; we collapse to a single status-coloured chip per org
// (worst status wins) so the month view stays readable. The side panel and the
// detail page carry the full breakdown (venues, activities, AC timings).
const STATUS_RANK: Record<EventStatus, number> = {
  cancelled: 0, regret: 1, enquiry: 2, tentative: 3, approved: 4, confirmed: 5,
};

function MonthGrid({ byDate, today, cursor, onPick }: { byDate: Record<string, CalEntry[]>; today: string; cursor: Date; onPick: (e: CalEntry) => void }) {
  const start = startOfWeek(startOfMonth(cursor));
  const days: Date[] = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  return (
    <div>
      <div className="mb-3 grid grid-cols-7 gap-3">
        {WEEKDAYS.map((d) => (
          <div key={d} className="text-center text-[11px] font-bold uppercase tracking-wider text-ink-dayHeader etched">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-3">
        {days.map((d) => {
          const key = isoDate(d);
          const entries = byDate[key] ?? [];
          const isToday = key === today;
          const inMonth = d.getMonth() === cursor.getMonth();
          // Group entries by organisation, pick the "worst" (lowest-rank) status as the chip colour.
          const byOrg = new Map<string, { name: string; status: EventStatus; entry: CalEntry }>();
          for (const e of entries) {
            const orgKey = e.organisation_name ?? "—";
            const existing = byOrg.get(orgKey);
            if (!existing || STATUS_RANK[e.status] < STATUS_RANK[existing.status]) {
              byOrg.set(orgKey, { name: orgKey, status: e.status, entry: e });
            }
          }
          const chips = Array.from(byOrg.values());
          return (
            <article key={key} className={"min-h-[128px] rounded-xl p-3 " + (isToday ? "carved-today bg-sage-today-wash" : "carved bg-marble-highlight/40") + (!inMonth ? " carved-muted" : "")}>
              <div className="mb-2 flex justify-end">
                <span className={"flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold etched " + (isToday ? "bg-sage text-white sage-pip" : inMonth ? "text-ink-primary" : "text-ink-overflow")}>
                  {d.getDate()}
                </span>
              </div>
              <div className="space-y-1.5">
                {chips.map((c, i) => (
                  <button key={i} type="button" onClick={() => onPick(c.entry)} className="carved-card flex w-full items-center gap-1.5 rounded-md bg-marble-highlight/60 px-2 py-1 text-left">
                    <span className={"h-1.5 w-1.5 shrink-0 rounded-full evt-dot " + DOT_CLASS[STATUS_TOKEN[c.status] ?? "enquiry"]} />
                    <span className="truncate text-[11px] font-medium text-ink-secondary etched">{c.name}</span>
                  </button>
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

// ---- List view (sortable, filterable table — replaces the retired Events tab) ----
function EventsListView({ events, loading }: { events: EventSummary[]; loading: boolean }) {
  if (loading) return <div className="text-sm text-ink-muted">Loading…</div>;
  if (events.length === 0) {
    return <div className="carved-card rounded-2xl bg-marble-highlight/50 p-8 text-center text-sm text-ink-muted etched">No events match these filters.</div>;
  }
  return (
    <div className="carved-card overflow-hidden rounded-2xl bg-marble-highlight/50">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-ink-muted/10 text-left text-[11px] uppercase tracking-wider text-ink-muted etched">
            <th className="px-4 py-3 font-semibold">Organisation</th>
            <th className="px-4 py-3 font-semibold">Event</th>
            <th className="px-4 py-3 font-semibold">Venues</th>
            <th className="px-4 py-3 font-semibold">Dates</th>
            <th className="px-4 py-3 font-semibold">Status</th>
            <th className="px-4 py-3 font-semibold">Owner</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id} className="border-b border-ink-muted/5 transition-colors hover:bg-marble-shadow/20">
              <td className="px-4 py-3 font-medium text-ink-primary etched-deep">{e.organisation_name ?? "—"}</td>
              <td className="px-4 py-3">
                <Link to={`/events/${e.id}`} className="font-medium text-ink-primary etched-deep hover:text-sage-text">
                  {e.title}
                </Link>
                {e.event_code && <div className="text-[11px] text-ink-muted">{e.event_code}</div>}
              </td>
              <td className="px-4 py-3 text-ink-secondary etched">{e.venues ?? "—"}</td>
              <td className="px-4 py-3 text-ink-secondary etched">
                {e.event_start_date ? formatDate(e.event_start_date) : "—"}
                {e.event_end_date && e.event_end_date !== e.event_start_date ? ` → ${formatDate(e.event_end_date)}` : ""}
              </td>
              <td className="px-4 py-3"><StatusBadge status={e.status as EventStatus} /></td>
              <td className="px-4 py-3 text-ink-secondary etched">{e.event_owner ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- Week / Day list view ----
function WeekDayList({ byDate, days, start, today, onPick }: { byDate: Record<string, CalEntry[]>; days: number; start: Date; today: string; onPick: (e: CalEntry) => void }) {
  const range = Array.from({ length: days }, (_, i) => addDays(start, i));
  return (
    <div className="space-y-4">
      {range.map((d) => {
        const key = isoDate(d);
        const entries = byDate[key] ?? [];
        return (
          <section key={key} className="carved-card rounded-2xl bg-marble-highlight/50 p-4">
            <div className={"mb-3 text-sm font-semibold etched-deep " + (key === today ? "text-sage-text" : "text-ink-primary")}>
              {d.toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "short", timeZone: "Asia/Kolkata" })}
              {key === today && <span className="ml-2 text-[11px] uppercase tracking-wider text-sage">Today</span>}
            </div>
            {entries.length === 0 ? (
              <p className="text-xs text-ink-muted etched">No activities scheduled.</p>
            ) : (
              <div className="space-y-2">
                {entries.map((e) => (
                  <button key={e.id} type="button" onClick={() => onPick(e)} className="flex w-full items-center gap-3 rounded-lg bg-marble-shadow/30 px-3 py-2 text-left hover:bg-marble-shadow/50">
                    <span className={"h-2.5 w-2.5 shrink-0 rounded-full evt-dot " + DOT_CLASS[STATUS_TOKEN[e.status] ?? "enquiry"]} />
                    <span className="w-20 shrink-0 text-xs font-medium text-ink-secondary etched">{e.start_time ?? "—"}</span>
                    <span className="flex-1 truncate text-sm font-medium text-ink-primary etched-deep">{e.title}</span>
                    <span className="shrink-0 text-xs text-ink-muted etched">{e.venue}</span>
                    <span className="shrink-0 text-[10px] uppercase tracking-wider text-sage etched">{e.activity_type.replace(/_/g, " ")}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

// ---- Venue Timeline (venues vertically, dates horizontally) ----
function VenueTimeline({ byDate, venues, start, onPick }: { byDate: Record<string, CalEntry[]>; venues: string[]; start: Date; onPick: (e: CalEntry) => void }) {
  const days = Array.from({ length: 14 }, (_, i) => addDays(start, i));
  // Group entries by venue → date.
  const grid: Record<string, Record<string, CalEntry[]>> = {};
  for (const v of venues) grid[v] = {};
  for (const entries of Object.values(byDate)) {
    for (const e of entries) {
      const venueRow = grid[e.venue] ?? (grid[e.venue] = {});
      const key = e.activity_date;
      if (!venueRow[key]) venueRow[key] = [];
      venueRow[key]!.push(e);
    }
  }
  return (
    <div className="carved-card overflow-x-auto scroll-slim rounded-2xl bg-marble-highlight/50 p-4">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-marble-highlight px-3 py-2 text-left text-[11px] uppercase tracking-wider text-ink-dayHeader etched">Venue</th>
            {days.map((d) => (
              <th key={isoDate(d)} className="min-w-[120px] px-2 py-2 text-center text-[11px] uppercase tracking-wider text-ink-dayHeader etched">
                {d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" })}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {venues.map((v) => (
            <tr key={v} className="border-t border-ink-muted/10">
              <td className="sticky left-0 z-10 bg-marble-highlight px-3 py-3 text-left font-medium text-ink-primary etched-deep">{v}</td>
              {days.map((d) => {
                const key = isoDate(d);
                const entries = grid[v]?.[key] ?? [];
                return (
                  <td key={key} className="min-w-[120px] px-1.5 py-1.5 align-top">
                    {entries.map((e) => (
                      <button key={e.id} type="button" onClick={() => onPick(e)} className="carved-card mb-1 block w-full rounded-md bg-marble-highlight/70 px-2 py-1 text-left">
                        <div className="flex items-center gap-1">
                          <span className={"h-1.5 w-1.5 shrink-0 rounded-full evt-dot " + DOT_CLASS[STATUS_TOKEN[e.status] ?? "enquiry"]} />
                          <span className="truncate text-[11px] font-medium text-ink-secondary etched">{e.title}</span>
                        </div>
                        {e.start_time && <div className="mt-0.5 text-[10px] text-ink-muted etched">{e.start_time} · {e.activity_type.replace(/_/g, " ")}</div>}
                      </button>
                    ))}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d={dir === "left" ? "M15 18l-6-6 6-6" : "M9 18l6-6-6-6"} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FilterSelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }> }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="carved rounded-full bg-marble-shadow/40 px-3 py-1.5 text-xs text-ink-primary focus:outline-none">
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

// Status dot Tailwind classes (mirrors StatusBadge token mapping).
const DOT_CLASS: Record<string, string> = {
  enquiry: "bg-status-enquiry",
  tentative: "bg-status-tentative",
  approved: "bg-status-approved",
  confirmed: "bg-status-confirmed",
  regret: "bg-status-regret",
  cancelled: "bg-status-cancelled",
};
