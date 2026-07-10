import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { getEventStatusSurface } from "../lib/event-status-surface";
import { apiGet } from "../lib/api";
import { formatDate } from "../lib/use-lookups";
import {
  buildEventCommandCards,
  getEventOperationsLink,
  groupTasksByTiming,
  groupTasksByWorkflowLane,
  getTaskIntentLabel,
  getTaskUrgencyLabels,
  getTaskWorkLink,
  getWorkflowFamily,
  isStaleConfirmedLifecycleTask,
  WORKFLOW_LABELS,
  type TaskLike,
  type WorkflowFamily,
} from "../lib/task-workflows";
import type { EventStatus } from "../../worker/lib/state-machine";

type TaskRow = TaskLike;
type TaskView = "cards" | "queue" | "lanes";

const VIEW_LABELS: Record<TaskView, string> = {
  cards: "By event",
  lanes: "Work lanes",
  queue: "Due date",
};

export function TasksPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = parseView(searchParams.get("view"));
  const [mine, setMine] = useState(false);
  const today = useMemo(() => isoTodayInIndia(), []);

  const { data, isLoading, error } = useQuery({
    queryKey: ["tasks", "active", mine],
    queryFn: () => apiGet<{ tasks: TaskRow[] }>(`/tasks?status=all&mine=${mine ? "1" : "0"}`),
  });

  const tasks = useMemo(() => {
    const rows = data?.tasks ?? [];
    return rows.filter((task) => !isStaleConfirmedLifecycleTask(task) && (task.status === "open" || task.status === "in_progress"));
  }, [data?.tasks]);

  function selectView(next: TaskView) {
    const params = new URLSearchParams(searchParams);
    params.set("view", next);
    setSearchParams(params, { replace: true });
  }

  return (
    <div>
      <PageHeader title="Tasks" subtitle="Work to do across events" />

      <div className="carved-header mb-4 rounded-2xl bg-marble-highlight/60 p-3 backdrop-blur-sm">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-full bg-marble-shadow/40 p-1">
            {(["cards", "lanes", "queue"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => selectView(option)}
                className={
                  "rounded-full px-4 py-1.5 text-xs font-semibold etched " +
                  (view === option ? "carved-btn-sage bg-sage-btn text-sage-text" : "text-ink-muted hover:text-ink-secondary")
                }
              >
                {VIEW_LABELS[option]}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 md:ml-auto">
            <label className="inline-flex items-center gap-2 px-2 text-xs font-medium text-ink-secondary etched">
              <input type="checkbox" checked={mine} onChange={(ev) => setMine(ev.target.checked)} className="h-4 w-4 accent-sage" />
              My tasks
            </label>
          </div>
        </div>
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-lg bg-status-cancelled/10 px-4 py-2 text-sm text-status-cancelled">
          {(error as Error).message}
        </div>
      )}

      {isLoading ? (
        <div className="carved-card rounded-2xl bg-marble-highlight/50 p-6 text-sm text-ink-muted etched">Loading...</div>
      ) : tasks.length === 0 ? (
        <div className="carved-card rounded-2xl bg-marble-highlight/50 p-6 text-sm text-ink-muted etched">No tasks in this view.</div>
      ) : view === "cards" ? (
        <EventCommandCards tasks={tasks} today={today} />
      ) : view === "queue" ? (
        <TodaysWorkQueue tasks={tasks} today={today} />
      ) : (
        <WorkflowLanes tasks={tasks} today={today} />
      )}
    </div>
  );
}

