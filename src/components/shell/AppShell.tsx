import { Outlet, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { MarbleBackdrop } from "../MarbleBackdrop";

/**
 * Application shell: topbar + left nav stay fixed; only the main pane scrolls.
 * Applies to every authenticated page routed through this layout.
 */
export function AppShell() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    document.getElementById("app-main")?.scrollTo({ top: 0 });
  }, [location.pathname]);

  return (
    <div className="relative flex min-h-dvh flex-col overflow-x-clip lg:h-dvh lg:overflow-hidden">
      <MarbleBackdrop />
      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-[1600px] flex-col px-3 pt-3 sm:px-4 md:px-5 lg:h-full lg:min-h-0 lg:px-6 lg:pt-4">
        <Topbar onMenuToggle={() => setMobileNavOpen((open) => !open)} />
        <div className="mt-4 flex flex-1 gap-4 pb-4 lg:min-h-0 lg:gap-6 lg:pb-5">
          <Sidebar mobileOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
          <main id="app-main" className="min-w-0 flex-1 pb-8 lg:overflow-y-auto lg:overscroll-contain">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
