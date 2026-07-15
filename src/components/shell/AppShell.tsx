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
    <div className="relative flex h-dvh flex-col overflow-hidden">
      <MarbleBackdrop />
      <div className="relative z-10 mx-auto flex h-full w-full max-w-[1600px] flex-col px-4 pt-3 md:px-5 lg:px-6 lg:pt-4">
        <Topbar onMenuToggle={() => setMobileNavOpen((open) => !open)} />
        <div className="mt-4 flex min-h-0 flex-1 gap-4 pb-4 lg:gap-6 lg:pb-5">
          <Sidebar mobileOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
          <main id="app-main" className="scroll-slim min-w-0 flex-1 overflow-y-auto pb-8">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
