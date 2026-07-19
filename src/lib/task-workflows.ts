import { getEventPocEditLink } from "./event-edit-form";

export type TaskLike = {
  id: string;
  title: string;
  description: string | null;
  event_id: string | null;
  event_title: string | null;
  organisation_name?: string | null;
  event_status: string | null;
  event_start_date?: string | null;
  event_end_date?: string | null;
  event_venues?: string | null;
  event_owner?: string | null;
  event_overall_completion?: number | null;
  event_form_readiness?: number | null;
  task_type: "automatic" | "manual";
  source_checklist_item_id?: string | null;
  source_module?: "operations" | "accounts" | null;
  source_field_key?: string | null;
  source_label?: string | null;
  source_rule: string | null;
  assignee_name: string | null;
  due_date: string | null;
  priority: "high" | "medium" | "low";
  status: "open" | "in_progress" | "completed" | "cancelled";
};

export type WorkflowFamily = "beforeConfirmation" | "payments" | "operations" | "accounts" | "postEvent" | "manual";
export type TimingGroupKey = "overdue" | "today" | "tomorrow" | "thisWeek" | "later" | "noDate";

export type TaskGroup<T extends string> = {
  key: T;
  label: string;
  tasks: TaskLike[];
};

export type EventCommandCard = {
  event: {
    id: string | null;
    title: string;
    organisationName: string | null;
    status: string | null;
    startDate: string | null;
    endDate: string | null;
    venues: string | null;
    owner: string | null;
    overallCompletion: number | null;
    formReadiness: number | null;
  };
  tasks: TaskLike[];
  workflowGroups: Array<TaskGroup<WorkflowFamily>>;
  openTaskCount: number;
  sortRank: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export const WORKFLOW_LABELS: Record<WorkflowFamily, string> = {
  beforeConfirmation: "Required before confirmation",
  payments: "Payment follow-up",
  operations: "Operational follow-up",
  accounts: "Accounts follow-up",
  postEvent: "Post-event follow-up",
  manual: "Manual follow-up",
};

const CARD_WORKFLOW_ORDER: WorkflowFamily[] = ["beforeConfirmation", "payments", "operations", "accounts", "postEvent", "manual"];
const LANE_WORKFLOW_ORDER: WorkflowFamily[] = ["beforeConfirmation", "payments", "operations", "accounts", "postEvent", "manual"];
const STALE_CONFIRMED_LIFECYCLE_RULES = new Set(["approval_followup", "confirmation_letter"]);

const TIMING_LABELS: Record<TimingGroupKey, string> = {
  overdue: "Overdue",
  today: "Today",
  tomorrow: "Tomorrow",
  thisWeek: "This week",
  later: "Later",
  noDate: "No date",
};

const TIMING_ORDER: TimingGroupKey[] = ["overdue", "today", "tomorrow", "thisWeek", "later", "noDate"];

export function getWorkflowFamily(task: TaskLike): WorkflowFamily {
  if (task.source_rule === "poc_incomplete") return "beforeConfirmation";
  if (task.source_rule?.startsWith("event_form_readiness:")) return "operations";
  const haystack = `${task.source_rule ?? ""} ${task.title}`.toLowerCase();
  if (haystack.includes("approval")) return "beforeConfirmation";
  if (haystack.includes("confirmation") || haystack.includes("letter") || haystack.includes("signed")) return "beforeConfirmation";
  if (haystack.includes("payment") || haystack.includes("installment") || haystack.includes("instalment") || haystack.includes("invoice") || haystack.includes("deposit")) return "payments";
  if (haystack.includes("technical") || haystack.includes("onstage") || haystack.includes("stage") || haystack.includes("noc") || haystack.includes("meeting") || haystack.includes("setup")) return "operations";
  if (haystack.includes("account") || haystack.includes("tax") || haystack.includes("ledger") || haystack.includes("tds") || haystack.includes("refund")) return "accounts";
  if (haystack.includes("feedback") || haystack.includes("post") || haystack.includes("report")) return "postEvent";
  return "manual";
}

export function getTaskIntentLabel(task: TaskLike): string {
  return WORKFLOW_LABELS[getWorkflowFamily(task)];
}

export function isStaleConfirmedLifecycleTask(task: Pick<TaskLike, "event_status" | "source_rule">): boolean {
  return task.event_status === "confirmed" && Boolean(task.source_rule && STALE_CONFIRMED_LIFECYCLE_RULES.has(task.source_rule));
}

export function getEventOperationsLink(eventId: string | null | undefined): string {
  if (!eventId) return "/tasks";
  return `/events/${eventId}?tab=operations`;
}

export function getTaskWorkLink(task: Pick<TaskLike, "event_id" | "source_module" | "source_field_key" | "source_rule" | "title">): string {
  if (!task.event_id) return "/tasks";
  if (task.source_rule?.startsWith("event_form_readiness:")) {
    const section = task.source_rule.slice("event_form_readiness:".length);
    return `/events/${task.event_id}/edit?step=2&section=${encodeURIComponent(section)}`;
  }
  if (task.source_rule === "poc_incomplete" || task.source_field_key === "poc_name") {
    return getEventPocEditLink(task.event_id, task.source_field_key ?? "poc_name");
  }
  const inferred = inferTaskWorkTarget(task);
  const tab = inferred.module;
  const field = inferred.fieldKey ? `&field=${encodeURIComponent(inferred.fieldKey)}` : "";
  return `/events/${task.event_id}?tab=${tab}${field}`;
}

export function buildEventCommandCards(tasks: TaskLike[], todayIso = isoToday()): EventCommandCard[] {
  const openTasks = tasks.filter((task) => task.status !== "completed" && task.status !== "cancelled");
  const byEvent = new Map<string, TaskLike[]>();
  for (const task of openTasks) {
    const key = task.event_id ?? `task:${task.id}`;
    byEvent.set(key, [...(byEvent.get(key) ?? []), task]);
  }

  return Array.from(byEvent.entries())
    .map(([, eventTasks]) => {
      const first = eventTasks[0]!;
      const sortedTasks = [...eventTasks].sort((a, b) => compareTasksForWorkflow(a, b, todayIso, CARD_WORKFLOW_ORDER));
      return {
        event: {
          id: first.event_id,
          title: first.event_title ?? "Unlinked task",
          organisationName: first.organisation_name ?? null,
          status: first.event_status,
          startDate: first.event_start_date ?? null,
          endDate: first.event_end_date ?? null,
          venues: first.event_venues ?? null,
          owner: first.event_owner ?? first.assignee_name ?? null,
          overallCompletion: first.event_overall_completion ?? null,
          formReadiness: first.event_form_readiness ?? null,
        },
        tasks: sortedTasks,
        workflowGroups: groupTasksByWorkflowOrder(sortedTasks, CARD_WORKFLOW_ORDER, todayIso),
        openTaskCount: sortedTasks.length,
        sortRank: getEventSortRank(eventTasks, todayIso),
      };
    })
    .sort((a, b) => {
      if (a.sortRank !== b.sortRank) return a.sortRank - b.sortRank;
      return compareEventTaskDates(a.tasks, b.tasks) || compareNullableDates(a.event.startDate, b.event.startDate) || a.event.title.localeCompare(b.event.title);
    });
}

export function groupTasksByTiming(tasks: TaskLike[], todayIso = isoToday()): Array<TaskGroup<TimingGroupKey>> {
  return buildGroups(tasks, TIMING_ORDER, TIMING_LABELS, (task) => getTimingGroup(task, todayIso), (a, b) => compareTasksByDueDate(a, b, todayIso));
}

export function groupTasksByWorkflowLane(tasks: TaskLike[], todayIso = isoToday()): Array<TaskGroup<WorkflowFamily>> {
  return buildGroups(tasks, LANE_WORKFLOW_ORDER, WORKFLOW_LABELS, getWorkflowFamily, (a, b) => compareTasksByDueDate(a, b, todayIso));
}

export function getTaskUrgencyLabels(task: TaskLike, todayIso = isoToday()): string[] {
  // One chip per independent axis, chosen by precedence.
  // Timing axis: show at most ONE — the strongest active signal. When a task is
  // overdue or due today, the time pressure subsumes priority, so "High priority"
  // is only surfaced when there is no active timing pressure (it then earns its
  // place as the "care even though it's not urgent yet" signal).
  // Ownership axis: "Unassigned" is orthogonal to timing/priority, so it can
  // appear alongside whichever timing chip (if any) is shown.
  const labels: string[] = [];
  const timing = getTimingGroup(task, todayIso);
  if (timing === "overdue") labels.push("Overdue");
  else if (timing === "today") labels.push("Due today");
  else if (task.priority === "high") labels.push("High priority");
  if (!task.assignee_name) labels.push("Unassigned");
  return labels;
}

export function getTimingGroup(task: TaskLike, todayIso = isoToday()): TimingGroupKey {
  if (!task.due_date) return "noDate";
  const diff = daysBetween(todayIso, task.due_date);
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff <= 6) return "thisWeek";
  return "later";
}

