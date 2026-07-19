import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { AnnouncementBanner } from "../components/AnnouncementBanner";
import { PocStatusBadge } from "../components/PocIncompleteBanner";
import { apiGet } from "../lib/api";
import { dashboardOperationalCounts, operationalLifecycleEntries } from "../lib/dashboard-operational-counts";
import { getEventStatusSurface } from "../lib/event-status-surface";
import { eventDisplayName } from "../lib/event-display";
import { getDaysOverdue, getEventOperationsLink, getTaskWorkLink } from "../lib/task-workflows";
import { BLOCKER_TARGETS, resolveBlockerWorkHref } from "../lib/lifecycle-blocker-targets";
import { formatDate } from "../lib/use-lookups";
import type { EventStatus } from "../../worker/lib/state-machine";

type LifecycleEntry = {
  id: string;
  milestone_type: EventStatus;
  milestone_date: string;
  enquiry_date?: string | null;
  event_id: string;
  event_start_date: string | null;
  event_end_date?: string | null;
  title: string;
  status: EventStatus;
  organisation_name: string | null;
  venues: string | null;
  poc_complete?: boolean;
  poc_filled_count?: number;
  poc_total_count?: number;
  poc_missing_labels?: string[];
  event_form_readiness?: number;
  decision_status?: "approved" | "confirmed" | null;
  decision_allowed?: boolean;
  decision_blocker?: string | null;
};
type LifecycleResponse = {
  entries: LifecycleEntry[];
  byDate: Record<string, LifecycleEntry[]>;
};
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
    event_form_readiness?: number | null;
  }>;
};

const STALE_CONFIRMED_TASK_RULES = new Set(["approval_followup", "confirmation_letter"]);
const DASHBOARD_VISIBLE_EVENTS = 5;
const DASHBOARD_LIST_MAX_HEIGHT = `${DASHBOARD_VISIBLE_EVENTS * 6.75 + (DASHBOARD_VISIBLE_EVENTS - 1) * 0.5}rem`;
const DASHBOARD_LIST_STYLE = { maxHeight: DASHBOARD_LIST_MAX_HEIGHT } as const;

