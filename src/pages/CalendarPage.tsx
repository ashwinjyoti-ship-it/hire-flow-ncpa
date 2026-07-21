import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "../components/PageHeader";
import { apiGet } from "../lib/api";
import { getEventStatusSurface } from "../lib/event-status-surface";
import { PocStatusBadge } from "../components/PocIncompleteBanner";
import { useLookups, formatDate, formatDuration, formatTime, formatTimeRange } from "../lib/use-lookups";
import { useAuth } from "../lib/auth";
import { can } from "../lib/can";
import { getEventOperationsLink } from "../lib/task-workflows";
import type { EventStatus } from "../../worker/lib/state-machine";
import { STATUS_LABELS } from "../../worker/lib/state-machine";
import { shouldShowLifecycleStepCountBadge } from "../lib/lifecycle-calendar-display";

type CalEntry = {
  id: string;
  activity_type: string;
  activity_date: string;
  start_time: string | null;
  end_time: string | null;
  with_ac_start: string | null;
  with_ac_end: string | null;
  with_ac_minutes: number | null;
  without_ac_start: string | null;
  without_ac_end: string | null;
  without_ac_minutes: number | null;
  schedule_notes: string | null;
  event_id: string;
  event_code: string | null;
  title: string;
  status: EventStatus;
  event_type: string | null;
  event_owner: string | null;
  event_owner_email: string | null;
  description: string | null;
  event_requirements: Record<string, unknown> | string | null;
  event_notes: string | null;
  organisation_name: string | null;
  venue: string;
  booking_status: string | null;
  number_of_shows: number | null;
  shows_on_date: number | null;
  requirements: string | null;
  venue_notes: string | null;
};
type CalResponse = { entries: CalEntry[]; byDate: Record<string, CalEntry[]> };

type LifecycleEntry = {
  id: string;
  milestone_type: LifecycleType;
  milestone_date: string;
  event_id: string;
  event_code: string | null;
  event_start_date: string | null;
  event_end_date: string | null;
  title: string;
  status: EventStatus;
  event_type: string | null;
  organisation_name: string | null;
  event_owner: string | null;
  venues: string | null;
  task_id: string | null;
  task_title: string | null;
  poc_complete?: boolean;
  poc_filled_count?: number;
  poc_total_count?: number;
  poc_missing_labels?: string[];
};
type LifecycleResponse = {
  entries: LifecycleEntry[];
  byDate: Record<string, LifecycleEntry[]>;
  poc_incomplete_count?: number;
};
type LifecycleOverflowState = { date: string; entries: LifecycleEntry[] };
type ShowOverflowState = { date: string; entries: CalEntry[] };

type View = "show" | "lifecycle";
type LifecycleType =
  | "enquiry"
  | "tentative"
  | "approved"
  | "confirmed"
  | "regret"
  | "cancelled";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const CALENDAR_VISIBLE_EVENTS_PER_DAY = 3;
/** Statuses that belong on Show Calendar. Everything else with a status filter belongs on Lifecycle. */
const SHOW_CALENDAR_STATUSES = new Set<string>(["confirmed"]);

/** Pick the calendar that can actually show the chosen status. Empty status keeps the current view. */
function calendarViewForStatus(status: string): View | null {
  if (!status) return null;
  return SHOW_CALENDAR_STATUSES.has(status) ? "show" : "lifecycle";
}

function startOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), 1); }
/** Last calendar day of the month (local). day 0 of next month = last day of this month. */
function endOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function isoDate(d: Date): string { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(d.getDate() + n); return x; }
function dateFromParam(value: string | null): Date {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date();
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

type MonthCell = { date: Date; key: string; inCurrentMonth: boolean };

function calendarCellsForMonth(cursor: Date): MonthCell[] {
  const monthStart = startOfMonth(cursor);
  const daysInMonth = endOfMonth(cursor).getDate();
  const leadingDays = monthStart.getDay();
  const totalCells = leadingDays + daysInMonth;
  const trailingDays = (7 - (totalCells % 7)) % 7;
  const gridStart = addDays(monthStart, -leadingDays);

  return Array.from({ length: totalCells + trailingDays }, (_, i) => {
    const date = addDays(gridStart, i);
    return {
      date,
      key: isoDate(date),
      inCurrentMonth: date.getFullYear() === cursor.getFullYear() && date.getMonth() === cursor.getMonth(),
    };
  });
}

export function CalendarPage() {
  const { user } = useAuth();
  const { data: lookups } = useLookups();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sideEvent, setSideEvent] = useState<CalEntry | null>(null);
  const [lifecycleOverflow, setLifecycleOverflow] = useState<LifecycleOverflowState | null>(null);
  const [showOverflow, setShowOverflow] = useState<ShowOverflowState | null>(null);

  // URL is the single source of truth — avoids the dual-state race that wiped `q`
  // right after a topbar/global search navigation.
  const view: View = searchParams.get("view") === "show" ? "show" : "lifecycle";
  const cursor = useMemo(() => dateFromParam(searchParams.get("from")), [searchParams]);
  const filters = useMemo(() => ({
    status: searchParams.get("status") ?? "",
    venue: searchParams.get("venue") ?? "",
    type: searchParams.get("type") ?? "",
    owner: searchParams.get("owner") ?? "",
    q: searchParams.get("q") ?? "",
    pocIncomplete: searchParams.get("poc_incomplete") === "1",
  }), [searchParams]);
  const mine = searchParams.get("mine") === "1";

  // Event owners are login accounts (is_event_owner), same source as the event form.
  // Avoid the old handled_by dropdown list, which can drift from real owners.
  const { data: usersData } = useQuery({
    queryKey: ["users"],
    queryFn: () => apiGet<{ users: Array<{ id: string; name: string; is_active: number; is_event_owner?: boolean }> }>("/users"),
    enabled: Boolean(user),
  });

  function updateParams(mutator: (params: URLSearchParams) => void) {
    const next = new URLSearchParams(searchParams);
    if (!next.get("view")) next.set("view", view);
    if (!next.get("from")) next.set("from", isoDate(startOfMonth(cursor)));
    mutator(next);
    if (!next.get("from")) next.set("from", isoDate(startOfMonth(cursor)));
    if (next.toString() === searchParams.toString()) return;
    setSearchParams(next, { replace: true });
  }

  function setView(nextView: View) {
    updateParams((params) => {
      params.set("view", nextView);
      const status = params.get("status") ?? "";
      if (nextView === "show") {
        // Show Calendar is confirmed work — drop lifecycle-only status/POC filters.
        if (status && status !== "confirmed") params.delete("status");
        params.delete("poc_incomplete");
      } else if (status === "confirmed") {
        // Confirmed events live on Show Calendar, not the lifecycle grid.
        params.delete("status");
      }
    });
    setLifecycleOverflow(null);
    setShowOverflow(null);
    setSideEvent(null);
  }

  function setCursor(nextCursor: Date) {
    updateParams((params) => {
      params.set("from", isoDate(startOfMonth(nextCursor)));
    });
    setLifecycleOverflow(null);
    setShowOverflow(null);
    setSideEvent(null);
  }

  function setFilter(key: "status" | "venue" | "type" | "owner" | "q", value: string) {
    updateParams((params) => {
      if (value.trim()) params.set(key, value.trim());
      else params.delete(key);

      if (key === "status") {
        const nextView = calendarViewForStatus(value.trim());
        if (nextView) {
          params.set("view", nextView);
          if (nextView === "show") params.delete("poc_incomplete");
        }
      }
    });
    if (key === "status") {
      setLifecycleOverflow(null);
      setShowOverflow(null);
      setSideEvent(null);
    }
  }

  function setMine(next: boolean) {
    updateParams((params) => {
      if (next) params.set("mine", "1");
      else params.delete("mine");
    });
  }

  function setPocIncompleteFilter(next: boolean) {
    updateParams((params) => {
      if (next) params.set("poc_incomplete", "1");
      else params.delete("poc_incomplete");
    });
  }

  // Deep links / stale URLs: if status implies a different calendar, move there.
  useEffect(() => {
    const expected = calendarViewForStatus(filters.status);
    if (!expected || expected === view) return;
    updateParams((params) => {
      params.set("view", expected);
      if (expected === "show") params.delete("poc_incomplete");
    });
    setLifecycleOverflow(null);
    setShowOverflow(null);
    setSideEvent(null);
  }, [filters.status, view]);

  // Visible range = the exact calendar month being viewed (1st → last day).
  // Narrowing to the month (vs the old 42-day Sunday-start window) prevents
  // adjacent-month events from leaking into the grid.
  const range = useMemo(() => {
    return { from: isoDate(startOfMonth(cursor)), to: isoDate(endOfMonth(cursor)) };
  }, [cursor]);

  const q = new URLSearchParams({
    from: range.from,
    to: range.to,
    ...Object.fromEntries(Object.entries({
      status: filters.status,
      venue: filters.venue,
      type: filters.type,
      owner: filters.owner,
      q: filters.q,
    }).filter(([, v]) => v)),
    ...(mine ? { mine: "1" } : {}),
  });
  const { data, isLoading } = useQuery({
    queryKey: ["calendar", range.from, range.to, filters, mine],
    queryFn: () => apiGet<CalResponse>(`/calendar?${q.toString()}`),
    enabled: view !== "lifecycle",
  });

  const lifecycleQuery = new URLSearchParams({
    from: range.from,
    to: range.to,
    ...Object.fromEntries(Object.entries({
      status: filters.status,
      venue: filters.venue,
      type: filters.type,
      owner: filters.owner,
      q: filters.q,
      ...(filters.pocIncomplete ? { poc_incomplete: "1" } : {}),
    }).filter(([, v]) => v)),
    ...(mine ? { mine: "1" } : {}),
  });
  const { data: lifecycleData, isLoading: lifecycleLoading } = useQuery({
    queryKey: ["calendar-lifecycle", range.from, range.to, filters, mine],
    queryFn: () => apiGet<LifecycleResponse>(`/calendar/lifecycle?${lifecycleQuery.toString()}`),
    enabled: view === "lifecycle",
  });

  // When a search is active but the current month has no hits, jump to the month
  // of the first matching event so Show/Lifecycle calendars actually show it.
  useEffect(() => {
    const term = filters.q.trim();
    if (!term) return;
    if (view === "lifecycle" ? lifecycleLoading : isLoading) return;
    const localCount = view === "lifecycle" ? (lifecycleData?.entries.length ?? 0) : (data?.entries.length ?? 0);
    if (localCount > 0) return;

    let cancelled = false;
    void (async () => {
      try {
        const statusQuery =
          view === "show"
            ? `&status=${encodeURIComponent(filters.status || "confirmed")}`
            : filters.status
              ? `&status=${encodeURIComponent(filters.status)}`
              : "";
        const res = await apiGet<{ events: Array<{ event_start_date: string | null }> }>(
          `/events?q=${encodeURIComponent(term)}${statusQuery}`
        );
        if (cancelled) return;
        const firstDate = res.events.find((event) => event.event_start_date)?.event_start_date;
        if (!firstDate || !/^\d{4}-\d{2}-\d{2}$/.test(firstDate)) return;
        const from = `${firstDate.slice(0, 7)}-01`;
        if (searchParams.get("from") === from) return;
        updateParams((params) => {
          params.set("from", from);
          params.set("q", term);
        });
      } catch {
        // Keep the current month if the lookup fails.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filters.q, filters.status, view, data?.entries, lifecycleData?.entries, isLoading, lifecycleLoading, searchParams, setSearchParams, cursor]);

  const byDate = data?.byDate ?? {};
  const lifecycleByDate = lifecycleData?.byDate ?? {};
  const today = isoDate(new Date());
  const venues = lookups?.lookups.venue ?? [];
  const ownerNames = useMemo(() => {
    const fromUsers = (usersData?.users ?? [])
      .filter((u) => u.is_active === 1 && u.is_event_owner)
      .map((u) => u.name.trim())
      .filter(Boolean);
    // Fall back to synced handled_by values when the viewer cannot list users.
    const fromLookups = (lookups?.lookups.handled_by ?? [])
      .map((o) => o.value.trim())
      .filter(Boolean);
    const names = fromUsers.length > 0 ? [...fromUsers] : [...fromLookups];
    // Keep a selected legacy owner visible even if they are no longer designated.
    if (filters.owner && !names.includes(filters.owner)) names.push(filters.owner);
    return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
  }, [usersData?.users, lookups?.lookups.handled_by, filters.owner]);

  const title = cursor.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const filterOptions = {
    status: [
      // Status choice also routes to the calendar that can show it:
      // confirmed → Show Calendar; enquiry/tentative/approved/cancelled → Lifecycle.
      // Regrets stay on the dedicated Regrets page, not these calendars.
      { value: "", label: view === "show" ? "Confirmed (default)" : "All statuses" },
      ...Object.entries(STATUS_LABELS)
        .filter(([k]) => k !== "regret")
        .map(([k, v]) => ({ value: k, label: v })),
    ],
    venue: [{ value: "", label: "All venues" }, ...venues.map((o) => ({ value: o.value, label: o.value }))],
    type: [
      { value: "", label: "All types" },
      { value: "EE", label: "EE" },
      { value: "FR", label: "FR" },
      { value: "VFH", label: "VFH" },
      { value: "Free Event", label: "Free Event" },
    ],
    owner: [{ value: "", label: "All owners" }, ...ownerNames.map((name) => ({ value: name, label: name }))],
  };
  const activeFilterCount = [filters.status, filters.venue, filters.type, filters.owner, filters.pocIncomplete].filter(Boolean).length;
  // "This month" only when the viewed cursor is the actual current month/year.
  const nowDate = new Date();
  const isCurrentMonth = cursor.getFullYear() === nowDate.getFullYear() && cursor.getMonth() === nowDate.getMonth();

  const showCreate = can(user?.permissions, "event.create");

  return (
    <div>
      <PageHeader
        title={view === "lifecycle" ? "Lifecycle Calendar" : "Show Calendar"}
        actions={showCreate ? (
          <Link to="/events/new" className="carved-btn-terracotta rounded-full bg-terracotta-btn px-5 py-2 text-sm font-semibold text-terracotta-text etched hover:bg-terracotta-btn-hover">
            + New Event
          </Link>
        ) : null}
      />

      {/* Sticky controls: one bar so toggle/filters don't slide under the month nav while scrolling. */}
      <div className="sticky top-0 z-20 mb-6">
        <div className="carved-header grid grid-cols-1 items-center gap-3 rounded-2xl bg-marble-highlight p-3 xl:grid-cols-[1fr_auto_1fr]">
          <div className="flex justify-center xl:justify-start">
            <div className="flex items-center gap-1 rounded-full bg-marble-shadow/40 p-1">
              {(["lifecycle", "show"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={"rounded-full px-4 py-1.5 text-xs font-semibold etched " + (view === v ? "bg-terracotta-btn text-terracotta-text carved-btn-terracotta" : "text-ink-muted hover:text-ink-secondary")}
                >
                  {v === "show" ? "Show Calendar" : "Life Cycle"}
                </button>
              ))}
            </div>
          </div>

          <div className="mx-auto flex items-center gap-2 rounded-full bg-marble-shadow/30 px-2 py-1">
            <button type="button" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} className="carved-btn-sage flex h-8 w-8 items-center justify-center rounded-full bg-sage-btn text-sage-text hover:bg-sage-btn-hover" aria-label="Previous month">
              <Chevron dir="left" />
            </button>
            <div className="min-w-[9rem] text-center">
              <div className="text-lg font-semibold leading-tight text-ink-primary etched-deep">{title}</div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted etched">{isCurrentMonth ? "This month" : "Viewing"}</div>
            </div>
            <button type="button" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} className="carved-btn-sage flex h-8 w-8 items-center justify-center rounded-full bg-sage-btn text-sage-text hover:bg-sage-btn-hover" aria-label="Next month">
              <Chevron dir="right" />
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2 xl:justify-end">
            <details className="group relative">
              <summary className={"carved-btn-terracotta flex cursor-pointer list-none items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold etched marker:hidden " + (activeFilterCount ? "bg-terracotta-btn text-terracotta-text" : "bg-marble-shadow/40 text-ink-secondary hover:text-ink-primary")}>
                Filter
                {activeFilterCount > 0 && (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-white/70 px-1 text-[10px] text-terracotta-text">
                    {activeFilterCount}
                  </span>
                )}
              </summary>
              <div className="carved-card absolute right-0 z-30 mt-2 w-[min(18rem,calc(100vw-2rem))] rounded-2xl bg-marble-highlight/95 p-3 backdrop-blur-md">
                <div className="space-y-2">
                  <FilterSelect label="Status" value={filters.status} onChange={(v) => setFilter("status", v)} options={filterOptions.status} />
                  <FilterSelect label="Venue" value={filters.venue} onChange={(v) => setFilter("venue", v)} options={filterOptions.venue} />
                  <FilterSelect label="Type" value={filters.type} onChange={(v) => setFilter("type", v)} options={filterOptions.type} />
                  <FilterSelect label="Owner" value={filters.owner} onChange={(v) => setFilter("owner", v)} options={filterOptions.owner} />
                  {view === "lifecycle" && (
                    <label className="flex items-center gap-2 rounded-lg bg-marble-shadow/25 px-3 py-2 text-xs font-medium text-ink-secondary etched">
                      <input
                        type="checkbox"
                        checked={filters.pocIncomplete}
                        onChange={(e) => setPocIncompleteFilter(e.target.checked)}
                        className="h-4 w-4 rounded border-ink-muted accent-terracotta"
                      />
                      POC incomplete only
                    </label>
                  )}
                </div>
              </div>
            </details>
            <label className="inline-flex items-center gap-1.5 px-1 text-xs font-medium text-ink-secondary etched">
              <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} className="h-4 w-4 rounded border-ink-muted accent-terracotta" />
              My events
            </label>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="mb-4 flex flex-wrap gap-3 text-[11px] text-ink-muted etched">
        {(view === "lifecycle"
          ? Object.entries(LIFECYCLE_LABELS).filter(([key]) => key !== "confirmed" && key !== "regret")
          : Object.entries(STATUS_LABELS)
        ).map(([key, label]) => (
            <span key={key} className="inline-flex items-center gap-1.5">
              <span className={"h-2 w-2 rounded-full " + (view === "lifecycle" ? lifecycleDot(key as LifecycleType) : getEventStatusSurface(key).dot)} /> {label}
            </span>
        ))}
      </div>

      {view === "lifecycle" ? (
        lifecycleLoading ? (
          <div className="text-sm text-ink-muted">Loading…</div>
        ) : (
          <LifecycleMonthGrid byDate={lifecycleByDate} today={today} cursor={cursor} onOpenOverflow={setLifecycleOverflow} />
        )
      ) : isLoading ? (
        <div className="text-sm text-ink-muted">Loading…</div>
      ) : (
        <MonthGrid byDate={byDate} today={today} cursor={cursor} onPick={setSideEvent} onOpenOverflow={setShowOverflow} />
      )}

      {sideEvent && <ShowCalendarDetailPanel entry={sideEvent} onClose={() => setSideEvent(null)} />}
      {showOverflow && (
        <ShowCalendarOverflowPanel
          overflow={showOverflow}
          onClose={() => setShowOverflow(null)}
          onPick={(entry) => {
            setShowOverflow(null);
            setSideEvent(entry);
          }}
        />
      )}
      {lifecycleOverflow && <LifecycleOverflowPanel overflow={lifecycleOverflow} onClose={() => setLifecycleOverflow(null)} />}
    </div>
  );
}

function ShowCalendarDetailPanel({ entry, onClose }: { entry: CalEntry; onClose: () => void }) {
  const eventReqs = parseRequirements(entry.event_requirements);
  const venueReqs = parseRequirements(entry.requirements);
  // Prefer this venue's requirements; fall back to event-level for legacy rows.
  const reqs = Object.keys(venueReqs).length > 0 ? { ...eventReqs, ...venueReqs } : eventReqs;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink-primary/15" onClick={onClose}>
      <aside role="dialog" aria-modal="true" aria-labelledby="show-calendar-detail-title" className="h-full w-full max-w-2xl overflow-y-auto scroll-slim rounded-l-2xl border-l border-white/70 bg-white/72 p-6 text-neutral-950 shadow-2xl backdrop-blur-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">View show details</div>
            <h3 id="show-calendar-detail-title" className="text-xl font-semibold text-neutral-950">{entry.title}</h3>
            <p className="mt-1 text-xs text-neutral-600">
              {entry.organisation_name ?? "No organisation"}{entry.event_code ? ` · ${entry.event_code}` : ""}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link to={getEventOperationsLink(entry.event_id)} className="rounded-full border border-neutral-300/70 bg-white/65 px-4 py-2 text-xs font-semibold text-neutral-900 shadow-sm hover:bg-white">
              Edit Checklist
            </Link>
            <Link to={`/events/${entry.event_id}/edit`} className="rounded-full border border-neutral-300/70 bg-white/65 px-4 py-2 text-xs font-semibold text-neutral-900 shadow-sm hover:bg-white">
              Edit Event Data
            </Link>
            <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full border border-neutral-300/70 bg-white/50 text-neutral-500 hover:bg-white hover:text-neutral-900" aria-label="Close">x</button>
          </div>
        </div>

        <section className="mb-4 grid grid-cols-2 gap-3 text-xs">
          <SummaryPill label="Venue" value={entry.venue} />
          <SummaryPill label="Activity" value={entry.activity_type.replace(/_/g, " ")} />
          <SummaryPill label="Date" value={formatDate(entry.activity_date)} />
          <SummaryPill label="Time" value={formatRange(entry.start_time, entry.end_time)} />
          <SummaryPill label="Shows this date" value={String(entry.shows_on_date ?? entry.number_of_shows ?? 0)} />
          <SummaryPill label="Booking" value={entry.booking_status ?? "-"} />
          <SummaryPill label="Owner" value={entry.event_owner ?? "-"} />
          <SummaryPill label="Owner contact" value={entry.event_owner_email ?? "-"} preserveCase />
          <SummaryPill label="Type" value={entry.event_type ?? "-"} />
        </section>

        <section className="mb-4 rounded-xl border border-white/65 bg-white/46 p-4">
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">Timings</h4>
          <dl className="space-y-2 text-sm">
            <DetailLine label="With AC" value={formatTimedDuration(entry.with_ac_start, entry.with_ac_end, entry.with_ac_minutes)} />
            <DetailLine label="Without AC" value={formatTimedDuration(entry.without_ac_start, entry.without_ac_end, entry.without_ac_minutes)} />
            <DetailLine label="Sound Call Time" value={formatTimeRequirement(reqs.sound_call_time)} />
            <DetailLine label="Light Call Time" value={formatTimeRequirement(reqs.light_call_time)} />
          </dl>
        </section>

        <section className="space-y-4">
          <DetailGroup title="Requirements">
            <DetailLine label="Sound" value={formatRequirement(reqs.sound)} />
            <DetailLine label="Light" value={formatRequirement(reqs.light)} />
            <DetailLine label="Green Rooms" value={formatGreenRoomRequirements(reqs)} />
            <DetailLine label="Security" value={formatRequirement(reqs.security)} />
            <DetailLine label="House Seats" value={formatHouseSeatDecisions(reqs)} />
            <DetailLine label="Parking" value={formatRequirement(reqs.parking)} />
            <DetailLine label="Housekeeping" value={formatRequirement(reqs.housekeeping)} />
            {hasRequirementText(reqs.stage_setup) && (
              <DetailLine label="Stage Setup" value={formatRequirement(reqs.stage_setup)} />
            )}
            {hasRequirementText(reqs.foyer_setup) && (
              <DetailLine label="Foyer Setup" value={formatRequirement(reqs.foyer_setup)} />
            )}
          </DetailGroup>

          <DetailGroup title="Additional Detail">
            <DetailLine label="Description" value={entry.description ?? "-"} />
            <DetailLine label="Event Notes" value={entry.event_notes ?? "-"} />
            <DetailLine label="Schedule Notes" value={entry.schedule_notes ?? "-"} />
            <DetailLine label="Venue Notes" value={entry.venue_notes ?? "-"} />
          </DetailGroup>
        </section>
      </aside>
    </div>
  );
}

function SummaryPill({ label, value, preserveCase = false }: { label: string; value: string; preserveCase?: boolean }) {
  return (
    <div className="rounded-xl border border-white/65 bg-white/46 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">{label}</div>
      <div className={"mt-1 font-semibold text-neutral-950 " + (preserveCase ? "break-words" : "capitalize")}>{value}</div>
    </div>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[8rem_1fr]">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="whitespace-pre-wrap break-words font-medium text-neutral-950">{value}</dd>
    </div>
  );
}

function DetailGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-white/65 bg-white/46 p-4">
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">{title}</h4>
      <dl className="space-y-2 text-sm">{children}</dl>
    </section>
  );
}

