import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { apiGet, apiPatch, apiPost } from "../lib/api";
import { formatDate, formatDateTime, formatDuration } from "../lib/use-lookups";
import { useAuth } from "../lib/auth";
import { can } from "../lib/can";
import { STATUS_LABELS, requiresOverride } from "../../worker/lib/state-machine";
import type { EventStatus } from "../../worker/lib/state-machine";

type DetailResponse = {
  event: Record<string, unknown> & {
    id: string;
    title: string;
    status: EventStatus;
    event_type: string | null;
    event_start_date: string | null;
    event_end_date: string | null;
    organisation_name: string | null;
    event_owner: string | null;
    description: string | null;
    notes: string | null;
    approval_status: string | null;
    confirmation_status: string | null;
    overall_completion: number | null;
    ops_completion: number | null;
    accounts_completion: number | null;
  };
  venue_bookings: Array<Record<string, unknown> & { schedule_entries: unknown[] }>;
  activity: Array<Record<string, unknown>>;
};

type ChecklistItem = {
  id: string;
  module: "operations" | "accounts";
  section: string;
  field_key: string;
  label: string;
  status: string;
  value: string | null;
  due_date: string | null;
  field_type: string;
  options: string[] | null;
  is_computed: number;
};

type LifecycleAction = {
  status: EventStatus;
  label: string;
  allowed: boolean;
  recommended: boolean;
  blockers: string[];
};

type ChecklistResponse = {
  checklist: Record<"operations" | "accounts", Record<string, ChecklistItem[]>>;
  lifecycle: {
    current: EventStatus;
    canConfirm: boolean;
    blockers: string[];
    nextAction: LifecycleAction | null;
    actions: LifecycleAction[];
  };
};

type EventPageFreshState = {
  detail: DetailResponse;
  checklist: ChecklistResponse;
  tasks: { tasks: Array<Record<string, unknown>> };
};

type ConflictsResponse = {
  conflicts: Array<Record<string, unknown> & { level: string; venue: string; title: string; status: string; activity_date: string; activity_type: string }>;
};

const ACTIVITY_LABELS: Record<string, string> = {
  created: "Event created",
  updated: "Event updated",
  status_changed: "Status changed",
  venue_added: "Venue added",
  venue_removed: "Venue removed",
  confirmed: "Event confirmed",
  completed: "Event completed",
  closed: "Event closed",
  note_added: "Note added",
  task_created: "Task created",
  task_completed: "Task completed",
  checklist_updated: "Checklist updated",
};

const BLOCKER_TARGETS: Record<string, { tab: "operations" | "accounts"; fieldKey: string; label: string }> = {
  "Confirmation letter must be made.": {
    tab: "operations",
    fieldKey: "confirmation_made",
    label: "Confirmation Letter Made",
  },
  "Confirmation letter must be couriered.": {
    tab: "operations",
    fieldKey: "confirmation_couriered",
    label: "Confirmation Letter Couriered",
  },
  "Signed confirmation must be received.": {
    tab: "operations",
    fieldKey: "confirmation_signed_received",
    label: "Signed Copy Received",
  },
  "VFH approval must be received or approved.": {
    tab: "operations",
    fieldKey: "approval_received_on",
    label: "Approval Received On",
  },
  "VFH approval must be received before marking the event approved.": {
    tab: "operations",
    fieldKey: "approval_received_on",
    label: "Approval Received On",
  },
};

type EventDetailTab = "overview" | "operations" | "accounts" | "tasks" | "venues" | "conflicts" | "activity";