export function DashboardPage() {
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const { data: lifecycleData, isError: lifecycleLoadFailed } = useQuery({
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
  const actionGroups = groupDashboardActions(tasks);
  const overdueActionGroupCount = actionGroups.filter((group) => getDaysOverdue(group.lead, todayIso) > 0).length;
  const operationalEntries = operationalLifecycleEntries(lifecycleEntries, todayIso);
  const operationalCounts = dashboardOperationalCounts(lifecycleEntries, todayIso);
  const pipelineDecisions = operationalEntries
    .filter((entry) => entry.status === "enquiry" || entry.status === "tentative" || entry.status === "approved")
    .sort((a, b) => pipelineDecisionRank(a, todayIso) - pipelineDecisionRank(b, todayIso)
      || compareOptionalDates(usablePipelineDate(a.event_start_date), usablePipelineDate(b.event_start_date))
      || String(a.milestone_date ?? "").localeCompare(String(b.milestone_date ?? "")));
  const pipelineDecisionGroups = groupPipelineDecisions(pipelineDecisions);
  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Pipeline decisions and the next action for each event"
        actions={(
          <Link to="/events/new" className="carved-btn-terracotta rounded-full bg-terracotta-btn px-5 py-2 text-sm font-semibold text-terracotta-text etched hover:bg-terracotta-btn-hover">
            + New Event
          </Link>
        )}
      />

      <AnnouncementBanner />

      {lifecycleLoadFailed && (
        <div role="alert" className="mb-6 rounded-2xl border border-status-cancelled/30 bg-status-cancelled/10 px-5 py-4 text-sm text-status-cancelled etched">
          Lifecycle counts and pipeline decisions are temporarily unavailable. Task actions are still shown below.
        </div>
      )}

      {/* Summary cards */}
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <SummaryCard
          label="Active enquiries"
          value={lifecycleLoadFailed ? "—" : operationalCounts.activeEnquiries}
          status="enquiry"
          hint="Future-dated enquiries, plus undated enquiries received in the last 30 days"
        />
        <SummaryCard
          label="Awaiting confirmation"
          value={lifecycleLoadFailed ? "—" : operationalCounts.awaitingConfirmation}
          status="approved"
          hint="Upcoming tentative and approved events"
        />
        <SummaryCard
          label="Confirmed"
          value={lifecycleLoadFailed ? "—" : operationalCounts.confirmed}
          status="confirmed"
          hint="Confirmed events remain counted through their start date"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-5 lg:gap-6">
        <section className="carved-card rounded-2xl bg-marble-highlight/50 p-5 lg:col-span-2">
          <div className="mb-1 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-sage etched">Pipeline Decisions</h2>
            <Link to="/calendar?view=lifecycle" className="text-xs text-sage-text hover:underline">Lifecycle calendar →</Link>
          </div>
          <p className="mb-4 text-[11px] text-ink-muted etched">One event per row · up to {DASHBOARD_VISIBLE_EVENTS} visible at once · scroll for more</p>
          {lifecycleLoadFailed ? (
            <p className="text-sm text-status-cancelled etched">Pipeline decisions could not be loaded.</p>
          ) : pipelineDecisionGroups.length === 0 ? (
            <p className="text-sm text-ink-muted etched">No enquiry, tentative, or approved events need a pipeline decision.</p>
          ) : (
            <ul
              className="space-y-2 overflow-y-auto scroll-slim pr-1"
              style={DASHBOARD_LIST_STYLE}
              aria-label={`${pipelineDecisionGroups.length} pipeline decision events`}
            >
              {pipelineDecisionGroups.map((group) => {
                const entry = group.lead;
                return (
                <li key={group.key} className="min-h-[6.75rem]">
                  <Link to={pipelineDecisionHref(entry)} className="flex h-full items-start gap-3 rounded-lg bg-marble-shadow/30 px-3 py-2.5 hover:bg-marble-shadow/50">
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-semibold text-ink-primary etched-deep">{entry.organisation_name ?? entry.title}</span>
                        {group.count > 1 && (
                          <span className="shrink-0 rounded-full bg-marble-shadow/60 px-2 py-0.5 text-[10px] font-semibold text-ink-muted etched">+{group.count - 1} matching</span>
                        )}
                      </span>
                      {entry.organisation_name && entry.title !== entry.organisation_name && (
                        <span className="mt-0.5 block truncate text-[12px] font-medium text-ink-secondary etched">
                          {eventDisplayName(entry.title, entry.organisation_name)}
                        </span>
                      )}
                      <span className={`mt-1 block text-[11px] font-medium etched ${entry.decision_allowed ? "text-sage-text" : "text-status-awaitingApproval"}`}>
                        {entry.decision_blocker ?? (entry.decision_status ? `${pipelineMilestoneLabel(entry.decision_status)} is ready` : "Review lifecycle status")}
                      </span>
                      <span className="mt-1 block text-[11px] text-ink-muted etched">
                        {usablePipelineDate(entry.event_start_date) ? `Event ${formatDate(entry.event_start_date!)}` : `Entered ${formatDate(entry.milestone_date)}`} · {entry.venues && entry.venues !== "0" ? entry.venues : "No venue"}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <PipelineDecisionBadge entry={entry} />
                      {entry.poc_complete === false && <PocStatusBadge complete={false} />}
                      <StatusBadge status={entry.status} />
                    </span>
                  </Link>
                </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="carved-card rounded-2xl bg-marble-highlight/50 p-5 lg:col-span-3">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-sage etched">Next Actions</h2>
              {overdueActionGroupCount > 0 && (
                <span className="text-[11px] font-semibold text-status-cancelled etched">
                  {overdueActionGroupCount} event{overdueActionGroupCount === 1 ? "" : "s"} with overdue actions
                </span>
              )}
            </div>
            <Link to="/tasks" className="text-xs text-sage-text hover:underline">All tasks →</Link>
          </div>
          <p className="mb-4 text-[11px] text-ink-muted etched">One priority action per event · up to {DASHBOARD_VISIBLE_EVENTS} visible at once · scroll for more</p>
          {actionGroups.length === 0 ? (
            <p className="text-sm text-ink-muted etched">No open actions.</p>
          ) : (
            <ul
              className="space-y-2 overflow-y-auto scroll-slim pr-1"
              style={DASHBOARD_LIST_STYLE}
              aria-label={`${actionGroups.length} next-action events`}
            >
              {actionGroups.map((group) => {
                const task = group.lead;
                const daysOverdue = getDaysOverdue(task, todayIso);
                return (
                  <li key={group.key} className="min-h-[6.75rem]">
                    <Link to={getTaskWorkLink(task)} className="flex h-full items-start gap-3 rounded-lg bg-marble-shadow/30 px-3 py-2.5 hover:bg-marble-shadow/50">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-ink-primary etched-deep">
                          {task.organisation_name ?? task.event_title ?? "Unlinked task"}
                        </span>
                        <span className="mt-0.5 block truncate text-[12px] font-medium text-ink-secondary etched">
                          {task.title}
                        </span>
                        <span className="mt-0.5 block text-[11px] text-ink-muted etched">
                          {task.event_title && task.event_title !== task.organisation_name ? `${eventDisplayName(task.event_title, task.organisation_name)} · ` : ""}
                          <span className={daysOverdue > 0 ? "font-semibold text-status-cancelled" : undefined}>
                            {task.due_date ? `Due ${formatDate(task.due_date)}` : "No due date"}
                            {daysOverdue > 0 ? ` · ${daysOverdue} ${daysOverdue === 1 ? "day" : "days"} late` : ""}
                          </span>
                          {group.count > 1 ? ` · ${group.count} open tasks` : ""}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <TaskAttentionBadge task={task} todayIso={todayIso} />
                        {task.event_form_readiness != null && (
                          <span className="rounded-full bg-sage/10 px-2 py-0.5 text-[10px] font-semibold text-sage-text etched">
                            {Math.round(task.event_form_readiness)}% ready
                          </span>
                        )}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function pipelineDecisionRank(entry: LifecycleEntry, todayIso: string): number {
  const eventDate = usablePipelineDate(entry.event_start_date);
  if (eventDate && eventDate <= todayIso) return 0;
  if (eventDate) {
    const daysToEvent = Math.round((Date.parse(`${eventDate}T00:00:00Z`) - Date.parse(`${todayIso}T00:00:00Z`)) / 86_400_000);
    if (daysToEvent <= 14) return 1;
  }
  if (entry.decision_allowed) return 2;
  if (entry.poc_complete === false) return 3;
  if (entry.decision_blocker) return 4;
  return 5;
}

function usablePipelineDate(value: string | null | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || year < 2000 || !month || month > 12 || !day || day > 31) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() + 1 === month && parsed.getUTCDate() === day ? value : null;
}

function compareOptionalDates(a: string | null | undefined, b: string | null | undefined): number {
  if (a && b) return a.localeCompare(b);
  if (a) return -1;
  if (b) return 1;
  return 0;
}

function pipelineMilestoneLabel(status: "approved" | "confirmed"): string {
  return status === "approved" ? "Approval" : "Confirmation";
}

function pipelineDecisionHref(entry: LifecycleEntry): string {
  const target = entry.decision_blocker ? BLOCKER_TARGETS[entry.decision_blocker] : undefined;
  if (!target) return getEventOperationsLink(entry.event_id);
  return resolveBlockerWorkHref(entry.event_id, target);
}

function PipelineDecisionBadge({ entry }: { entry: LifecycleEntry }) {
  if (!entry.decision_status) {
    return <span className="rounded-full bg-marble-shadow/60 px-2 py-0.5 text-[10px] font-semibold text-ink-muted etched">Review</span>;
  }
  const label = pipelineMilestoneLabel(entry.decision_status);
  return entry.decision_allowed ? (
    <span className="rounded-full bg-status-confirmed/15 px-2 py-0.5 text-[10px] font-semibold text-sage-text etched">Ready: {label}</span>
  ) : (
    <span className="rounded-full bg-status-awaitingApproval/15 px-2 py-0.5 text-[10px] font-semibold text-status-awaitingApproval etched">{label} blocked</span>
  );
}

function taskRank(task: TasksResponse["tasks"][number], todayIso: string): number {
  if (task.due_date && task.due_date < todayIso) return 0;
  if (task.due_date === todayIso) return 1;
  if (task.priority === "high") return 2;
  if (task.due_date) return 3;
  return 4;
}

type DashboardActionGroup = {
  key: string;
  lead: TasksResponse["tasks"][number];
  count: number;
};

type PipelineDecisionGroup = {
  key: string;
  lead: LifecycleEntry;
  count: number;
};

function groupPipelineDecisions(entries: LifecycleEntry[]): PipelineDecisionGroup[] {
  const groups = new Map<string, PipelineDecisionGroup>();
  for (const entry of entries) {
    const eventDate = usablePipelineDate(entry.event_start_date) ?? entry.milestone_date;
    const key = [entry.organisation_name ?? "", entry.title, eventDate, entry.venues ?? "", entry.status]
      .map((value) => value.trim().toLowerCase())
      .join("|");
    const existing = groups.get(key);
    if (existing) existing.count += 1;
    else groups.set(key, { key, lead: entry, count: 1 });
  }
  return Array.from(groups.values());
}

function groupDashboardActions(tasks: TasksResponse["tasks"]): DashboardActionGroup[] {
  const groups = new Map<string, DashboardActionGroup>();
  for (const task of tasks) {
    const key = task.event_id ?? `task:${task.id}`;
    const existing = groups.get(key);
    if (existing) existing.count += 1;
    else groups.set(key, { key, lead: task, count: 1 });
  }
  return Array.from(groups.values());
}

function TaskAttentionBadge({ task, todayIso }: { task: TasksResponse["tasks"][number]; todayIso: string }) {
  if (getDaysOverdue(task, todayIso) > 0) return null;
  if (task.due_date === todayIso) {
    return <span className="rounded-full bg-status-awaitingApproval/15 px-2 py-0.5 text-[10px] font-semibold text-status-awaitingApproval etched">Due today</span>;
  }
  if (task.priority === "high") {
    return <span className="rounded-full bg-status-tentative/15 px-2 py-0.5 text-[10px] font-semibold text-status-tentative etched">High priority</span>;
  }
  return <span className="rounded-full bg-marble-shadow/60 px-2 py-0.5 text-[10px] font-semibold text-ink-muted etched">Open</span>;
}

function isDashboardActionableTask(task: TasksResponse["tasks"][number]): boolean {
  if (task.status !== "open" && task.status !== "in_progress") return false;
  if (task.event_status === "cancelled" || task.event_status === "regret") return false;
  if (task.event_status === "confirmed" && task.source_rule && STALE_CONFIRMED_TASK_RULES.has(task.source_rule)) return false;
  return true;
}

function SummaryCard({ label, value, status, hint }: { label: string; value: number | string; status: EventStatus; hint: string }) {
  const surface = getEventStatusSurface(status);
  return (
    <div className="carved-card rounded-2xl bg-marble-highlight/50 p-4">
      <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-wider text-ink-muted etched">{label}</span>
        <span className={"h-2.5 w-2.5 shrink-0 rounded-full evt-dot " + surface.dot} aria-hidden="true" />
      </div>
      <div className="text-3xl font-semibold text-ink-primary etched-deep">{value}</div>
      <p className="mt-2 text-[11px] leading-4 text-ink-muted etched">{hint}</p>
    </div>
  );
}