function parseRequirements(value: CalEntry["event_requirements"] | CalEntry["requirements"]): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return value;
}

function formatRequirement(value: unknown): string {
  if (value == null || value === "") return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.filter(Boolean).join(", ") || "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function hasRequirementText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function formatTimeRequirement(value: unknown): string {
  if (typeof value !== "string") return formatRequirement(value);
  return formatTime(value);
}

function formatGreenRoomRequirements(reqs: Record<string, unknown>): string {
  const parts = [
    formatRequirement(reqs.green_rooms_required),
    formatRequirement(reqs.green_room_amenities),
  ].filter((part) => part !== "-");
  return parts.length ? parts.join(" · ") : "-";
}

function formatHouseSeatDecisions(reqs: Record<string, unknown>): string {
  const parts = [
    reqs.house_seats_release ? `Release: ${formatRequirement(reqs.house_seats_release)}` : "",
    reqs.house_tickets ? `Tickets: ${formatRequirement(reqs.house_tickets)}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "-";
}

function formatRange(start: string | null, end: string | null): string {
  const range = formatTimeRange(start, end);
  return range === "—" ? "-" : range;
}

function formatTimedDuration(start: string | null, end: string | null, minutes: number | null): string {
  const range = formatRange(start, end);
  if (range === "-" && minutes == null) return "-";
  return minutes == null ? range : `${range} (${formatDuration(minutes)})`;
}

// ---- Month grid (one chip per organisation per day) ----
// Days can get crowded; we collapse to a single status-coloured chip per org
// (worst status wins) so the month view stays readable. The side panel and the
// detail page carry the full breakdown (venues, activities, AC timings).
const STATUS_RANK: Record<EventStatus, number> = {
  cancelled: 0, regret: 1, enquiry: 2, tentative: 3, approved: 4, confirmed: 5,
};

const LIFECYCLE_LABELS: Record<LifecycleType, string> = {
  enquiry: "Enquiry",
  tentative: "Tentative",
  approved: "Approved",
  confirmed: "Confirmed",
  regret: "Regret",
  cancelled: "Cancelled",
};

const LIFECYCLE_TONE: Record<LifecycleType, string> = {
  enquiry: "bg-status-enquiry",
  tentative: "bg-status-tentative",
  approved: "bg-status-approved",
  confirmed: "bg-status-confirmed",
  regret: "bg-status-regret",
  cancelled: "bg-status-cancelled",
};

function lifecycleDot(type: LifecycleType): string {
  return LIFECYCLE_TONE[type] ?? "bg-ink-muted";
}

function formatScheduledShowDate(start: string | null | undefined, end: string | null | undefined): string | null {
  if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return null;
  if (end && end !== start && /^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return `${formatDate(start)} to ${formatDate(end)}`;
  }
  return formatDate(start);
}

function LifecycleMonthGrid({ byDate, today, cursor, onOpenOverflow }: { byDate: Record<string, LifecycleEntry[]>; today: string; cursor: Date; onOpenOverflow: (overflow: LifecycleOverflowState) => void }) {
  const cells = calendarCellsForMonth(cursor);
  return (
    <div>
      <div className="mb-2 grid grid-cols-7 gap-1.5 sm:mb-3 sm:gap-2 lg:gap-3">
        {WEEKDAYS.map((d) => (
          <div key={d} className="text-center text-[11px] font-bold uppercase tracking-wider text-ink-dayHeader etched">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5 sm:gap-2 lg:gap-3">
        {cells.map(({ date: d, key, inCurrentMonth }) => {
          const entries = inCurrentMonth ? byDate[key] ?? [] : [];
          const hiddenEntries = entries.slice(CALENDAR_VISIBLE_EVENTS_PER_DAY);
          const isToday = key === today;
          return (
            <article key={key} className={"h-[10rem] min-w-0 overflow-hidden rounded-xl p-1.5 sm:h-[13rem] sm:p-2 lg:h-[14rem] lg:p-3 " + (isToday ? "carved-today bg-sage-today-wash" : inCurrentMonth ? "carved bg-marble-highlight/40" : "carved bg-marble-shadow/20")}>
              <div className="mb-2 flex items-center justify-between gap-2">
                {shouldShowLifecycleStepCountBadge() && entries.length > 0 ? (
                  <span className="hidden min-w-0 truncate text-[10px] font-semibold uppercase tracking-wider text-ink-muted etched sm:block">
                    {entries.length} step{entries.length === 1 ? "" : "s"}
                  </span>
                ) : (
                  <span />
                )}
                <span className={"flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold etched sm:h-6 sm:w-6 sm:text-xs " + (isToday ? "bg-sage text-white sage-pip" : inCurrentMonth ? "text-ink-primary" : "text-ink-overflow")}>
                  {d.getDate()}
                </span>
              </div>
              <div className="min-w-0 space-y-1 sm:space-y-1.5">
                {entries.slice(0, CALENDAR_VISIBLE_EVENTS_PER_DAY).map((entry) => (
                  <LifecycleChip key={entry.id} entry={entry} />
                ))}
                {hiddenEntries.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onOpenOverflow({ date: key, entries })}
                    aria-label={`View all ${entries.length} lifecycle events on ${formatDate(key)}`}
                    title={`View ${hiddenEntries.length} more lifecycle events`}
                    className="block w-full truncate rounded-md bg-marble-shadow/50 px-1.5 py-1 text-left text-[10px] font-medium text-ink-muted etched transition hover:bg-marble-shadow/70 sm:px-2"
                  >
                    +{hiddenEntries.length} more
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function ShowCalendarOverflowPanel({ overflow, onClose, onPick }: { overflow: ShowOverflowState; onClose: () => void; onPick: (entry: CalEntry) => void }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink-primary/15" onClick={onClose}>
      <aside role="dialog" aria-modal="true" aria-labelledby="show-calendar-overflow-title" className="h-full w-full max-w-2xl overflow-y-auto scroll-slim rounded-l-2xl border-l border-white/70 bg-white/72 p-6 text-neutral-950 shadow-2xl backdrop-blur-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">View all show events</div>
            <h3 id="show-calendar-overflow-title" className="text-xl font-semibold text-neutral-950">{formatDate(overflow.date)}</h3>
            <p className="mt-1 text-xs text-neutral-600">
              {overflow.entries.length} event{overflow.entries.length === 1 ? "" : "s"}
            </p>
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-neutral-300/70 bg-white/50 text-neutral-500 hover:bg-white hover:text-neutral-900" aria-label="Close">x</button>
        </div>

        <div className="space-y-3">
          {overflow.entries.map((entry) => {
            const surface = getEventStatusSurface(entry.status);
            return (
              <button
                key={entry.event_id}
                type="button"
                onClick={() => onPick(entry)}
                className="block w-full rounded-xl border border-white/65 bg-white/46 p-4 text-left hover:bg-white/65"
              >
                <div className="flex items-center gap-2">
                  <span className={"h-2 w-2 shrink-0 rounded-full " + surface.dot} />
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                    {STATUS_LABELS[entry.status] ?? entry.status}
                  </span>
                </div>
                <div className="mt-2 text-base font-semibold text-neutral-950">
                  {entry.organisation_name ?? entry.title}
                </div>
                {entry.organisation_name && entry.organisation_name !== entry.title && (
                  <div className="mt-1 text-sm text-neutral-700">{entry.title}</div>
                )}
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-neutral-600">
                  {entry.event_code && <span>{entry.event_code}</span>}
                  {entry.venue && <span>{entry.venue}</span>}
                  {entry.event_owner && <span>{entry.event_owner}</span>}
                </div>
              </button>
            );
          })}
        </div>
      </aside>
    </div>
  );
}

function LifecycleOverflowPanel({ overflow, onClose }: { overflow: LifecycleOverflowState; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink-primary/15" onClick={onClose}>
      <aside role="dialog" aria-modal="true" aria-labelledby="lifecycle-overflow-title" className="h-full w-full max-w-2xl overflow-y-auto scroll-slim rounded-l-2xl border-l border-white/70 bg-white/72 p-6 text-neutral-950 shadow-2xl backdrop-blur-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">View all lifecycle records</div>
            <h3 id="lifecycle-overflow-title" className="text-xl font-semibold text-neutral-950">{formatDate(overflow.date)}</h3>
            <p className="mt-1 text-xs text-neutral-600">
              {overflow.entries.length} lifecycle record{overflow.entries.length === 1 ? "" : "s"}
            </p>
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-neutral-300/70 bg-white/50 text-neutral-500 hover:bg-white hover:text-neutral-900" aria-label="Close">x</button>
        </div>

        <div className="space-y-3">
          {overflow.entries.map((entry) => (
            <Link
              key={entry.id}
              to={`/events/${entry.event_id}`}
              onClick={onClose}
              className="block rounded-xl border border-white/65 bg-white/46 p-4 hover:bg-white/65"
            >
              <div className="flex items-center gap-2">
                <span className={"h-2 w-2 shrink-0 rounded-full " + lifecycleDot(entry.milestone_type)} />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                  {LIFECYCLE_LABELS[entry.milestone_type] ?? entry.milestone_type}
                </span>
              </div>
              <div className="mt-2 text-base font-semibold text-neutral-950">
                {entry.organisation_name ?? entry.title}
              </div>
              {entry.organisation_name && entry.organisation_name !== entry.title && (
                <div className="mt-1 text-sm text-neutral-700">{entry.title}</div>
              )}
              <div className="mt-2 text-xs text-neutral-600">
                {formatScheduledShowDate(entry.event_start_date, entry.event_end_date) ?? "Show date not set"}
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-neutral-600">
                {entry.event_code && <span>{entry.event_code}</span>}
                {entry.venues && <span>{entry.venues}</span>}
                {entry.event_owner && <span>{entry.event_owner}</span>}
                {entry.poc_complete === false && <PocStatusBadge complete={false} />}
              </div>
            </Link>
          ))}
        </div>
      </aside>
    </div>
  );
}

function LifecycleChip({ entry }: { entry: LifecycleEntry }) {
  const surface = getEventStatusSurface(entry.status);
  return (
    <Link
      to={`/events/${entry.event_id}`}
      title={`${entry.organisation_name ?? entry.title} · ${LIFECYCLE_LABELS[entry.milestone_type] ?? entry.milestone_type}`}
      className={"carved-card block min-w-0 overflow-hidden rounded-md px-1.5 py-1 text-left sm:px-2 " + surface.chip}
    >
      <div className="flex min-w-0 items-center gap-1 sm:gap-1.5">
        <span className={"h-1.5 w-1.5 shrink-0 rounded-full evt-dot " + lifecycleDot(entry.milestone_type)} />
        <span className="min-w-0 truncate text-[9px] font-bold uppercase tracking-wider text-ink-muted etched sm:text-[10px]">
          {LIFECYCLE_LABELS[entry.milestone_type] ?? entry.milestone_type}
        </span>
        {entry.poc_complete === false && (
          <span className="ml-auto shrink-0 rounded-full bg-status-awaitingApproval/15 px-1 py-0.5 text-[8px] font-bold uppercase text-status-awaitingApproval">POC</span>
        )}
      </div>
      <div className="mt-0.5 truncate text-[11px] font-medium text-ink-primary etched-deep">
        {entry.organisation_name ?? entry.title}
      </div>
    </Link>
  );
}

function MonthGrid({ byDate, today, cursor, onPick, onOpenOverflow }: { byDate: Record<string, CalEntry[]>; today: string; cursor: Date; onPick: (e: CalEntry) => void; onOpenOverflow: (overflow: ShowOverflowState) => void }) {
  const cells = calendarCellsForMonth(cursor);
  return (
    <div>
      <div className="mb-2 grid grid-cols-7 gap-1.5 sm:mb-3 sm:gap-2 lg:gap-3">
        {WEEKDAYS.map((d) => (
          <div key={d} className="text-center text-[11px] font-bold uppercase tracking-wider text-ink-dayHeader etched">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5 sm:gap-2 lg:gap-3">
        {cells.map(({ date: d, key, inCurrentMonth }) => {
          const entries = inCurrentMonth ? byDate[key] ?? [] : [];
          const isToday = key === today;
          // One chip per event. Multiple venue activities for the same event collapse
          // to the most urgent status so the day limit represents events, not rows.
          const byEvent = new Map<string, { name: string; status: EventStatus; entry: CalEntry }>();
          for (const e of entries) {
            const existing = byEvent.get(e.event_id);
            if (!existing || STATUS_RANK[e.status] < STATUS_RANK[existing.status]) {
              byEvent.set(e.event_id, { name: e.organisation_name ?? e.title, status: e.status, entry: e });
            }
          }
          const chips = Array.from(byEvent.values());
          const hiddenChips = chips.slice(CALENDAR_VISIBLE_EVENTS_PER_DAY);
          return (
            <article key={key} className={"h-[10rem] min-w-0 overflow-hidden rounded-xl p-1.5 sm:h-[13rem] sm:p-2 lg:h-[14rem] lg:p-3 " + (isToday ? "carved-today bg-sage-today-wash" : inCurrentMonth ? "carved bg-marble-highlight/40" : "carved bg-marble-shadow/20")}>
              <div className="mb-2 flex justify-end">
                <span className={"flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold etched sm:h-6 sm:w-6 sm:text-xs " + (isToday ? "bg-sage text-white sage-pip" : inCurrentMonth ? "text-ink-primary" : "text-ink-overflow")}>
                  {d.getDate()}
                </span>
              </div>
              <div className="min-w-0 space-y-1 sm:space-y-1.5">
                {chips.slice(0, CALENDAR_VISIBLE_EVENTS_PER_DAY).map((c) => (
                  <button key={c.entry.event_id} type="button" onClick={() => onPick(c.entry)} title={`${c.name} · ${c.entry.title}`} className={"carved-card flex w-full min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-left sm:gap-1.5 sm:px-2 " + getEventStatusSurface(c.status).chip}>
                    <span className={"h-1.5 w-1.5 shrink-0 rounded-full evt-dot " + getEventStatusSurface(c.status).dot} />
                    <span className="min-w-0 truncate text-[10px] font-medium etched sm:text-[11px]">{c.name}</span>
                  </button>
                ))}
                {hiddenChips.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onOpenOverflow({ date: key, entries: chips.map((chip) => chip.entry) })}
                    aria-label={`View all ${chips.length} show events on ${formatDate(key)}`}
                    title={`View ${hiddenChips.length} more show events`}
                    className="block w-full truncate rounded-md bg-marble-shadow/50 px-1.5 py-1 text-left text-[10px] font-medium text-ink-muted etched transition hover:bg-marble-shadow/70 sm:px-2"
                  >
                    +{hiddenChips.length} more
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

// ---- Venue Timeline (venues vertically, dates horizontally) ----
const VenueTimeline = ({ byDate, venues, start, onPick }: { byDate: Record<string, CalEntry[]>; venues: string[]; start: Date; onPick: (e: CalEntry) => void }) => {
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
                {formatDate(isoDate(d))}
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
                      <button key={e.id} type="button" onClick={() => onPick(e)} className={"carved-card mb-1 block w-full rounded-md px-2 py-1 text-left " + getEventStatusSurface(e.status).chip}>
                        <div className="flex items-center gap-1">
                          <span className={"h-1.5 w-1.5 shrink-0 rounded-full evt-dot " + getEventStatusSurface(e.status).dot} />
                          <span className="truncate text-[11px] font-medium etched">{e.title}</span>
                        </div>
                        {e.start_time && <div className="mt-0.5 text-[10px] text-ink-muted etched">{formatTime(e.start_time)} · {e.activity_type.replace(/_/g, " ")}</div>}
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
};
void VenueTimeline;

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d={dir === "left" ? "M15 18l-6-6 6-6" : "M9 18l6-6-6-6"} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }> }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-ink-muted etched">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="carved w-full rounded-full bg-marble-shadow/40 px-3 py-2 text-xs text-ink-primary focus:outline-none">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
