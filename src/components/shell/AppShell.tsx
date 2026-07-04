import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { MarbleBackdrop } from "../MarbleBackdrop";

/** Application shell: marble backdrop + topbar + sidebar + routed content. */
export function AppShell() {
  return (
    <div className="min-h-screen">
      <MarbleBackdrop />
      <Topbar />
      <div className="mx-auto flex w-full max-w-[1600px] gap-6 px-6 py-6">
        <Sidebar />
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
