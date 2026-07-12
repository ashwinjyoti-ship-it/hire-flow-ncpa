import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth, logout } from "../../lib/auth";
import { describeAccess } from "../../../worker/lib/rbac";
import { apiGet, apiPost } from "../../lib/api";
import { BrandLogo } from "../BrandLogo";

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

/** Top navigation bar with global search + user menu (carved-header depth). */
export function Topbar({ onMenuToggle }: { onMenuToggle: () => void }) {
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

  const markAll = useMutation({
    mutationFn: async () => apiPost("/notifications/read-all"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  useEffect(() => {
    setNotificationsOpen(false);
  }, [location.pathname]);

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
    <header className="carved-header sticky top-0 z-50 mx-auto w-full max-w-[1600px] rounded-b-2xl bg-marble-highlight/75 px-3 py-3 backdrop-blur-sm sm:px-4 sm:py-4 lg:relative lg:top-auto lg:mt-6 lg:rounded-2xl lg:bg-marble-highlight/60 lg:px-6">
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
              <div className="text-[12px] font-semibold uppercase tracking-[0.2em] text-sage etched sm:text-[15px] sm:tracking-[0.24em]">
                NCPA
              </div>
              <div className="hidden truncate text-sm font-semibold text-ink-primary etched-deep sm:block">
                Venue for Hire
              </div>
            </div>
          </Link>
        </div>
        <div className="hidden flex-1 items-center justify-center md:flex">
          <input
            type="search"
            placeholder="Search events, organisations, venues…"
            aria-label="Global search"
            className="carved w-full max-w-md rounded-xl bg-marble-shadow/40 px-4 py-2 text-sm text-ink-primary placeholder:text-ink-muted focus:outline-none"
          />
        </div>
        {user ? (
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
            <div ref={notificationsRef} className="relative">
              <button
                type="button"
                aria-expanded={notificationsOpen}
                aria-controls="topbar-notifications"
                aria-label="Notifications"
                onClick={() => setNotificationsOpen((open) => !open)}
                className="carved-btn relative flex h-9 w-9 items-center justify-center rounded-full bg-neutral-btn text-ink-secondary"
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
                        Mark read
                      </button>
                    )}
                  </div>
                  <div className="max-h-80 space-y-2 overflow-auto">
                    {(data?.notifications.length ?? 0) === 0 ? (
                      <p className="text-xs text-ink-muted etched">Nothing new.</p>
                    ) : (
                      data?.notifications.map((n) => (
                        <Link
                          key={n.id}
                          to={n.related_event_id ? `/events/${n.related_event_id}` : "/tasks"}
                          onClick={() => setNotificationsOpen(false)}
                          className="block rounded-xl bg-marble-shadow/30 px-3 py-2 text-xs hover:bg-marble-shadow/50"
                        >
                          <div className="font-semibold text-ink-primary etched-deep">{n.title}</div>
                          {n.body && <div className="mt-0.5 text-ink-secondary etched">{n.body}</div>}
                          {n.event_title && <div className="mt-1 text-ink-muted etched">{n.event_title}</div>}
                        </Link>
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
              className="carved-btn flex h-9 w-9 items-center justify-center rounded-full bg-neutral-btn text-sage-text"
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
    </header>
  );
}
