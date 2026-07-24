import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth, logout } from "../../lib/auth";
import { describeAccess } from "../../../worker/lib/rbac";
import { apiGet, apiPost } from "../../lib/api";
import { BrandLogo } from "../BrandLogo";
import { formatDate } from "../../lib/use-lookups";
import { StickyNotesLauncher } from "../sticky-notes/StickyNotesLauncher";

type NotificationRow = {
  id: string;
  title: string;
  body: string | null;
  related_event_id: string | null;
  related_task_id: string | null;
  event_title: string | null;
  task_title: string | null;
  created_at: string;
};

type SearchOrg = {
  id: string;
  name: string;
  org_type: string | null;
  event_count: number;
};

type SearchEvent = {
  id: string;
  title: string;
  organisation_name: string | null;
  event_start_date: string | null;
  status: string;
  venues: string | null;
};

function calendarViewForEvent(event: SearchEvent | undefined, fallback: "show" | "lifecycle"): "show" | "lifecycle" {
  return event?.status === "confirmed" ? "show" : fallback;
}

function calendarUrlForSearch(term: string, view: "show" | "lifecycle", event?: SearchEvent): string {
  const params = new URLSearchParams({ view, q: term });
  if (event?.event_start_date) params.set("from", event.event_start_date);
  return `/calendar?${params.toString()}`;
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/** Top navigation bar with global search + user menu (carved-header depth). */
type TopbarProps = {
  onMenuToggle: () => void;
  onStickyNotesOpen: () => void;
};

export function Topbar({ onMenuToggle, onStickyNotesOpen }: TopbarProps) {
  const { user } = useAuth();
  const location = useLocation();
  const qc = useQueryClient();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const notificationsRef = useRef<HTMLDivElement | null>(null);
  const { data } = useQuery({
    queryKey: ["notifications", "unread"],
    queryFn: () => apiGet<{ notifications: NotificationRow[]; unread: number }>("/notifications?unread=1"),
    enabled: Boolean(user),
    refetchInterval: 60_000,
  });

  const markOne = useMutation({
    mutationFn: async (id: string) => apiPost(`/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markAll = useMutation({
    mutationFn: async () => apiPost("/notifications/read-all"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  useEffect(() => {
    setNotificationsOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!notificationsOpen) return;

    function onPointerDown(event: PointerEvent) {
      if (!notificationsRef.current?.contains(event.target as Node)) {
        setNotificationsOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setNotificationsOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [notificationsOpen]);

  return (
    <header className="carved-header z-50 w-full shrink-0 rounded-2xl bg-marble-highlight/75 px-3 py-3 backdrop-blur-sm sm:px-4 sm:py-4 lg:bg-marble-highlight/60 lg:px-6">
      <div className="flex items-center justify-between gap-2 sm:gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={onMenuToggle}
            aria-label="Open navigation menu"
            className="carved-btn flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-neutral-btn text-ink-secondary md:hidden"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
            </svg>
          </button>
          <Link to="/dashboard" className="flex min-w-0 items-center gap-2 sm:gap-3">
            <div className="w-20 shrink-0 sm:w-28 lg:w-32">
              <BrandLogo className="drop-shadow-[0_8px_16px_rgba(73,88,58,0.14)]" />
            </div>
            <div className="min-w-0 leading-tight">
              <div className="text-sm font-semibold uppercase tracking-[0.2em] text-sage etched sm:text-lg sm:tracking-[0.24em]">
                NCPA
              </div>
              <div className="hidden truncate text-xs font-medium text-ink-secondary etched sm:block">
                Venue for Hire
              </div>
            </div>
          </Link>
        </div>
        <div className="hidden min-w-0 flex-[1.4] items-center justify-center md:flex">
          <GlobalSearch />
        </div>
        {user ? (
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
            <StickyNotesLauncher onOpen={onStickyNotesOpen} />
            <div ref={notificationsRef} className="relative">
              <button
                type="button"
                aria-expanded={notificationsOpen}
                aria-controls="topbar-notifications"
                aria-label="Notifications"
                onClick={() => setNotificationsOpen((open) => !open)}
                className="carved-btn relative flex h-9 w-9 items-center justify-center rounded-full bg-neutral-btn text-terracotta-text"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M18 8a6 6 0 10-12 0c0 7-3 7-3 7h18s-3 0-3-7" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M13.73 21a2 2 0 01-3.46 0" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {(data?.unread ?? 0) > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-status-cancelled px-1 text-[10px] font-semibold text-white">
                    {data?.unread}
                  </span>
                )}
              </button>
              <div
                id="topbar-notifications"
                className={`absolute right-0 z-[70] mt-2 w-80 transition ${notificationsOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}
              >
                <div className="carved-card rounded-2xl bg-marble-highlight p-4 shadow-xl">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-sage etched">Notifications</h2>
                    {(data?.unread ?? 0) > 0 && (
                      <button
                        type="button"
                        onClick={() => markAll.mutate()}
                        className="text-xs text-sage-text underline"
                      >
                        Mark all read
                      </button>
                    )}
                  </div>
                  <div className="max-h-80 space-y-2 overflow-auto">
                    {(data?.notifications.length ?? 0) === 0 ? (
                      <p className="text-xs text-ink-muted etched">Nothing new.</p>
                    ) : (
                      data?.notifications.map((n) => (
                        <div
                          key={n.id}
                          className="rounded-xl bg-marble-shadow/30 px-3 py-2 text-xs"
                        >
                          <Link
                            to={n.related_event_id ? `/events/${n.related_event_id}` : "/tasks"}
                            onClick={() => {
                              markOne.mutate(n.id);
                              setNotificationsOpen(false);
                            }}
                            className="block hover:opacity-80"
                          >
                            <div className="font-semibold text-ink-primary etched-deep">{n.title}</div>
                            {n.body && <div className="mt-0.5 text-ink-secondary etched">{n.body}</div>}
                            {n.event_title && <div className="mt-1 text-ink-muted etched">{n.event_title}</div>}
                          </Link>
                          <button
                            type="button"
                            onClick={() => markOne.mutate(n.id)}
                            className="mt-2 text-[11px] font-medium text-sage-text underline"
                          >
                            Mark as Read
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="hidden text-right sm:block">
              <div className="text-sm font-medium text-ink-primary etched-deep">{user.name}</div>
              <div className="text-[11px] text-sage etched">{describeAccess(user.permissions)}</div>
            </div>
            <Link
              to="/profile"
              aria-label="Profile and security"
              className="carved-btn flex h-9 w-9 items-center justify-center rounded-full bg-neutral-btn text-terracotta-text"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </Link>
            <button
              type="button"
              onClick={() => logout()}
              aria-label="Sign out"
              className="carved-btn flex h-9 w-9 items-center justify-center rounded-full bg-neutral-btn text-ink-secondary"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        ) : null}
      </div>
      <div className="mt-3 md:hidden">
        <GlobalSearch />
      </div>
    </header>
  );
}

function GlobalSearch() {
  const navigate = useNavigate();
  const location = useLocation();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const debounced = useDebouncedValue(query.trim(), 250);
  const ready = debounced.length >= 2;
  const onCalendar = location.pathname === "/calendar";
  const calendarView: "show" | "lifecycle" =
    onCalendar && new URLSearchParams(location.search).get("view") === "show" ? "show" : "lifecycle";
  const calendarLabel = calendarView === "show" ? "Show calendar" : "Lifecycle calendar";

  const { data: orgData, isFetching: orgsLoading } = useQuery({
    queryKey: ["global-search-orgs", debounced],
    queryFn: () => apiGet<{ organisations: SearchOrg[] }>(`/organisations?q=${encodeURIComponent(debounced)}`),
    enabled: ready,
  });
  const eventStatusQuery = onCalendar && calendarView === "show" ? "&status=confirmed" : "";
  const { data: eventData, isFetching: eventsLoading } = useQuery({
    queryKey: ["global-search-events", debounced, eventStatusQuery],
    queryFn: () => apiGet<{ events: SearchEvent[] }>(`/events?q=${encodeURIComponent(debounced)}${eventStatusQuery}`),
    enabled: ready,
  });

  const organisations = (orgData?.organisations ?? []).slice(0, 5);
  const events = (eventData?.events ?? []).slice(0, 6);
  const loading = ready && (orgsLoading || eventsLoading);
  const hasResults = organisations.length > 0 || events.length > 0;

  useEffect(() => {
    setOpen(false);
    // Keep the input aligned with shareable page filters instead of wiping it on
    // every URL change — that left calendar users unable to clear a search.
    const urlQ = new URLSearchParams(location.search).get("q") ?? "";
    if (
      location.pathname === "/calendar" ||
      location.pathname === "/organisations" ||
      location.pathname === "/tasks"
    ) {
      setQuery(urlQ);
    } else {
      setQuery("");
    }
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function submitSearch() {
    const term = query.trim();
    if (!term) return;
    // When already on a calendar view, stay on that exact view (Show vs Lifecycle).
    const view = onCalendar ? calendarView : "lifecycle";
    try {
      const statusQuery = view === "show" ? "&status=confirmed" : "";
      const [orgRes, eventRes] = await Promise.all([
        apiGet<{ organisations: SearchOrg[] }>(`/organisations?q=${encodeURIComponent(term)}`),
        apiGet<{ events: SearchEvent[] }>(`/events?q=${encodeURIComponent(term)}${statusQuery}`),
      ]);
      const firstEvent = eventRes.events[0];
      const targetView = onCalendar ? view : calendarViewForEvent(firstEvent, view);
      if (firstEvent?.event_start_date) {
        navigate(calendarUrlForSearch(term, targetView, firstEvent));
      } else if (onCalendar) {
        // Stay on the active calendar even if only an org name matched.
        navigate(calendarUrlForSearch(term, targetView));
      } else if (orgRes.organisations.length > 0) {
        navigate(`/organisations?q=${encodeURIComponent(term)}`);
      } else {
        navigate(calendarUrlForSearch(term, view));
      }
    } catch {
      navigate(calendarUrlForSearch(term, view));
    }
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative w-full max-w-md">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submitSearch();
        }}
      >
        <input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={onCalendar ? `Search ${calendarLabel.toLowerCase()}…` : "Search events, organisations…"}
          aria-label={onCalendar ? `Search ${calendarLabel}` : "Global search"}
          aria-expanded={open && ready}
          aria-controls="topbar-global-search-results"
          className="carved w-full rounded-xl bg-marble-shadow/40 px-4 py-2 text-sm text-ink-primary placeholder:text-ink-muted focus:outline-none"
        />
      </form>
      {open && ready && (
        <div
          id="topbar-global-search-results"
          className="absolute left-0 right-0 z-[70] mt-2 overflow-hidden rounded-2xl bg-marble-highlight shadow-xl"
        >
          <div className="max-h-96 overflow-auto p-3">
            {loading && !hasResults ? (
              <p className="px-2 py-3 text-xs text-ink-muted etched">Searching…</p>
            ) : !hasResults ? (
              <p className="px-2 py-3 text-xs text-ink-muted etched">No matches for “{debounced}”.</p>
            ) : (
              <div className="space-y-3">
                {organisations.length > 0 && (
                  <div>
                    <h3 className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-sage etched">Organisations</h3>
                    <ul className="space-y-1">
                      {organisations.map((org) => (
                        <li key={org.id}>
                          <button
                            type="button"
                            onClick={() => {
                              if (onCalendar) {
                                navigate(calendarUrlForSearch(org.name, calendarView));
                              } else {
                                navigate(`/organisations?q=${encodeURIComponent(org.name)}`);
                              }
                              setOpen(false);
                            }}
                            className="w-full rounded-xl px-3 py-2 text-left hover:bg-marble-shadow/40"
                          >
                            <div className="text-sm font-medium text-ink-primary etched-deep">{org.name}</div>
                            <div className="text-[11px] text-ink-muted etched">
                              {[org.org_type, `${org.event_count} event${org.event_count === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {events.length > 0 && (
                  <div>
                    <h3 className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-sage etched">Events</h3>
                    <ul className="space-y-1">
                      {events.map((event) => (
                        <li key={event.id}>
                          <Link
                            to={calendarUrlForSearch(event.title, calendarViewForEvent(event, calendarView), event)}
                            onClick={() => setOpen(false)}
                            className="block rounded-xl px-3 py-2 hover:bg-marble-shadow/40"
                          >
                            <div className="text-sm font-medium text-ink-primary etched-deep">{event.title}</div>
                            <div className="text-[11px] text-ink-muted etched">
                              {[event.organisation_name, formatDate(event.event_start_date), event.venues].filter(Boolean).join(" · ")}
                            </div>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2 border-t border-ink-muted/10 px-3 py-2">
            {!onCalendar && (
              <button
                type="button"
                onClick={() => {
                  navigate(`/organisations?q=${encodeURIComponent(query.trim())}`);
                  setOpen(false);
                }}
                className="rounded-full px-3 py-1 text-[11px] font-medium text-sage-text hover:bg-sage/10"
              >
                View organisations
              </button>
            )}
            <button
              type="button"
              onClick={submitSearch}
              className="rounded-full px-3 py-1 text-[11px] font-medium text-sage-text hover:bg-sage/10"
            >
              {onCalendar ? `View on ${calendarLabel}` : "View on calendar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