export function getDaysOverdue(task: Pick<TaskLike, "due_date">, todayIso = isoToday()): number {
  if (!task.due_date) return 0;
  return Math.max(0, -daysBetween(todayIso, task.due_date));
}

function buildGroups<T extends string>(
  tasks: TaskLike[],
  order: T[],
  labels: Record<T, string>,
  keyFor: (task: TaskLike) => T,
  compare: (a: TaskLike, b: TaskLike) => number
): Array<TaskGroup<T>> {
  const grouped = new Map<T, TaskLike[]>();
  for (const task of tasks) {
    const key = keyFor(task);
    grouped.set(key, [...(grouped.get(key) ?? []), task]);
  }
  return order
    .map((key) => ({ key, label: labels[key], tasks: [...(grouped.get(key) ?? [])].sort(compare) }))
    .filter((group) => group.tasks.length > 0);
}

function groupTasksByWorkflowOrder(tasks: TaskLike[], order: WorkflowFamily[], todayIso: string): Array<TaskGroup<WorkflowFamily>> {
  return buildGroups(tasks, order, WORKFLOW_LABELS, getWorkflowFamily, (a, b) => compareTasksForWorkflow(a, b, todayIso, order));
}

function compareTasksForWorkflow(a: TaskLike, b: TaskLike, todayIso: string, order: WorkflowFamily[]): number {
  const familyDelta = order.indexOf(getWorkflowFamily(a)) - order.indexOf(getWorkflowFamily(b));
  if (familyDelta !== 0) return familyDelta;
  return compareTasksByDueDate(a, b, todayIso);
}

