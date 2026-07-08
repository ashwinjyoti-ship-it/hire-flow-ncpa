import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { apiGet } from "../lib/api";
import { getEventStatusSurface } from "../lib/event-status-surface";
import { formatDate } from "../lib/use-lookups";
import type { EventStatus } from "../../worker/lib/state-machine";

type LifecycleEntry = {
  id: string;
  milestone_type: EventStatus;
  milestone_date: string;
  event_id: string;
  title: string;
  status: EventStatus;
  organisation_name: string | null;
  venues: string | null;
};
type LifecycleResponse = { entries: LifecycleEntry[]; byDate: Record<string, LifecycleEntry[]> };
type TasksResponse = {
  tasks: Array<{
    id: string;
    title: string;
    event_id: string | null;
    event_title: string | null;
    event_status: EventStatus | null;
    due_date: string | null;
    priority: "high" | "medium" | "low";
    status: "open" | "in_progress" | "completed" | "cancelled";
    source_rule: string | null;
  }>;
};

const STALE_CONFIRMED_TASK_RULES = new Set(["approval_followup", "confirmation_letter"]);

export function DashboardPage() {
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const monthStartIso = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, "0")}-${String(monthStart.getDate()).padStart(2, "0")}`;
  const monthEndIso = `${monthEnd.getFullYear()}-${String(monthEnd.getMonth() + 1).padStart(2, "0")}-${String(monthEnd.getDate()).padStart(2, "0")}`;

  const { data: lifecycleData } = useQuery({
    queryKey: ["calendar-lifecycle", "dashboard", monthStartIso, monthEndIso],
    queryFn: () => apiGet<LifecycleResponse>(`/calendar/lifecycle?from=${monthStartIso}&to=${monthEndIso}`),
  });
  const { data: taskData } = useQuery({
    queryKey: ["tasks", "dashboard", "active"],
    queryFn: () => apiGet<TasksResponse>("/tasks?status=all"),
  });

  const lifecycleEntries = lifecycleData?.entries ?? [];
  const tasks = (taskData?.tasks ?? [])
    .filter(isDashboardActionableTask)
    .sort((a, b) => taskRank(a, todayIso) - taskRank(b, todayIso));

  const counts: Record<string, number> = { enquiry: 0, tentative: 0, approved: 0, confirmed: 0, regret: 0, cancelled: 0 };
  for (const entry of lifecycleEntries) {
    if (entry.milestone_type in counts) counts[entry.milestone_type] = (counts[entry.milestone_type] ?? 0) + 1;
  }
  const lifecycleQueue = [...lifecycleEntries]
    .sort((a, b) => lifecycleRank(a.milestone_type) - lifecycleRank(b.milestone_type) || a.milestone_date.localeCompare(b.milestone_date));

  return (
    <div>
      <PageHeader title="Dashboard" subtitle={`${today.toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "Asia/Kolkata" })} lifecycle overview`} />

      {/* Summary cards */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <SummaryCard label="Enquiries" value={counts.enquiry ?? 0} status="enquiry" href={`/calendar?view=lifecycle&status=enquiry&from=${monthStartIso}`} />
        <SummaryCard label="Tentative" value={counts.tentative ?? 0} status="tentative" href={`/calendar?view=lifecycle&status=tentative&from=${monthStartIso}`} />
        <SummaryCard label="Approved" value={counts.approved ?? 0} status="approved" href={`/calendar?view=lifecycle&status=approved&from=${monthStartIso}`} />
        <SummaryCard label="Confirmed" value={counts.confirmed ?? 0} status="confirmed" href={`/calendar?view=lifecycle&status=confirmed&from=${monthStartIso}`} />
        <SummaryCard label="Regret" value={counts.regret ?? 0} status="regret" href={`/calendar?view=lifecycle&status=regret&from=${monthStartIso}`} />
        <SummaryCard label="Cancelled" value={counts.cancelled ?? 0} status="cancelled" href={`/calendar?view=lifecycle&status=cancelled&from=${monthStartIso}`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="carved-card rounded-2xl bg-marble-highlight/50 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-sage etched">Lifecycle Queue</h2>
            <Link to="/calendar?view=lifecycle" className="text-xs text-sage-text hover:underline">Lifecycle calendar →</Link>
          </div>
          {lifecycleQueue.length === 0 ? (
            <p className="text-sm text-ink-muted etched">No lifecycle cards this month.</p>
          ) : (
            <ul className="space-y-2">
              {lifecycleQueue.slice(0, 8).map((e) => (
                <li key={e.id}>
                  <Link to={`/events/${e.event_id}`} className="flex items-center gap-3 rounded-lg bg-marble-shadow/30 px-3 py-2 hover:bg-marble-shadow/50">
                    <span className="flex-1 truncate">
                      <span className="block text-sm font-medium text-ink-primary etched-deep">{e.organisation_name ?? e.title}</span>
                      <span className="block text-[11px] text-ink-muted etched">{formatDate(e.milestone_date)} · {e.venues ?? "No venue"}</span>
                    </span>
                    <StatusBadge status={e.milestone_type} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="carved-card rounded-2xl bg-marble-highlight/50 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-sage etched">Work Needing Attention</h2>
            <Link to="/tasks" className="text-xs text-sage-text hover:underline">Tasks →</Link>
          </div>
          {tasks.length === 0 ? (
            <p className="text-sm text-ink-muted etched">No open tasks.</p>
          ) : (
            <ul className="space-y-2">
              {tasks.slice(0, 8).map((task) => (
                <li key={task.id}>
                  <Link to={task.event_id ? `/events/${task.event_id}` : "/tasks"} className="flex items-center gap-3 rounded-lg bg-marble-shadow/30 px-3 py-2 hover:bg-marble-shadow/50">
                    <span className="flex-1 truncate">
                      <span className="block text-sm font-medium text-ink-primary etched-deep">{task.title}</span>
                      <span className="block text-[11px] text-ink-muted etched">{task.event_title ?? "Unlinked task"} · {task.due_date ? `Due ${formatDate(task.due_date)}` : "No due date"}</span>
                    </span>
                    {task.event_status && <StatusBadge status={task.event_status} />}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function lifecycleRank(status: EventStatus): number {
  if (status === "enquiry") return 0;
  if (status === "tentative") return 1;
  if (status === "approved") return 2;
  return 3;
}

function taskRank(task: TasksResponse["tasks"][number], todayIso: string): number {
  if (task.due_date && task.due_date < todayIso) return 0;
  if (task.due_date === todayIso) return 1;
  if (task.priority === "high") return 2;
  if (task.due_date) return 3;
  return 4;
}

function isDashboardActionableTask(task: TasksResponse["tasks"][number]): boolean {
  if (task.status !== "open" && task.status !== "in_progress") return false;
  if (task.event_status === "confirmed" && task.source_rule && STALE_CONFIRMED_TASK_RULES.has(task.source_rule)) return false;
  return true;
}

function SummaryCard({ label, value, status, href }: { label: string; value: number; status: EventStatus; href: string }) {
  const surface = getEventStatusSurface(status);
  return (
    <Link to={href} className="carved-card rounded-2xl bg-marble-highlight/50 p-4 transition-colors hover:bg-marble-highlight/80">
      <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-wider text-ink-muted etched">{label}</span>
        <span className={"h-2.5 w-2.5 shrink-0 rounded-full evt-dot " + surface.dot} aria-hidden="true" />
      </div>
      <div className="text-3xl font-semibold text-ink-primary etched-deep">{value}</div>
    </Link>
  );
}
