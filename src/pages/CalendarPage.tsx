import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "../components/PageHeader";
import { apiGet } from "../lib/api";
import { useLookups, formatDate } from "../lib/use-lookups";
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

type View = "month" | "week" | "day" | "venue";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function startOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), 1); }
function startOfWeek(d: Date): Date { const x = new Date(d); x.setDate(d.getDate() - d.getDay()); x.setHours(0, 0, 0, 0); return x; }
function isoDate(d: Date): string { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(d.getDate() + n); return x; }

export function CalendarPage() {
  const { data: lookups } = useLookups();
  const [view, setView] = useState<View>("month");
  const [cursor, setCursor] = useState(() => new Date());
  const [filters, setFilters] = useState({ status: "", venue: "", type: "", owner: "" });
  const [sideEvent, setSideEvent] = useState<CalEntry | null>(null);

  // Determine the visible date range based on the view.
  const range = useMemo(() => {
    if (view === "month") return { from: isoDate(startOfWeek(startOfMonth(cursor))), to: isoDate(addDays(startOfWeek(startOfMonth(cursor)), 41)) };
    if (view === "week") return { from: isoDate(startOfWeek(cursor)), to: isoDate(addDays(startOfWeek(cursor), 6)) };
    if (view === "day") return { from: isoDate(cursor), to: isoDate(cursor) };
    // venue timeline: show a wider span (next 30 days)
    return { from: isoDate(cursor), to: isoDate(addDays(cursor, 29)) };
  }, [view, cursor]);

  const q = new URLSearchParams({ from: range.from, to: range.to, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) });
  const { data, isLoading } = useQuery({
    queryKey: ["calendar", range.from, range.to, filters],
    queryFn: () => apiGet<CalResponse>(`/calendar?${q.toString()}`),
  });

  const byDate = data?.byDate ?? {};
  const today = isoDate(new Date());
  const venues = lookups?.lookups.venue ?? [];

  const title = view === "month" || view === "venue"
    ? cursor.toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "Asia/Kolkata" })
    : view === "week"
      ? `${formatDate(range.from)} – ${formatDate(range.to)}`
      : formatDate(range.from);

  return (
    <div>
      <PageHeader title="Calendar" subtitle={title} />

      {/* Controls */}
      <div className="carved-header mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-marble-highlight/60 p-3 backdrop-blur-sm">
        <div className="flex items-center gap-1 rounded-full bg-marble-shadow/40 p-1">
          {(["month", "week", "day", "venue"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={"rounded-full px-4 py-1.5 text-xs font-semibold etched " + (view === v ? "bg-sage-btn text-sage-text carved-btn-sage" : "text-ink-muted hover:text-ink-secondary")}
            >
              {v === "venue" ? "Venue Timeline" : v[0]!.toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button type="button" onClick={() => { if (view === "month") setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1)); else if (view === "week") setCursor(addDays(cursor, -7)); else if (view === "day") setCursor(addDays(cursor, -1)); else setCursor(addDays(cursor, -30)); }} className="carved-btn flex h-8 w-8 items-center justify-center rounded-full bg-neutral-btn text-sage-text" aria-label="Previous">
            <Chevron dir="left" />
          </button>
          <button type="button" onClick={() => setCursor(new Date())} className="carved-btn-sage rounded-full bg-sage-btn px-4 py-1.5 text-xs font-semibold text-sage-text etched">Today</button>
          <button type="button" onClick={() => { if (view === "month") setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)); else if (view === "week") setCursor(addDays(cursor, 7)); else if (view === "day") setCursor(addDays(cursor, 1)); else setCursor(addDays(cursor, 30)); }} className="carved-btn flex h-8 w-8 items-center justify-center rounded-full bg-neutral-btn text-sage-text" aria-label="Next">
            <Chevron dir="right" />
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect value={filters.status} onChange={(v) => setFilters((f) => ({ ...f, status: v }))} options={[{ value: "", label: "All statuses" }, ...Object.entries(STATUS_LABELS).map(([k, v]) => ({ value: k, label: v }))]} />
          <FilterSelect value={filters.venue} onChange={(v) => setFilters((f) => ({ ...f, venue: v }))} options={[{ value: "", label: "All venues" }, ...venues.map((o) => ({ value: o.value, label: o.value }))]} />
          <FilterSelect value={filters.type} onChange={(v) => setFilters((f) => ({ ...f, type: v }))} options={[{ value: "", label: "All types" }, { value: "EE", label: "EE" }, { value: "FR", label: "FR" }, { value: "VFH", label: "VFH" }, { value: "Free Event", label: "Free Event" }]} />
        </div>
      </div>

      {/* Legend */}
      <div className="mb-4 flex flex-wrap gap-3 text-[11px] text-ink-muted etched">
        {[["inquiry", "Inquiry"], ["awaiting_approval", "Awaiting Approval"], ["tentative", "Tentative"], ["waitlisted", "Waitlisted"], ["confirmed", "Confirmed"], ["in_progress", "In Progress"], ["completed", "Completed"], ["cancelled", "Cancelled"]].map(([k, label]) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className={"h-2 w-2 rounded-full " + DOT_CLASS[STATUS_TOKEN[k as EventStatus] ?? "draft"]} /> {label}
          </span>
        ))}
      </div>

      {isLoading ? (
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

// ---- Month grid (marble carved cells, sage today pip) ----
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
          return (
            <article key={key} className={"min-h-[128px] rounded-xl p-3 " + (isToday ? "carved-today bg-sage-today-wash" : "carved bg-marble-highlight/40") + (!inMonth ? " carved-muted" : "")}>
              <div className="mb-2 flex justify-end">
                <span className={"flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold etched " + (isToday ? "bg-sage text-white sage-pip" : inMonth ? "text-ink-primary" : "text-ink-overflow")}>
                  {d.getDate()}
                </span>
              </div>
              <div className="space-y-1.5">
                {entries.slice(0, 3).map((e) => (
                  <button key={e.id} type="button" onClick={() => onPick(e)} className="carved-card flex w-full items-center gap-1.5 rounded-md bg-marble-highlight/60 px-2 py-1 text-left">
                    <span className={"h-1.5 w-1.5 shrink-0 rounded-full evt-dot " + DOT_CLASS[STATUS_TOKEN[e.status] ?? "draft"]} />
                    <span className="truncate text-[11px] font-medium text-ink-secondary etched">{e.title}</span>
                  </button>
                ))}
                {entries.length > 3 && <div className="text-[10px] text-ink-muted etched">+{entries.length - 3} more</div>}
              </div>
            </article>
          );
        })}
      </div>
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
                    <span className={"h-2.5 w-2.5 shrink-0 rounded-full evt-dot " + DOT_CLASS[STATUS_TOKEN[e.status] ?? "draft"]} />
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
                          <span className={"h-1.5 w-1.5 shrink-0 rounded-full evt-dot " + DOT_CLASS[STATUS_TOKEN[e.status] ?? "draft"]} />
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
