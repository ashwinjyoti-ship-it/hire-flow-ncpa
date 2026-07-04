import { Link } from "react-router-dom";

/** Top navigation bar with global search (carved-header depth). */
export function Topbar() {
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
        <div className="flex flex-1 items-center justify-center">
          <input
            type="search"
            placeholder="Search events, organisations, venues…"
            aria-label="Global search"
            className="carved w-full max-w-md rounded-xl bg-marble-shadow/40 px-4 py-2 text-sm text-ink-primary placeholder:text-ink-muted focus:outline-none"
          />
        </div>
      </div>
    </header>
  );
}