function EventCommandCards({ tasks, today }: TaskViewProps) {
  const cards = buildEventCommandCards(tasks, today);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  function toggleCard(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {cards.map((card) => {
        const surface = getEventStatusSurface(card.event.status);
        const cardKey = card.event.id ?? card.event.title;
        const isExpanded = expanded.has(cardKey);
        const nextTask = card.tasks[0];
        const urgentLabels = card.tasks.flatMap((task) => getTaskUrgencyLabels(task, today));
        const uniqueUrgentLabels = Array.from(new Set(urgentLabels)).slice(0, 3);
        return (
          <article key={card.event.id ?? card.event.title} className={`carved-card overflow-hidden rounded-2xl border bg-marble-highlight/70 ${surface.card}`}>
            <div className={`border-l-4 ${surface.border} px-5 py-4`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    {card.event.status && <StatusBadge status={card.event.status as EventStatus} />}
                    <span className="rounded-full bg-marble-highlight/70 px-2 py-0.5 text-[11px] font-semibold text-ink-secondary ring-1 ring-ink-muted/10 etched">
                      {card.openTaskCount} open {card.openTaskCount === 1 ? "task" : "tasks"}
                    </span>
                  </div>
                  <h3 className="truncate text-base font-semibold text-ink-primary etched-deep">
                    {card.event.id ? <Link to={getEventOperationsLink(card.event.id)} className="hover:text-sage-text">{card.event.title}</Link> : card.event.title}
                  </h3>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-muted etched">
                    {card.event.startDate && <span>{formatEventDate(card.event.startDate, card.event.endDate)}</span>}
                    {card.event.venues && <span>{card.event.venues}</span>}
                    {card.event.owner && <span>{card.event.owner}</span>}
                  </div>
                  {nextTask && (
                    <div className="mt-3 rounded-lg bg-marble-highlight/70 px-3 py-2 ring-1 ring-ink-muted/10">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1 rounded-full bg-sage-btn px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-sage-text etched" aria-label="Recommended next task for this event">
                          Do this next
                          <span aria-hidden="true">→</span>
                        </span>
                        {uniqueUrgentLabels.map((label) => <span key={label} className={urgencyClass(label)}>{label}</span>)}
                      </div>
                      <Link to={getTaskWorkLink(nextTask)} className="mt-1 block truncate text-xs font-semibold text-ink-primary etched-deep hover:text-sage-text">
                        {nextTask.title}
                      </Link>
                      <div className="mt-0.5 text-[11px] text-ink-muted etched">
                        {workflowLabel(getWorkflowFamily(nextTask))}
                      </div>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => toggleCard(cardKey)}
                  aria-expanded={isExpanded}
                  className="carved-btn shrink-0 rounded-full bg-neutral-btn px-3 py-1.5 text-xs font-semibold text-ink-secondary etched"
                >
                  {isExpanded ? "Collapse" : "Expand"}
                </button>
              </div>
            </div>
            {isExpanded && (
              <div className="space-y-4 px-5 pb-5">
                {card.workflowGroups.map((group) => (
                  <section key={group.key}>
                    <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-ink-dayHeader etched">{workflowLabel(group.key)}</h4>
                    <div className="space-y-2">
                      {group.tasks.map((task) => <TaskMiniCard key={task.id} task={task} today={today} />)}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

function TodaysWorkQueue({ tasks, today }: TaskViewProps) {
  const groups = groupTasksByTiming(tasks, today);
  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <section key={group.key} className="carved-card rounded-2xl bg-marble-highlight/55 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink-primary etched-deep">{group.label}</h3>
            <span className="text-xs text-ink-muted etched">{group.tasks.length}</span>
          </div>
          <div className="space-y-2">
            {group.tasks.map((task) => <TaskExecutionRow key={task.id} task={task} today={today} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

function WorkflowLanes({ tasks, today }: TaskViewProps) {
  const lanes = groupTasksByWorkflowLane(tasks, today);
  return (
    <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
      {lanes.map((lane) => (
        <section key={lane.key} className="carved-card flex min-h-[180px] flex-col rounded-2xl bg-marble-highlight/55 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink-primary etched-deep">{lane.label}</h3>
            <span className="rounded-full bg-marble-shadow/50 px-2 py-0.5 text-[11px] font-medium text-ink-muted etched">{lane.tasks.length}</span>
          </div>
          <div className="space-y-2">
            {lane.tasks.map((task) => <LaneTaskCard key={task.id} task={task} today={today} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

type TaskViewProps = {
  tasks: TaskRow[];
  today: string;
};

function TaskMiniCard({ task, today }: TaskCardProps) {
  // Inside an event card the show date already heads the card, so the
  // per-task due date would just repeat it.
  return (
    <div className="rounded-lg bg-marble-highlight/75 px-3 py-2 ring-1 ring-ink-muted/10">
      <TaskCardMain task={task} today={today} compact={false} showDueDate={false} />
    </div>
  );
}

function TaskExecutionRow({ task, today }: TaskCardProps) {
  const surface = getEventStatusSurface(task.event_status);
  return (
    <div className={`grid gap-3 rounded-xl px-4 py-3 md:grid-cols-[1fr_auto] md:items-center ${surface.row}`}>
      <TaskCardMain task={task} today={today} compact={false} showEvent />
      <OpenWorkLink task={task} />
    </div>
  );
}

function LaneTaskCard({ task, today }: TaskCardProps) {
  const surface = getEventStatusSurface(task.event_status);
  return (
    <div className={`rounded-lg px-3 py-2 ${surface.row}`}>
      <TaskCardMain task={task} today={today} compact showEvent />
      <div className="mt-2 flex justify-end">
        <OpenWorkLink task={task} compact />
      </div>
    </div>
  );
}

type TaskCardProps = {
  task: TaskRow;
  today: string;
};

function TaskCardMain({ task, today, compact, showEvent = false, showDueDate = true }: { task: TaskRow; today: string; compact: boolean; showEvent?: boolean; showDueDate?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className={(compact ? "text-xs" : "text-sm") + " font-semibold text-ink-primary etched-deep"}>{task.title}</h4>
        <span className={taskStatusClass(task.status)}>{taskStatusLabel(task.status)}</span>
        {getTaskUrgencyLabels(task, today).map((label) => <span key={label} className={urgencyClass(label)}>{label}</span>)}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-muted etched">
        <span>{task.task_type === "automatic" ? "System-generated" : "Manual"}</span>
        <span>{getTaskIntentLabel(task)}</span>
        {showDueDate && task.due_date && <span>Due {formatDate(task.due_date)}</span>}
        {task.assignee_name && <span>{task.assignee_name}</span>}
        {showEvent && task.event_id && task.event_title && <Link to={getTaskWorkLink(task)} className="text-sage-text underline">{task.event_title}</Link>}
      </div>
      {!compact && task.description && <p className="mt-2 text-xs text-ink-secondary etched">{task.description}</p>}
    </div>
  );
}

function OpenWorkLink({ task, compact = false }: { task: TaskRow; compact?: boolean }) {
  if (task.status === "completed" || task.status === "cancelled") return null;
  return (
    <Link
      to={getTaskWorkLink(task)}
      className={"carved-btn-sage rounded-full bg-sage-btn px-3 py-1.5 text-xs font-semibold text-sage-text etched " + (compact ? "" : "mt-3 md:mt-0")}
    >
      Open work
    </Link>
  );
}

function parseView(value: string | null): TaskView {
  if (value === "cards" || value === "queue" || value === "lanes") return value;
  return "cards";
}

function workflowLabel(family: WorkflowFamily): string {
  return WORKFLOW_LABELS[family];
}

function formatEventDate(start: string, end: string | null): string {
  if (!end || end === start) return formatDate(start);
  return `${formatDate(start)} - ${formatDate(end)}`;
}

function taskStatusClass(status: string): string {
  if (status === "completed") return "rounded-full bg-sage/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-sage-text";
  if (status === "cancelled") return "rounded-full bg-status-cancelled/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-status-cancelled";
  if (status === "in_progress") return "rounded-full bg-status-awaitingApproval/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-status-awaitingApproval";
  return "rounded-full bg-marble-shadow/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-muted";
}

function taskStatusLabel(status: string): string {
  if (status === "open") return "Open";
  if (status === "in_progress") return "In progress";
  if (status === "completed") return "Done";
  if (status === "cancelled") return "Cancelled";
  return status.replace(/_/g, " ");
}

function urgencyClass(label: string): string {
  if (label === "Overdue") return "rounded-full bg-status-cancelled/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-status-cancelled";
  if (label === "Due today") return "rounded-full bg-status-awaitingApproval/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-status-awaitingApproval";
  if (label === "High priority") return "rounded-full bg-status-tentative/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-status-tentative";
  return "rounded-full bg-marble-shadow/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-muted";
}

function isoTodayInIndia(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((part) => part.type === "year")?.value ?? "1970";
  const m = parts.find((part) => part.type === "month")?.value ?? "01";
  const d = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}
