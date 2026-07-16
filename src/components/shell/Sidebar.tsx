import { NavLink, useLocation } from "react-router-dom";
import clsx from "clsx";
import { useEffect } from "react";

const NAV = [
  { to: "/dashboard", label: "Dashboard", shortLabel: "Dash", icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" },
  { to: "/tasks", label: "Tasks", shortLabel: "Tasks", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" },
  { to: "/calendar", label: "Calendar", shortLabel: "Calendar", icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
  { to: "/regrets", label: "Regrets", shortLabel: "Regrets", icon: "M6 18L18 6M6 6l12 12" },
  { to: "/reports", label: "Reports", shortLabel: "Reports", icon: "M9 17v-6m4 6V7m4 10v-3M5 21h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z" },
  { to: "/organisations", label: "Organisations", shortLabel: "Orgs", icon: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5" },
  { to: "/settings", label: "Settings", shortLabel: "Settings", icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z" },
];

type SidebarProps = {
  mobileOpen?: boolean;
  onClose?: () => void;
};

export function Sidebar({ mobileOpen = false, onClose }: SidebarProps) {
  const location = useLocation();

  useEffect(() => {
    if (mobileOpen) onClose?.();
  }, [location.pathname]);

  return (
    <>
      <nav className="hidden w-56 shrink-0 overflow-hidden lg:flex lg:flex-col" aria-label="Primary">
        <SidebarCard onNavigate={onClose} />
        <SidebarVine />
      </nav>

      <nav className="hidden w-20 shrink-0 overflow-hidden md:flex md:flex-col lg:hidden" aria-label="Primary">
        <TabletRail onNavigate={onClose} />
        <SidebarVine compact />
      </nav>

      <div className={clsx("fixed inset-0 z-[60] md:hidden", mobileOpen ? "pointer-events-auto" : "pointer-events-none")}>
        <button
          type="button"
          aria-label="Close navigation menu"
          onClick={onClose}
          className={clsx(
            "absolute inset-0 bg-ink-primary/20 backdrop-blur-[2px] transition-opacity",
            mobileOpen ? "opacity-100" : "opacity-0"
          )}
        />
        <div
          className={clsx(
            "absolute left-4 top-20 w-[min(18rem,calc(100vw-2rem))] transition-transform duration-200 ease-out sm:top-24",
            mobileOpen ? "translate-x-0" : "-translate-x-[120%]"
          )}
        >
          <div className="mb-3 flex items-center justify-between px-1">
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-sage etched">Navigation</div>
            <button
              type="button"
              onClick={onClose}
              className="carved-btn rounded-full bg-neutral-btn px-3 py-1 text-xs font-medium text-ink-secondary etched"
            >
              Close
            </button>
          </div>
          <SidebarCard onNavigate={onClose} />
        </div>
      </div>
    </>
  );
}

function SidebarVine({ compact = false }: { compact?: boolean }) {
  return (
    <div className={clsx("sidebar-vine-frame", compact && "sidebar-vine-frame--compact")} aria-hidden="true">
      <img
        src="/assets/decorative-vine.png?v=2"
        alt=""
        draggable={false}
        className={clsx("sidebar-vine", compact && "sidebar-vine--compact")}
      />
    </div>
  );
}

function SidebarCard({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="carved-header shrink-0 rounded-2xl bg-marble-highlight/70 p-3 backdrop-blur-sm">
      <ul className="space-y-1">
        {NAV.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              onClick={onNavigate}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-terracotta-btn text-terracotta-text carved-btn-terracotta etched"
                    : "text-ink-secondary hover:bg-marble-shadow/40"
                )
              }
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0">
                <path d={item.icon} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TabletRail({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="carved-header shrink-0 rounded-2xl bg-marble-highlight/70 p-2 backdrop-blur-sm">
      <ul className="space-y-1.5">
        {NAV.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              onClick={onNavigate}
              title={item.label}
              aria-label={item.label}
              className={({ isActive }) =>
                clsx(
                  "flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1.5 py-2 text-center text-[10px] font-semibold leading-tight transition-colors",
                  isActive
                    ? "bg-terracotta-btn text-terracotta-text carved-btn-terracotta etched"
                    : "text-ink-secondary hover:bg-marble-shadow/40"
                )
              }
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0">
                <path d={item.icon} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="w-full truncate">{item.shortLabel}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  );
}
