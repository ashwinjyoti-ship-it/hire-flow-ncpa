import { Outlet } from "react-router-dom";
import { useState } from "react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { MarbleBackdrop } from "../MarbleBackdrop";

/** Application shell: marble backdrop + topbar + sidebar + routed content. */
export function AppShell() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="min-h-screen">
      <MarbleBackdrop />
      <Topbar onMenuToggle={() => setMobileNavOpen((open) => !open)} />
      <div className="mx-auto flex w-full max-w-[1600px] gap-4 px-4 py-5 md:px-5 lg:gap-6 lg:px-6 lg:py-6">
        <Sidebar mobileOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