function compareTasksByDueDate(a: TaskLike, b: TaskLike, todayIso: string): number {
  const timingDelta = timingRank(getTimingGroup(a, todayIso)) - timingRank(getTimingGroup(b, todayIso));
  if (timingDelta !== 0) return timingDelta;
  const dateDelta = compareNullableDates(a.due_date, b.due_date);
  if (dateDelta !== 0) return dateDelta;
  const priorityDelta = priorityRank(a.priority) - priorityRank(b.priority);
  if (priorityDelta !== 0) return priorityDelta;
  return a.title.localeCompare(b.title);
}

function getEventSortRank(tasks: TaskLike[], todayIso: string): number {
  if (tasks.some((task) => getTimingGroup(task, todayIso) === "overdue")) return 0;
  if (tasks.some((task) => getTimingGroup(task, todayIso) === "today")) return 1;
  if (tasks.some((task) => getTimingGroup(task, todayIso) === "tomorrow" || getTimingGroup(task, todayIso) === "thisWeek")) return 2;
  if (tasks.some((task) => isSoonBlocker(task, todayIso))) return 3;
  if (tasks.some((task) => task.due_date)) return 4;
  return 5;
}

function isSoonBlocker(task: TaskLike, todayIso: string): boolean {
  if (!task.event_start_date) return false;
  const daysToEvent = daysBetween(todayIso, task.event_start_date);
  if (daysToEvent < 0 || daysToEvent > 14) return false;
  return getWorkflowFamily(task) !== "manual";
}

function inferTaskWorkTarget(task: Pick<TaskLike, "source_module" | "source_field_key" | "source_rule" | "title">): { module: "operations" | "accounts"; fieldKey: string | null } {
  if ((task.source_module === "operations" || task.source_module === "accounts") && task.source_field_key) {
    return { module: task.source_module, fieldKey: task.source_field_key };
  }

  const haystack = `${task.source_rule ?? ""} ${task.title}`.toLowerCase();
  if (task.source_rule === "tds_send_to_accounts" || haystack.includes("tds certificate")) {
    return { module: "accounts", fieldKey: "tds_certificate_sent_to_accounts" };
  }
  if (haystack.includes("account") || haystack.includes("ledger") || haystack.includes("tds") || haystack.includes("tax") || haystack.includes("refund")) {
    return { module: "accounts", fieldKey: "final_file_received" };
  }
  if (haystack.includes("approval")) return { module: "operations", fieldKey: null };
  if (haystack.includes("signed")) return { module: "operations", fieldKey: "confirmation_signed_received" };
  if (haystack.includes("confirmation") || haystack.includes("letter")) return { module: "operations", fieldKey: "confirmation_made" };
  if (haystack.includes("proforma") || haystack.includes("invoice")) return { module: "operations", fieldKey: "proforma_invoice" };
  if (haystack.includes("installment") || haystack.includes("instalment") || haystack.includes("payment") || haystack.includes("deposit")) {
    return { module: "operations", fieldKey: "payment_status" };
  }
  if (haystack.includes("technical") || haystack.includes("meeting")) return { module: "operations", fieldKey: "technical_meeting_date" };
  if (haystack.includes("onstage") || haystack.includes("stage")) return { module: "operations", fieldKey: "onstage_received_from_client" };
  if (haystack.includes("feedback")) return { module: "operations", fieldKey: "feedback_received" };
  if (task.source_rule === "poc_incomplete") return { module: "operations", fieldKey: "poc_name" };
  return { module: "operations", fieldKey: null };
}

function priorityRank(priority: TaskLike["priority"]): number {
  if (priority === "high") return 0;
  if (priority === "medium") return 1;
  return 2;
}

function timingRank(timing: TimingGroupKey): number {
  return TIMING_ORDER.indexOf(timing);
}

function compareEventTaskDates(a: TaskLike[], b: TaskLike[]): number {
  return compareNullableDates(earliestTaskDueDate(a), earliestTaskDueDate(b));
}

function earliestTaskDueDate(tasks: TaskLike[]): string | null {
  return tasks
    .map((task) => task.due_date)
    .filter((dueDate): dueDate is string => Boolean(dueDate))
    .sort()[0] ?? null;
}

function compareNullableDates(a: string | null | undefined, b: string | null | undefined): number {
  if (a && b) return a.localeCompare(b);
  if (a) return -1;
  if (b) return 1;
  return 0;
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((parseIsoDate(toIso).getTime() - parseIsoDate(fromIso).getTime()) / DAY_MS);
}

function parseIsoDate(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}