export function EventDetailPage() {
  const { id = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<EventDetailTab>(() => parseEventDetailTab(searchParams.get("tab")) ?? "overview");
  const [statusModal, setStatusModal] = useState<EventStatus | null>(null);
  const [reason, setReason] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [focusedFieldKey, setFocusedFieldKey] = useState<string | null>(() => searchParams.get("field"));

  const { data, isLoading } = useQuery({
    queryKey: ["event", id],
    queryFn: () => apiGet<DetailResponse>(`/events/${id}`),
  });

  const { data: checklistData } = useQuery({
    queryKey: ["event", id, "checklist"],
    queryFn: () => apiGet<ChecklistResponse>(`/events/${id}/checklist`),
  });

  const { data: taskData } = useQuery({
    queryKey: ["tasks", id],
    queryFn: () => apiGet<{ tasks: Array<Record<string, unknown>> }>(`/tasks?event=${id}&status=all`),
  });

  const { data: conflictsData } = useQuery({
    queryKey: ["event", id, "conflicts"],
    queryFn: () => apiGet<ConflictsResponse>(`/events/${id}/conflicts`),
  });

  useEffect(() => {
    const nextTab = parseEventDetailTab(searchParams.get("tab"));
    const nextField = searchParams.get("field");
    if (nextTab && nextTab !== tab) setTab(nextTab);
    setFocusedFieldKey(nextField);
  }, [searchParams, tab]);

  useEffect(() => {
    if (!focusedFieldKey) return;
    const frame = window.requestAnimationFrame(() => {
      const el = document.getElementById(`checklist-${focusedFieldKey}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusedFieldKey, tab, checklistData]);

  async function fetchFreshEventState(): Promise<EventPageFreshState> {
    const [detail, checklist, tasks] = await Promise.all([
      apiGet<DetailResponse>(`/events/${id}`),
      apiGet<ChecklistResponse>(`/events/${id}/checklist`),
      apiGet<{ tasks: Array<Record<string, unknown>> }>(`/tasks?event=${id}&status=all`),
    ]);
    return { detail, checklist, tasks };
  }

  function applyFreshEventState(fresh: EventPageFreshState) {
    qc.setQueryData(["event", id], fresh.detail);
    qc.setQueryData(["event", id, "checklist"], fresh.checklist);
    qc.setQueryData(["tasks", id], fresh.tasks);
    qc.invalidateQueries({ queryKey: ["tasks"], exact: false });
    qc.invalidateQueries({ queryKey: ["calendar-lifecycle"], exact: false });
  }

  const transition = useMutation({
    mutationFn: async (args: { to: EventStatus; reason: string }) => {
      await apiPost(`/events/${id}/status`, { to_status: args.to, reason: args.reason });
      return fetchFreshEventState();
    },
    onSuccess: (fresh) => {
      setStatusModal(null);
      setReason("");
      applyFreshEventState(fresh);
    },
  });

  const checklistUpdate = useMutation({
    mutationFn: async (args: { item: ChecklistItem; value: string | null; status?: string; correctionReason?: string | null }) => {
      await apiPatch(`/events/${id}/checklist/${args.item.id}`, { value: args.value, status: args.status, correction_reason: args.correctionReason });
      return fetchFreshEventState();
    },
    onSuccess: (fresh) => {
      applyFreshEventState(fresh);
    },
  });

  const createTask = useMutation({
    mutationFn: async (title: string) => apiPost("/tasks", { title, event_id: id, priority: "medium" }),
    onSuccess: () => {
      setTaskTitle("");
      qc.invalidateQueries({ queryKey: ["tasks", id] });
      qc.invalidateQueries({ queryKey: ["event", id] });
    },
  });

  if (isLoading) return <div className="text-sm text-ink-muted">Loading...</div>;
  const e = data?.event;
  if (!e) return <div className="text-sm text-ink-muted">Event not found.</div>;

  const canChangeStatus = can(user?.role ?? "viewer", "event.status.change");
  const canUpdateChecklist = can(user?.role ?? "viewer", "checklist.update");
  const actions = checklistData?.lifecycle.actions ?? [];
  const pendingTasks = (taskData?.tasks ?? []).filter((task) => task.status !== "completed" && task.status !== "cancelled");

  function focusChecklistField(target: { tab: "operations" | "accounts"; fieldKey: string }) {
    selectTab(target.tab, target.fieldKey);
  }

  function selectTab(next: EventDetailTab, fieldKey: string | null = null) {
    setTab(next);
    setFocusedFieldKey(fieldKey);
    const params = new URLSearchParams(searchParams);
    if (next === "overview") params.delete("tab");
    else params.set("tab", next);
    if (fieldKey) params.set("field", fieldKey);
    else params.delete("field");
    setSearchParams(params, { replace: true });
  }

  return (
    <div>
      <PageHeader
        title={e.organisation_name ?? "—"}
        subtitle={e.title}
        actions={
          <>
            <StatusBadge status={e.status} size="md" />
            {can(user?.role ?? "viewer", "event.edit") && (
              <Link to={`/events/${id}/edit`} className="carved-btn rounded-full bg-neutral-btn px-4 py-2 text-sm font-medium text-ink-secondary etched">
                Edit
              </Link>
            )}
          </>
        }
      />

      <div className="carved-card mb-5 grid grid-cols-2 gap-4 rounded-2xl bg-marble-highlight/50 p-5 md:grid-cols-5">
        <SummaryItem label="Type" value={e.event_type ?? "-"} />
        <SummaryItem label="Dates" value={e.event_start_date ? `${formatDate(e.event_start_date)}${e.event_end_date && e.event_end_date !== e.event_start_date ? " to " + formatDate(e.event_end_date) : ""}` : "-"} />
        <SummaryItem label="Owner" value={e.event_owner ?? "-"} />
        <SummaryItem label="Approval" value={prettyState(e.approval_status)} />
        <SummaryItem label="Signed confirmation" value={prettyState(e.confirmation_status)} />
      </div>

      <LifecyclePanel
        event={e}
        actions={actions}
        nextAction={checklistData?.lifecycle.nextAction ?? null}
        blockers={checklistData?.lifecycle.blockers ?? []}
        canChangeStatus={canChangeStatus}
        canShowStatusActions={tab === "operations"}
        onOpenBlocker={focusChecklistField}
        onChoose={(status) => {
          setStatusModal(status);
          setReason("");
        }}
      />

      {transition.error && (
        <div role="alert" className="mb-4 rounded-lg bg-status-cancelled/10 px-4 py-2 text-sm text-status-cancelled">
          {(transition.error as Error).message}
        </div>
      )}
      {checklistUpdate.error && (
        <div role="alert" className="mb-4 rounded-lg bg-status-cancelled/10 px-4 py-2 text-sm text-status-cancelled">
          {(checklistUpdate.error as Error).message}
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-1">
        {([
          ["overview", "Overview"],
          ["operations", "Operations"],
          ["accounts", "Accounts"],
          ["tasks", `Tasks${pendingTasks.length ? ` (${pendingTasks.length})` : ""}`],
          ["venues", `Venues & Schedule${data?.venue_bookings.length ? ` (${data.venue_bookings.length})` : ""}`],
          ["conflicts", `Conflicts${conflictsData?.conflicts.length ? ` (${conflictsData.conflicts.length})` : ""}`],
          ["activity", "Activity"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => selectTab(key)}
            className={
              "rounded-full px-4 py-1.5 text-sm font-medium etched " +
              (tab === key ? "bg-sage-btn text-sage-text carved-btn-sage" : "text-ink-secondary hover:bg-marble-shadow/40")
            }
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="grid gap-6 md:grid-cols-2">
          <section className="carved-card rounded-2xl bg-marble-highlight/50 p-5">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-sage etched">Description</h3>
            <p className="whitespace-pre-wrap text-sm text-ink-secondary etched">{e.description || e.notes || "No description provided."}</p>
          </section>
          <section className="carved-card rounded-2xl bg-marble-highlight/50 p-5">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-sage etched">Completion</h3>
            <div className="space-y-3">
              <ProgressBar label="Operations" value={e.ops_completion} />
              <ProgressBar label="Accounts" value={e.accounts_completion} />
              <ProgressBar label="Overall" value={e.overall_completion} emphasis />
            </div>
          </section>
        </div>
      )}

      {tab === "operations" && (
        <ChecklistModuleView
          sections={checklistData?.checklist.operations ?? {}}
          canEdit={canUpdateChecklist}
          isSaving={checklistUpdate.isPending}
          focusedFieldKey={focusedFieldKey}
          onUpdate={(item, value, status, correctionReason) => checklistUpdate.mutate({ item, value, status, correctionReason })}
        />
      )}

      {tab === "accounts" && (
        <ChecklistModuleView
          sections={checklistData?.checklist.accounts ?? {}}
          canEdit={canUpdateChecklist}
          isSaving={checklistUpdate.isPending}
          focusedFieldKey={focusedFieldKey}
          onUpdate={(item, value, status, correctionReason) => checklistUpdate.mutate({ item, value, status, correctionReason })}
        />
      )}

      {tab === "tasks" && (
        <section className="carved-card rounded-2xl bg-marble-highlight/50 p-5">
          <div className="mb-4 flex flex-col gap-2 md:flex-row">
            <input
              value={taskTitle}
              onChange={(ev) => setTaskTitle(ev.target.value)}
              className="carved min-w-0 flex-1 rounded-xl bg-marble-shadow/40 px-4 py-2.5 text-sm text-ink-primary focus:outline-none"
              placeholder="Add a manual follow-up task"
            />
            <button
              type="button"
              disabled={!taskTitle.trim() || createTask.isPending}
              onClick={() => createTask.mutate(taskTitle.trim())}
              className="carved-btn-sage rounded-full bg-sage-btn px-5 py-2 text-sm font-semibold text-sage-text etched disabled:opacity-60"
            >
              {createTask.isPending ? "Adding..." : "Add task"}
            </button>
          </div>
          <TaskList tasks={taskData?.tasks ?? []} />
        </section>
      )}

      {tab === "venues" && <VenuesView bookings={data?.venue_bookings ?? []} />}
      {tab === "conflicts" && <ConflictsView conflicts={conflictsData?.conflicts ?? []} />}
      {tab === "activity" && <ActivityView activity={data?.activity ?? []} />}

      {statusModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-primary/20 backdrop-blur-sm" onClick={() => setStatusModal(null)}>
          <div className="carved-card w-full max-w-md rounded-2xl bg-marble-highlight p-6" onClick={(ev) => ev.stopPropagation()}>
            <h3 className="mb-2 text-sm font-semibold text-ink-primary etched-deep">Change status to {statusLabel(statusModal)}</h3>
            <p className="mb-4 text-xs text-ink-muted etched">
              {requiresReason(e.status, statusModal) ? "Please record the reason for this lifecycle decision." : "Optional note for this lifecycle decision."}
            </p>
            <textarea
              value={reason}
              onChange={(ev) => setReason(ev.target.value)}
              placeholder="Reason / note..."
              className="carved mb-4 w-full rounded-xl bg-marble-shadow/40 px-4 py-2.5 text-sm text-ink-primary focus:outline-none"
              rows={3}
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setStatusModal(null)} className="carved-btn rounded-full bg-neutral-btn px-4 py-2 text-sm font-medium text-ink-secondary etched">Cancel</button>
              <button
                type="button"
                disabled={transition.isPending || (requiresReason(e.status, statusModal) && !reason.trim())}
                onClick={() => transition.mutate({ to: statusModal, reason })}
                className="carved-btn-sage rounded-full bg-sage-btn px-4 py-2 text-sm font-semibold text-sage-text etched disabled:opacity-60"
              >
                {transition.isPending ? "Saving..." : "Confirm decision"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LifecyclePanel({
  event,
  actions,
  nextAction,
  blockers,
  canChangeStatus,
  canShowStatusActions,
  onOpenBlocker,
  onChoose,
}: {
  event: DetailResponse["event"];
  actions: LifecycleAction[];
  nextAction: LifecycleAction | null;
  blockers: string[];
  canChangeStatus: boolean;
  canShowStatusActions: boolean;
  onOpenBlocker: (target: { tab: "operations" | "accounts"; fieldKey: string }) => void;
  onChoose: (status: EventStatus) => void;
}) {
  const forwardStatuses: EventStatus[] = ["approved", "confirmed"];
  const visibleActions = useMemo(() => {
    const preferred: EventStatus[] = ["approved", "confirmed", "tentative", "regret", "cancelled"];
    return [...actions].sort((a, b) => preferred.indexOf(a.status) - preferred.indexOf(b.status));
  }, [actions]);
  const closeOutActions = visibleActions.filter((action) => action.status === "regret" || action.status === "cancelled");
  const blockedForwardAction = nextAction ? null : visibleActions.find((action) => forwardStatuses.includes(action.status) && action.blockers.length > 0) ?? null;
  const visibleBlockers = blockedForwardAction?.blockers ?? blockers;

  return (
    <section className="carved-card mb-5 rounded-2xl bg-marble-highlight/50 p-5">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-sage etched">Lifecycle</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={event.status} />
            {nextAction ? (
              <span className="rounded-full bg-sage/10 px-3 py-1 text-xs font-medium text-sage-text etched">Next step: {milestoneLabel(nextAction.status)}</span>
            ) : blockedForwardAction ? (
              <span className="rounded-full bg-status-awaitingApproval/10 px-3 py-1 text-xs font-medium text-status-awaitingApproval etched">Next step blocked</span>
            ) : (
              <span className="rounded-full bg-marble-shadow/50 px-3 py-1 text-xs text-ink-muted etched">No next lifecycle action</span>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs md:min-w-80">
          <SummaryItem label="Approval" value={prettyState(event.approval_status)} />
          <SummaryItem label="Confirmation" value={prettyState(event.confirmation_status)} />
        </div>
      </div>

      <LifecycleTrack
        current={event.status}
        eventType={event.event_type}
      />

      <div className="rounded-2xl bg-marble-shadow/20 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-muted etched">Next milestone</h3>
            <p className="mt-1 text-sm font-medium text-ink-primary etched-deep">
              {nextAction
                ? milestoneLabel(nextAction.status)
                : blockedForwardAction
                  ? `${milestoneLabel(blockedForwardAction.status)} is blocked`
                  : "No forward milestone available"}
            </p>
          </div>
          {canChangeStatus && canShowStatusActions && nextAction && (
            <button
              type="button"
              onClick={() => onChoose(nextAction.status)}
              className="carved-btn-sage rounded-full bg-sage-btn px-4 py-2 text-sm font-semibold text-sage-text etched"
            >
              Advance to {milestoneLabel(nextAction.status)}
            </button>
          )}
          {canChangeStatus && !canShowStatusActions && (nextAction || closeOutActions.length > 0) && (
            <span className="rounded-full bg-marble-shadow/50 px-3 py-1.5 text-xs font-medium text-ink-muted etched">
              Open Operations to change lifecycle status
            </span>
          )}
        </div>

        {blockedForwardAction && visibleBlockers.length > 0 && (
          <div className="mt-3 rounded-xl bg-status-awaitingApproval/10 px-4 py-3 text-xs text-status-awaitingApproval etched">
            {visibleBlockers.map((b) => {
              const target = BLOCKER_TARGETS[b];
              return (
                <div key={b} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>{b}</span>
                  {target && (
                    <button
                      type="button"
                      onClick={() => onOpenBlocker(target)}
                      className="font-semibold text-sage-text underline decoration-sage/40 underline-offset-2 hover:decoration-sage"
                    >
                      Go to {target.label}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {canChangeStatus && canShowStatusActions && closeOutActions.length > 0 && (
          <div className="mt-4 border-t border-ink-muted/10 pt-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted etched">Close out</h3>
            <div className="flex flex-wrap gap-2">
              {closeOutActions.map((action) => (
                <button
                  key={action.status}
                  type="button"
                  disabled={!action.allowed}
                  title={action.blockers.join(" ")}
                  onClick={() => onChoose(action.status)}
                  className={
                    "rounded-full px-3 py-1.5 text-xs font-medium etched disabled:cursor-not-allowed disabled:opacity-50 " +
                    (action.status === "cancelled"
                      ? "carved-btn bg-status-cancelled/10 text-status-cancelled"
                      : "carved-btn bg-status-regret/10 text-status-regret")
                  }
                >
                  {lifecycleActionLabel(action.status)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function ChecklistModuleView({
  sections,
  canEdit,
  isSaving,
  focusedFieldKey,
  onUpdate,
}: {
  sections: Record<string, ChecklistItem[]>;
  canEdit: boolean;
  isSaving: boolean;
  focusedFieldKey: string | null;
  onUpdate: (item: ChecklistItem, value: string | null, status?: string, correctionReason?: string | null) => void;
}) {
  const entries = Object.entries(sections);
  if (!entries.length) {
    return <div className="carved-card rounded-2xl bg-marble-highlight/50 p-5 text-sm text-ink-muted etched">No checklist items yet.</div>;
  }
  return (
    <div className="space-y-4">
      {entries.map(([section, items]) => (
        <section key={section} className="carved-card rounded-2xl bg-marble-highlight/50 p-5">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-sage etched">{section}</h3>
          <div className="grid gap-3 md:grid-cols-2">
            {items.map((item) => (
              <ChecklistField key={item.id} item={item} focused={focusedFieldKey === item.field_key} canEdit={canEdit && !isSaving} onUpdate={onUpdate} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ChecklistField({ item, focused, canEdit, onUpdate }: { item: ChecklistItem; focused: boolean; canEdit: boolean; onUpdate: (item: ChecklistItem, value: string | null, status?: string, correctionReason?: string | null) => void }) {
  const disabled = !canEdit || Boolean(item.is_computed);
  const baseClass = "carved mt-1 w-full rounded-xl bg-marble-shadow/40 px-3 py-2 text-sm text-ink-primary focus:outline-none disabled:opacity-60";
  const canManuallyToggleStatus = item.field_type !== "dropdown" && item.field_type !== "status";

  return (
    <label
      id={`checklist-${item.field_key}`}
      className={
        "block rounded-xl bg-marble-shadow/20 p-3 transition-shadow " +
        (focused ? "ring-2 ring-sage/70 ring-offset-2 ring-offset-marble-highlight" : "")
      }
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-ink-secondary etched">{item.label}</span>
        <span className={"rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider " + statusClass(item.status)}>
          {item.status.replace(/_/g, " ")}
        </span>
      </span>
      {item.field_type === "dropdown" || item.field_type === "status" ? (
        <select
          disabled={disabled}
          defaultValue={item.value ?? ""}
          onChange={(ev) => onUpdate(item, ev.target.value || null)}
          className={baseClass}
        >
          <option value="">Select</option>
          {(item.options ?? []).map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      ) : item.field_type === "textarea" ? (
        <textarea
          disabled={disabled}
          defaultValue={item.value ?? ""}
          onBlur={(ev) => ev.currentTarget.value !== (item.value ?? "") && onUpdate(item, ev.currentTarget.value || null)}
          rows={2}
          className={baseClass}
        />
      ) : item.field_type === "checkbox" ? (
        <input
          disabled={disabled}
          type="checkbox"
          defaultChecked={item.value === "true"}
          onChange={(ev) => onUpdate(item, ev.target.checked ? "true" : null, ev.target.checked ? "completed" : "not_started")}
          className="mt-3 h-4 w-4 accent-sage"
        />
      ) : (
        <input
          disabled={disabled}
          type={item.field_type === "date" ? "date" : item.field_type === "number" ? "number" : "text"}
          defaultValue={item.value ?? ""}
          onBlur={(ev) => {
            const next = ev.currentTarget.value || null;
            if (next === (item.value ?? null)) return;
            if (item.field_type === "date" && item.value && next) {
              const correctionReason = window.prompt("Reason for changing this date?");
              if (!correctionReason?.trim()) {
                ev.currentTarget.value = item.value;
                return;
              }
              onUpdate(item, next, undefined, correctionReason);
              return;
            }
            onUpdate(item, next);
          }}
          className={baseClass}
        />
      )}
      {!item.is_computed && canEdit && canManuallyToggleStatus && (item.status === "in_progress" || item.status === "completed") && (
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={() => onUpdate(item, item.value, item.status === "completed" ? "in_progress" : "completed")}
            className="carved-btn rounded-full bg-neutral-btn px-3 py-1 text-[11px] font-medium text-ink-secondary etched"
          >
            {item.status === "completed" ? "Reopen" : "Mark complete"}
          </button>
        </div>
      )}
    </label>
  );
}

function TaskList({ tasks }: { tasks: Array<Record<string, unknown>> }) {
  if (!tasks.length) return <p className="text-sm text-ink-muted etched">No tasks for this event.</p>;
  return (
    <div className="space-y-2">
      {tasks.map((task) => (
        <div key={task.id as string} className="rounded-xl bg-marble-shadow/30 px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium text-ink-primary etched-deep">{task.title as string}</span>
            <span className={statusClass(String(task.status))}>{taskStatusLabel(String(task.status))}</span>
          </div>
          <div className="mt-1 text-xs text-ink-muted etched">
            {task.task_type === "automatic" ? "Automatic" : "Manual"}
            {task.due_date ? ` · Target ${formatDate(task.due_date as string)}` : ""}
            {task.assignee_name ? ` · ${task.assignee_name as string}` : ""}
          </div>
        </div>
      ))}
    </div>
  );
}

function parseEventDetailTab(value: string | null): EventDetailTab | null {
  if (value === "operations" || value === "accounts" || value === "tasks" || value === "venues" || value === "conflicts" || value === "activity" || value === "overview") {
    return value;
  }
  return null;
}

function VenuesView({ bookings }: { bookings: DetailResponse["venue_bookings"] }) {
  return (
    <div className="space-y-4">
      {bookings.map((vb, idx) => (
        <section key={vb.id as string} className="carved-card rounded-2xl bg-marble-highlight/50 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink-primary etched-deep">
              <span className="text-sage">Venue {idx + 1}:</span> {vb.venue as string}
            </h3>
            <span className="text-[11px] uppercase tracking-wider text-ink-muted etched">{vb.booking_status as string}</span>
          </div>
          <div className="mb-3 grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
            <SummaryItem label="Shows" value={String(vb.number_of_shows ?? 1)} />
            <SummaryItem label="Booking" value={String(vb.booking_status ?? "-")} />
          </div>
          {vb.schedule_entries.length > 0 ? (
            <div className="rounded-lg bg-marble-shadow/30 p-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted etched">Schedule</div>
              <div className="space-y-2">
                {vb.schedule_entries.map((se) => {
                  const entry = se as {
                    id: string;
                    activity_type: string;
                    activity_date: string;
                    start_time: string | null;
                    end_time: string | null;
                    with_ac_start: string | null;
                    with_ac_end: string | null;
                    with_ac_minutes: number | null;
                    without_ac_start: string | null;
                    without_ac_end: string | null;
                    without_ac_minutes: number | null;
                    notes: string | null;
                  };
                  return (
                    <div key={entry.id} className="rounded-md bg-marble-highlight/50 px-2 py-1.5">
                      <div className="flex flex-wrap items-center gap-3 text-xs text-ink-secondary etched">
                        <span className="inline-block w-24 font-medium capitalize text-sage-text">{entry.activity_type.replace(/_/g, " ")}</span>
                        <span>{formatDate(entry.activity_date)}</span>
                        {entry.start_time && <span>{entry.start_time}{entry.end_time ? `-${entry.end_time}` : ""}</span>}
                        {entry.notes && <span className="text-ink-muted">· {entry.notes}</span>}
                      </div>
                      {(entry.with_ac_start || entry.without_ac_start) && (
                        <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-ink-muted etched">
                          {entry.with_ac_start && (
                            <span>With AC: {entry.with_ac_start}{entry.with_ac_end ? `-${entry.with_ac_end}` : ""}{entry.with_ac_minutes != null ? ` (${formatDuration(entry.with_ac_minutes)})` : ""}</span>
                          )}
                          {entry.without_ac_start && (
                            <span>Without AC: {entry.without_ac_start}{entry.without_ac_end ? `-${entry.without_ac_end}` : ""}{entry.without_ac_minutes != null ? ` (${formatDuration(entry.without_ac_minutes)})` : ""}</span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="text-xs text-ink-muted etched">No schedule entries.</p>
          )}
        </section>
      ))}
    </div>
  );
}

function ConflictsView({ conflicts }: { conflicts: ConflictsResponse["conflicts"] }) {
  return (
    <div className="carved-card rounded-2xl bg-marble-highlight/50 p-5">
      {conflicts.length === 0 ? (
        <p className="text-sm text-ink-muted etched">No venue conflicts detected.</p>
      ) : (
        <div className="space-y-2">
          {conflicts.map((c, i) => (
            <div key={i} className={"rounded-lg px-3 py-2 text-sm " + (c.level === "conflict" ? "bg-status-cancelled/10 text-status-cancelled" : "bg-status-awaitingApproval/10 text-status-awaitingApproval")}>
              <span className="font-medium uppercase">{c.level === "conflict" ? "Conflict" : "Potential conflict"}</span> with{" "}
              <Link to={`/events/${String(c.event_id)}`} className="underline">{String(c.title)}</Link> ({c.venue}, {formatDate(c.activity_date)} · {c.activity_type}) - status {c.status}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ActivityView({ activity }: { activity: DetailResponse["activity"] }) {
  return (
    <div className="carved-card rounded-2xl bg-marble-highlight/50 p-5">
      <ol className="space-y-3">
        {activity.map((a) => (
          <li key={a.id as string} className="flex items-start gap-3 text-sm">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sage" />
            <div>
              <span className="font-medium text-ink-primary etched-deep">{ACTIVITY_LABELS[a.activity_type as string] ?? String(a.activity_type)}</span>
              {a.actor_name ? <span className="text-ink-muted"> · {a.actor_name as string}</span> : null}
              <div className="text-[11px] text-ink-muted">{formatDateTime(a.created_at as string)}</div>
            </div>
          </li>
        ))}
        {activity.length === 0 && <li className="text-sm text-ink-muted etched">No activity yet.</li>}
      </ol>
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-ink-muted etched">{label}</div>
      <div className="text-sm font-medium text-ink-primary etched-deep">{value}</div>
    </div>
  );
}

function ProgressBar({ label, value, emphasis }: { label: string; value: number | null; emphasis?: boolean }) {
  const pct = value != null ? Math.round(value * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className={emphasis ? "font-semibold text-ink-primary etched-deep" : "text-ink-secondary etched"}>{label}</span>
        <span className={emphasis ? "font-semibold text-sage-text etched" : "text-ink-muted etched"}>{pct}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-marble-shadow/60">
        <div className="h-full rounded-full bg-sage-btn" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/**
 * Horizontal lifecycle track: Enquiry → [Approval] → Confirmed.
 * - Past + current steps are highlighted.
 * - This is informational only; the action button below advances the lifecycle.
 * - 'Approved' only appears for VFH events (the approval gate).
 * - Terminal states (regret/cancelled) replace the track with a banner.
 */
function LifecycleTrack({
  current, eventType,
}: {
  current: EventStatus;
  eventType: string | null;
}) {
  // Terminal decline states — show a banner instead of the track.
  if (current === "regret" || current === "cancelled") {
    const label = STATUS_LABELS[current];
    const token = current === "regret" ? "bg-status-regret/10 text-status-regret" : "bg-status-cancelled/10 text-status-cancelled";
    return (
      <div className={"carved-card mb-6 rounded-2xl px-5 py-3 text-sm font-semibold etched " + token}>
        Event marked as {label}. Reopening requires Admin / Venue Manager override.
      </div>
    );
  }

  // Build the track. Approval is VFH-only; Tentative is a holding status, not a normal milestone.
  const track: EventStatus[] = eventType === "VFH"
    ? ["enquiry", "approved", "confirmed"]
    : ["enquiry", "confirmed"];
  const currentIdx = track.indexOf(current);

  return (
    <div className="mb-4 rounded-2xl bg-marble-shadow/20 p-4">
      <ol className="flex flex-wrap items-center gap-1">
        {track.map((s, i) => {
          const isPast = i < currentIdx;
          const isCurrent = i === currentIdx;
          const isApprovedGate = s === "approved";
          return (
            <li key={s} className="flex items-center">
              <span
                aria-current={isCurrent ? "step" : undefined}
                className={
                  "rounded-full px-3 py-1.5 text-xs font-semibold etched transition-colors " +
                  (isCurrent
                    ? "bg-sage-btn text-sage-text carved-btn-sage"
                    : isPast
                      ? "bg-sage/10 text-sage-text"
                      : "bg-marble-shadow/30 text-ink-muted")
                }
                title={isApprovedGate ? "VFH approval gate" : undefined}
              >
                {milestoneLabel(s)}{isApprovedGate && " ★"}
              </span>
              {i < track.length - 1 && (
                <span className={"mx-1 text-ink-muted " + (i < currentIdx ? "text-sage-text" : "")}>→</span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function statusLabel(status: EventStatus): string {
  return STATUS_LABELS[status] ?? status;
}

function milestoneLabel(status: EventStatus): string {
  if (status === "approved") return "Approval";
  return statusLabel(status);
}

function lifecycleActionLabel(status: EventStatus): string {
  if (status === "cancelled") return "Cancel event";
  if (status === "regret") return "Mark as Regret";
  return statusLabel(status);
}

function prettyState(value: string | null | undefined): string {
  if (!value) return "-";
  return value.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function requiresReason(from: EventStatus, to: EventStatus): boolean {
  return to === "cancelled" || to === "regret" || requiresOverride(from, to);
}

function statusClass(status: string): string {
  if (status === "completed") return "rounded-full bg-sage/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-sage-text";
  if (status === "blocked" || status === "cancelled") return "rounded-full bg-status-cancelled/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-status-cancelled";
  if (status === "in_progress" || status === "open") return "rounded-full bg-status-awaitingApproval/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-status-awaitingApproval";
  return "rounded-full bg-marble-shadow/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-muted";
}

function taskStatusLabel(status: string): string {
  if (status === "open") return "Not started";
  if (status === "in_progress") return "Started";
  if (status === "completed") return "Done";
  if (status === "cancelled") return "Cancelled";
  return status.replace(/_/g, " ");
}
