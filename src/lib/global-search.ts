import { apiGet } from "./api";
import { normaliseCalendarDate } from "./lifecycle-calendar-links";

export type SearchOrg = {
  id: string;
  name: string;
  org_type: string | null;
  event_count: number;
};

export type SearchEvent = {
  id: string;
  title: string;
  organisation_name: string | null;
  event_start_date: string | null;
  status: string;
  venues: string | null;
};

export type CalendarView = "show" | "lifecycle";

export type SearchContext = "calendar" | "dashboard" | "tasks" | "default";

type LifecycleSearchEntry = {
  event_id: string;
  milestone_date: string;
};

/** Confirmed events belong on the Show calendar; everything else stays on Lifecycle. */
export function calendarViewForEvent(event: SearchEvent | undefined, fallback: CalendarView): CalendarView {
  return event?.status === "confirmed" ? "show" : fallback;
}

export function searchContextFromPath(pathname: string): SearchContext {
  if (pathname === "/calendar") return "calendar";
  if (pathname === "/dashboard") return "dashboard";
  if (pathname === "/tasks") return "tasks";
  return "default";
}

export function monthStartFromIsoDate(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export function calendarUrlForSearch(term: string, view: CalendarView, anchorDate?: string | null): string {
  const params = new URLSearchParams({ view, q: term });
  if (anchorDate && /^\d{4}-\d{2}-\d{2}$/.test(anchorDate)) {
    params.set("from", monthStartFromIsoDate(anchorDate));
  }
  return `/calendar?${params.toString()}`;
}

export function matchesSearchTerm(term: string, ...fields: Array<string | null | undefined>): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) return true;
  return fields.some((field) => (field ?? "").toLowerCase().includes(needle));
}

/** Lifecycle grids anchor on milestone dates; Show calendar anchors on event start dates. */
export async function resolveCalendarAnchorDate(
  term: string,
  view: CalendarView,
  options?: { statusQuery?: string; eventId?: string },
): Promise<string | null> {
  const statusQuery = options?.statusQuery ?? "";
  if (view === "show") {
    const res = await apiGet<{ events: SearchEvent[] }>(`/events?q=${encodeURIComponent(term)}${statusQuery}`);
    const match = options?.eventId
      ? res.events.find((event) => event.id === options.eventId)
      : res.events[0];
    const date = normaliseCalendarDate(match?.event_start_date ?? null);
    return date ?? null;
  }

  const res = await apiGet<{ entries: LifecycleSearchEntry[] }>(
    `/calendar/lifecycle?q=${encodeURIComponent(term)}`,
  );
  const match = options?.eventId
    ? res.entries.find((entry) => entry.event_id === options.eventId)
    : res.entries[0];
  const date = normaliseCalendarDate(match?.milestone_date ?? null);
  return date ?? null;
}

export async function buildCalendarSearchUrl(
  term: string,
  view: CalendarView,
  options?: { statusQuery?: string; eventId?: string },
): Promise<string> {
  const anchorDate = await resolveCalendarAnchorDate(term, view, options);
  return calendarUrlForSearch(term, view, anchorDate);
}

export async function resolveSearchNavigation(
  pathname: string,
  term: string,
  orgs: SearchOrg[],
  events: SearchEvent[],
  options?: { calendarView?: CalendarView; statusQuery?: string },
): Promise<string> {
  const context = searchContextFromPath(pathname);
  const encoded = encodeURIComponent(term);

  if (context === "dashboard") return `/dashboard?q=${encoded}`;
  if (context === "tasks") return `/tasks?q=${encoded}`;

  const calendarView = options?.calendarView ?? "lifecycle";
  const firstEvent = events[0];
  const targetView = context === "calendar" ? calendarView : calendarViewForEvent(firstEvent, calendarView);
  const statusQuery = targetView === "show" ? "&status=confirmed" : (options?.statusQuery ?? "");
  const hasCalendarTarget = events.length > 0 || orgs.some((org) => org.event_count > 0);

  if (hasCalendarTarget || context === "calendar") {
    return buildCalendarSearchUrl(term, targetView, {
      statusQuery,
      eventId: firstEvent?.id,
    });
  }
  if (orgs.length > 0) return `/organisations?q=${encoded}`;
  return calendarUrlForSearch(term, targetView);
}

export async function buildOrganisationSearchUrl(
  org: SearchOrg,
  pathname: string,
  calendarView: CalendarView,
): Promise<string> {
  const context = searchContextFromPath(pathname);
  if (context === "dashboard") return `/dashboard?q=${encodeURIComponent(org.name)}`;
  if (context === "tasks") return `/tasks?q=${encodeURIComponent(org.name)}`;
  if (org.event_count > 0 || context === "calendar") {
    return buildCalendarSearchUrl(org.name, calendarView);
  }
  return `/organisations?q=${encodeURIComponent(org.name)}`;
}
