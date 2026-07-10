import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { apiGet } from "../lib/api";
import { getEventStatusSurface } from "../lib/event-status-surface";
import { getEventOperationsLink, getTaskWorkLink } from "../lib/task-workflows";
import { formatDate } from "../lib/use-lookups";
import type { EventStatus } from "../../worker/lib/state-machine";

type LifecycleEntry = {
  id: string;
  milestone_type: EventStatus;
  milestone_date: string;
  event_id: string;
  event_start_date: string | null;
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
    organisation_name: string | null;
    event_status: EventStatus | null;
    source_module?: "operations" | "accounts" | null;
    source_field_key?: string | null;
    source_rule: string | null;
    due_date: string | null;
    priority: "high" | "medium" | "low";
    status: "open" | "in_progress" | "completed" | "cancelled";
  }>;
};

const STALE_CONFIRMED_TASK_RULES = new Set(["approval_followup", "confirmation_letter"]);

export function DashboardPage() {
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const { data: lifecycleData } = useQuery({
    queryKey: ["calendar-lifecycle", "dashboard", "all-records"],
    queryFn: () => apiGet<LifecycleResponse>("/calendar/lifecycle"),
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
    .sort((a, b) => lifecycleRank(a.milestone_type) - lifecycleRank(b.milestone_type) || String(a.milestone_date ?? "").localeCompare(String(b.milestone_date ?? "")));

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="All active lifecycle records and work needing attention" />

      {/* Summary cards */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
        <SummaryCard label="Enquiries" value={counts.enquiry ?? 0} status="enquiry" />
        <SummaryCard label="Tentative" value={counts.tentative ?? 0} status="tentative" />
        <SummaryCard label="Approved" value={counts.approved ?? 0} status="approved" />
        <SummaryCard label="Confirmed" value={counts.confirmed ?? 0} status="confirmed" />
        <SummaryCard label="Regret" value={counts.regret ?? 0} status="regret" />
        <SummaryCard label="Cancelled" value={counts.cancelled ?? 0} status="cancelled" />
      </div>

      <div className="grid gap-5 md:grid-cols-2 lg:gap-6">
        <section className="carved-card rounded-2xl bg-marble-highlight/50 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-sage etched">Lifecycle Queue</h2>
            <Link to="/calendar?view=lifecycle" className="text-xs text-sage-text hover:underline">Lifecycle calendar →</Link>
          </div>
          {lifecycleQueue.length === 0 ? (
            <p className="text-sm text-ink-muted etched">No active lifecycle records.</p>
          ) : (
            <ul className="space-y-2">
              {lifecycleQueue.slice(0, 8).map((e) => (
                <li key={e.id}>
                  <Link to={getEventOperationsLink(e.event_id)} className="flex items-center gap-3 rounded-lg bg-marble-shadow/30 px-3 py-2 hover:bg-marble-shadow/50">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink-primary etched-deep">
                        {e.organisation_name ?? e.title}
                      </span>
                      {e.organisation_name && e.title !== e.organisation_name && (
                        <span className="mt-0.5 block truncate text-[12px] font-medium text-ink-secondary etched">
                          {eventDisplayName(e.title, e.organisation_name)}
                        </span>
                      )}
                      <span className="mt-0.5 block text-[11px] text-ink-muted etched">{formatDate(e.milestone_date)} · {e.venues ?? "No venue"}</span>
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
                  <Link to={getTaskWorkLink(task)} className="flex items-center gap-3 rounded-lg bg-marble-shadow/30 px-3 py-2 hover:bg-marble-shadow/50">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink-primary etched-deep">
                        {task.organisation_name ?? task.event_title ?? "Unlinked task"}
                      </span>
                      <span className="mt-0.5 block truncate text-[12px] font-medium text-ink-secondary etched">
                        {task.title}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-ink-muted etched">
                        {task.event_title && task.event_title !== task.organisation_name ? `${eventDisplayName(task.event_title, task.organisation_name)} · ` : ""}
                        {task.due_date ? `Due ${formatDate(task.due_date)}` : "No due date"}
                      </span>
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

function eventDisplayName(title: string, organisationName: string | null): string {
  if (!organisationName) return title;
  const prefix = `${organisationName} - `;
  if (title.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())) {
    return title.slice(prefix.length).trim();
  }
  return title;
}

function SummaryCard({ label, value, status }: { label: string; value: number; status: EventStatus }) {
  const surface = getEventStatusSurface(status);
  return (
    <div className="carved-card rounded-2xl bg-marble-highlight/50 p-4">
      <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-wider text-ink-muted etched">{label}</span>
        <span className={"h-2.5 w-2.5 shrink-0 rounded-full evt-dot " + surface.dot} aria-hidden="true" />
      </div>
      <div className="text-3xl font-semibold text-ink-primary etched-deep">{value}</div>
    </div>
  );
}
