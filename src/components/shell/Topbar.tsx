import { Link } from "react-router-dom";
import { useAuth, logout } from "../../lib/auth";
import { ROLE_LABELS } from "../../lib/roles";

/** Top navigation bar with global search + user menu (carved-header depth). */
export function Topbar() {
  const { user } = useAuth();

  return (
    <header className="carved-header mx-auto mt-6 w-full max-w-[1600px] rounded-2xl bg-marble-highlight/60 px-6 py-3 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-4">
        <Link to="/dashboard" className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sage-btn text-sage-text carved-btn-sage">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path d="M3 10h18M8 2v4M16 2v4" strokeLinecap="round" />
            </svg>
          </div>
          <div className="leading-tight">
            <div className="text-[13px] font-semibold uppercase tracking-wider2 text-sage etched">
              NCPA
            </div>
            <div className="text-sm font-semibold text-ink-primary etched-deep">
              Venue for Hire
            </div>
          </div>
        </Link>
        <div className="hidden flex-1 items-center justify-center md:flex">
          <input
            type="search"
            placeholder="Search events, organisations, venues…"
            aria-label="Global search"
            className="carved w-full max-w-md rounded-xl bg-marble-shadow/40 px-4 py-2 text-sm text-ink-primary placeholder:text-ink-muted focus:outline-none"
          />
        </div>
        {user ? (
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <div className="text-sm font-medium text-ink-primary etched-deep">{user.name}</div>
              <div className="text-[11px] text-sage etched">{ROLE_LABELS[user.role]}</div>
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
