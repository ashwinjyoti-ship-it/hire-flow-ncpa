import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GoToTopButton } from "../components/GoToTopButton";
import { PageHeader } from "../components/PageHeader";
import { EventReadinessPanel } from "../components/EventReadinessPanel";
import {
  LifecycleWorkflowStack,
  workflowPhaseForChecklistTarget,
  type WorkflowSnapshot,
} from "../components/LifecycleWorkflowStack";
import { PocIncompleteBanner, PocStatusBadge } from "../components/PocIncompleteBanner";
import { StatusBadge } from "../components/StatusBadge";
import { apiDelete, apiGet, apiPost, apiUpload } from "../lib/api";
import { scrollAppMainToElement, scrollAppMainToTop } from "../lib/scroll-app-main";
import { formatDate, formatDateTime, formatDuration, formatTimeRange } from "../lib/use-lookups";
import { useAuth } from "../lib/auth";
import { can } from "../lib/can";
import { STATUS_LABELS, requiresOverride } from "../../worker/lib/state-machine";
import type { EventStatus } from "../../worker/lib/state-machine";
import { DOCUMENT_CATEGORIES, MAX_DOCUMENT_BYTES } from "../../worker/lib/documents";
import { BLOCKER_TARGETS, resolveBlockerWorkHref } from "../lib/lifecycle-blocker-targets";
import { selectBlockedForwardAction, selectNextLifecycleBlocker } from "../lib/lifecycle-milestone";
import { getEventStatusSurface } from "../lib/event-status-surface";
import { filterTasksForActiveWorkflow } from "../lib/task-workflows";
import { getPostShowDateWarning } from "../../worker/lib/checklist-date-policy";
import {
  accountsStartDate,
  getActiveWorkflowPhase,
  isConfirmChecklistSection,
  isEventPrepOpsSection,
  isFileClosedValue,
  POST_EVENT_CHECKLIST_SECTION,
  type LifecycleWorkflowPhase,
  WORKFLOW_PHASE_LABELS,
} from "../../worker/lib/lifecycle-workflow-phase";
import {
  buildMomDocument,
  buildMomDocumentHtml,
  buildMomHtml,
  getMomMissingFields,
  momMissingFieldsMessage,
  type MomEventInput,
} from "../lib/mom";
import { openEventFormPrintable, type EventFormPrintInput } from "../lib/event-form-print";
import { downloadWordDoc } from "../lib/export";
import { openPrintableHtml } from "../lib/open-printable";
import type { PocCompletionStatus } from "../../worker/lib/poc-completion";
import type { EventFormReadiness } from "../../worker/lib/event-readiness";
import { isChecklistFieldVisible, isFullWidthChecklistField } from "../lib/checklist-visibility";
import { useChecklistUpdate } from "../lib/use-checklist-update";
import { formatActivityType } from "../../worker/lib/types";
import {
  formatScheduleSummary,
  getDefaultExpandedVenueKeys,
  getVenueBookingKey,
  shouldUseCompactSchedule,
  shouldUseTwoColumnSchedule,
  venuesAndScheduleTabLabel,
} from "../lib/venue-schedule-view";
import { VENUES_SCHEDULE_ANCHOR_ID, VENUES_SCHEDULE_READINESS_KEY } from "../../worker/lib/venue-schedule-readiness";

type DetailResponse = {
  event: Record<string, unknown> & {
    id: string;
    title: string;
    status: EventStatus;
    event_code: string | null;
    event_type: string | null;
    event_start_date: string | null;
    event_end_date: string | null;
    organisation_name: string | null;
    primary_contact_name: string | null;
    event_owner: string | null;
    program_officer: string | null;
    description: string | null;
    notes: string | null;
    enquiry_source: string | null;
    priority: string | null;
    requirements: Record<string, unknown> | string | null;
    approval_status: string | null;
    confirmation_status: string | null;
    payment_status: string | null;
    overall_completion: number | null;
    ops_completion: number | null;
    accounts_completion: number | null;
    poc_completion?: PocCompletionStatus;
    event_readiness?: EventFormReadiness;
  };
  venue_bookings: Array<Record<string, unknown> & {
    venue?: string | null;
    booking_status?: string | null;
    number_of_shows?: number | null;
    notes?: string | null;
    requirements?: Record<string, unknown> | string | null;
    schedule_entries: unknown[];
  }>;
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
  visibility_rule?: string | null;
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
  workflow?: WorkflowSnapshot | null;
  poc: PocCompletionStatus;
  readiness: EventFormReadiness;
};

type EventPageFreshState = {
  detail: DetailResponse;
  checklist: ChecklistResponse;
  tasks: { tasks: Array<Record<string, unknown>> };
};

type EventDetailTab = "operations" | "accounts" | "tasks" | "venues" | "documents";
type VisibleEventDetailTab = "tasks" | "venues" | "documents";

type ScheduleEntryView = {
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

type EventDocument = {
  id: string;
  file_name: string;
  mime_type: string | null;
  file_size: number | null;
  category: string | null;
  notes: string | null;
  uploaded_at: string;
  uploaded_by_name: string | null;
};

export function EventDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<EventDetailTab>(() => parseEventDetailTab(searchParams.get("tab")) ?? "tasks");
  const [statusModal, setStatusModal] = useState<EventStatus | null>(null);
  const [reason, setReason] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [deleteModal, setDeleteModal] = useState(false);
  const [momOpen, setMomOpen] = useState(false);
  const [momCustomNotes, setMomCustomNotes] = useState("");
  const [momMissingPrompt, setMomMissingPrompt] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [keepOrgDetails, setKeepOrgDetails] = useState(true);
  const [focusedFieldKey, setFocusedFieldKey] = useState<string | null>(() => searchParams.get("field"));
  const [showAllWorkflowTasks, setShowAllWorkflowTasks] = useState(false);
  // Only auto-scroll to a deep-linked field once; checklist refetches must not yank the viewport back.
  const scrolledToFieldRef = useRef<string | null>(null);

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

  const { data: documentsData } = useQuery({
    queryKey: ["event", id, "documents"],
    queryFn: () => apiGet<{ documents: EventDocument[] }>(`/events/${id}/documents`),
  });

  useEffect(() => {
    const nextTab = parseEventDetailTab(searchParams.get("tab"));
    const nextField = searchParams.get("field");
    if (nextTab && nextTab !== tab) setTab(nextTab);
    setFocusedFieldKey(nextField);
    if (nextField !== scrolledToFieldRef.current) {
      scrolledToFieldRef.current = null;
    }
  }, [searchParams, tab]);

  useEffect(() => {
    if (!focusedFieldKey) return;
    if (scrolledToFieldRef.current === focusedFieldKey) return;
    const frame = window.requestAnimationFrame(() => {
      if (focusedFieldKey === VENUES_SCHEDULE_READINESS_KEY) {
        if (tab !== "venues") return;
        const el = document.getElementById(VENUES_SCHEDULE_ANCHOR_ID);
        if (!el) return;
        scrolledToFieldRef.current = focusedFieldKey;
        scrollAppMainToElement(el, "start", "smooth");
        return;
      }
      const el = document.getElementById(`checklist-${focusedFieldKey}`);
      if (!el) return;
      scrolledToFieldRef.current = focusedFieldKey;
      scrollAppMainToElement(el, "center", "smooth");
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusedFieldKey, tab, checklistData, data?.venue_bookings, showAllWorkflowTasks]);

  useEffect(() => {
    if (!momMissingPrompt) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMomMissingPrompt(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [momMissingPrompt]);

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

  function clearFocusedField() {
    setFocusedFieldKey(null);
    scrolledToFieldRef.current = null;
    const params = new URLSearchParams(searchParams);
    params.delete("field");
    setSearchParams(params, { replace: true });
  }

  function scrollEventToTop() {
    clearFocusedField();
    scrollAppMainToTop("smooth");
  }

  const transition = useMutation({
    mutationFn: async (args: { to: EventStatus; reason?: string | null; note?: string | null }) => {
      await apiPost(`/events/${id}/status`, { to_status: args.to, reason: args.reason, note: args.note });
      return fetchFreshEventState();
    },
    onSuccess: (fresh) => {
      setStatusModal(null);
      setReason("");
      applyFreshEventState(fresh);
      scrollEventToTop();
    },
  });

  const checklistUpdate = useChecklistUpdate(id);
  const savingChecklistItemId = checklistUpdate.savingItemId;

  const createTask = useMutation({
    mutationFn: async (title: string) => apiPost("/tasks", { title, event_id: id, priority: "medium" }),
    onSuccess: () => {
      setTaskTitle("");
      qc.invalidateQueries({ queryKey: ["tasks", id] });
      qc.invalidateQueries({ queryKey: ["event", id] });
    },
  });

  const archiveEvent = useMutation({
    mutationFn: () => apiDelete(`/events/${id}`, { keep_org_details: keepOrgDetails }),
    onSuccess: () => {
      setDeleteModal(false);
      qc.invalidateQueries({ queryKey: ["events"], exact: false });
      qc.invalidateQueries({ queryKey: ["calendar"], exact: false });
      qc.invalidateQueries({ queryKey: ["calendar-lifecycle"], exact: false });
      qc.invalidateQueries({ queryKey: ["tasks"], exact: false });
      navigate("/calendar");
    },
  });

  if (isLoading) return <div className="text-sm text-ink-muted">Loading...</div>;
  const e = data?.event;
  if (!e) return <div className="text-sm text-ink-muted">Event not found.</div>;

  const canChangeStatus = can(user?.permissions, "event.status.change");
  const canUpdateChecklist = can(user?.permissions, "checklist.update");
  const actions = checklistData?.lifecycle.actions ?? [];
  const pocCompletion = (e.poc_completion ?? checklistData?.poc) as PocCompletionStatus | undefined;
  const showPocAlert = pocCompletion && !pocCompletion.complete && e.status !== "cancelled" && e.status !== "regret";
  const opsSections = checklistData?.checklist.operations ?? {};
  const accountsSections = checklistData?.checklist.accounts ?? {};
  const confirmSections = Object.fromEntries(
    Object.entries(opsSections).filter(([section]) => isConfirmChecklistSection(section)),
  );
  const eventPrepOpsSections = Object.fromEntries(
    Object.entries(opsSections).filter(([section]) => isEventPrepOpsSection(section)),
  );
  const postEventSections = Object.fromEntries(
    Object.entries(opsSections).filter(([section]) => section === POST_EVENT_CHECKLIST_SECTION),
  );
  const fileClosedItem = Object.values(postEventSections).flat().find((item) => item.field_key === "file_closed");
  const fileClosed = isFileClosedValue(fileClosedItem?.value);
  const todayIso = new Date().toISOString().slice(0, 10);
  const derivedPhase = getActiveWorkflowPhase({
    status: e.status,
    eventStartDate: e.event_start_date,
    eventEndDate: e.event_end_date,
    fileClosed,
  }, todayIso);
  const workflow: WorkflowSnapshot = checklistData?.workflow ?? {
    activePhase: derivedPhase,
    label: WORKFLOW_PHASE_LABELS[derivedPhase],
    firstShowDate: e.event_start_date,
    finalShowDate: e.event_end_date ?? e.event_start_date,
    accountsStartDate: accountsStartDate(e.event_start_date, e.event_end_date),
    fileClosed,
  };
  const activeWorkflowPhase: LifecycleWorkflowPhase = workflow.activePhase;
  const forceExpandPhase = workflowPhaseForChecklistTarget(tab, focusedFieldKey);
  const visibleTab: VisibleEventDetailTab =
    tab === "venues" || tab === "documents" || tab === "tasks" ? tab : "tasks";
  const allEventTasks = (taskData?.tasks ?? []) as Array<Record<string, unknown> & {
    status?: string;
    task_type?: string;
    source_rule?: string | null;
  }>;
  const workflowScopedTasks = filterTasksForActiveWorkflow(
    allEventTasks.map((task) => ({
      id: String(task.id),
      title: String(task.title ?? ""),
      description: (task.description as string | null) ?? null,
      event_id: id,
      event_title: e.title,
      event_status: e.status,
      event_start_date: e.event_start_date,
      event_end_date: e.event_end_date,
      task_type: (task.task_type as "automatic" | "manual") ?? "manual",
      source_rule: (task.source_rule as string | null) ?? null,
      assignee_name: (task.assignee_name as string | null) ?? null,
      due_date: (task.due_date as string | null) ?? null,
      priority: (task.priority as "high" | "medium" | "low") ?? "medium",
      status: (task.status as "open" | "in_progress" | "completed" | "cancelled") ?? "open",
    })),
    activeWorkflowPhase,
    showAllWorkflowTasks,
  );
  const pendingTasks = workflowScopedTasks.filter((task) => task.status !== "completed" && task.status !== "cancelled");
  const readiness = checklistData?.readiness ?? e.event_readiness;
  const eventPrepOpsItems = Object.values(eventPrepOpsSections).flat();
  const eventPrepOpsByKey = new Map(eventPrepOpsItems.map((item) => [item.field_key, item]));
  const eventPrepOpsVisible = eventPrepOpsItems.filter((item) => isChecklistFieldVisible(item, eventPrepOpsByKey));
  const eventPrepOpsDone = eventPrepOpsVisible.filter(
    (item) => item.status === "completed" || item.status === "not_applicable",
  ).length;
  const eventPrepOpsTotal = eventPrepOpsVisible.length;
  const eventPrepOpsRatio = eventPrepOpsTotal ? eventPrepOpsDone / eventPrepOpsTotal : 1;
  const eventPrepSummary = [
    eventPrepOpsTotal ? `Ops ${eventPrepOpsDone}/${eventPrepOpsTotal}` : "Ops",
    readiness ? `Form ${readiness.percentage}%` : "Form",
  ].join(" · ");

  const momInput: MomEventInput = {
    title: e.title,
    description: e.description,
    event_type: e.event_type,
    organisation_name: e.organisation_name,
    program_officer: e.program_officer,
    event_start_date: e.event_start_date,
    event_end_date: e.event_end_date,
    requirements: e.requirements,
    venue_bookings: (data?.venue_bookings ?? []).map((vb) => ({
      venue: vb.venue ?? null,
      number_of_shows: vb.number_of_shows ?? null,
      notes: vb.notes ?? null,
      requirements: vb.requirements ?? null,
      schedule_entries: (vb.schedule_entries ?? []) as NonNullable<MomEventInput["venue_bookings"]>[number]["schedule_entries"],
    })),
  };
  const momDocument = buildMomDocument(momInput, momCustomNotes);
  const momAutoHtml = buildMomDocumentHtml(momInput);
  const momRichHtml = buildMomDocumentHtml(momInput, momCustomNotes);
  const momFileBase = `MoM-${(e.title || "event").replace(/[^\w.-]+/g, "-").slice(0, 60)}`;
  const momTitle = `Minutes of Meeting — ${e.title}`;

  function requestGenerateMom() {
    const missing = getMomMissingFields(momInput);
    if (missing.length > 0) {
      setMomMissingPrompt(momMissingFieldsMessage(missing));
      return;
    }
    setMomOpen(true);
  }

  async function copyMomText() {
    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([momRichHtml], { type: "text/html" }),
            "text/plain": new Blob([momDocument], { type: "text/plain" }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(momDocument);
      }
      setCopyStatus("copied");
      window.setTimeout(() => setCopyStatus("idle"), 2000);
    } catch {
      try {
        await navigator.clipboard.writeText(momDocument);
        setCopyStatus("copied");
        window.setTimeout(() => setCopyStatus("idle"), 2000);
      } catch {
        setCopyStatus("failed");
        window.setTimeout(() => setCopyStatus("idle"), 2500);
      }
    }
  }

  function exportMomWord() {
    downloadWordDoc(`${momFileBase}.doc`, momTitle, momRichHtml);
    setExportMenuOpen(false);
  }

  function openMomPrintable() {
    openPrintableHtml(buildMomHtml(momInput, momTitle, momCustomNotes));
    setExportMenuOpen(false);
  }

  const eventFormPrintInput: EventFormPrintInput = {
    event_code: e.event_code,
    title: e.title,
    description: e.description,
    event_type: e.event_type,
    status: e.status,
    organisation_name: e.organisation_name,
    primary_contact_name: e.primary_contact_name,
    program_officer: e.program_officer,
    event_owner: e.event_owner,
    event_start_date: e.event_start_date,
    event_end_date: e.event_end_date,
    enquiry_source: e.enquiry_source,
    priority: e.priority,
    notes: e.notes,
    approval_status: e.approval_status,
    confirmation_status: e.confirmation_status,
    requirements: e.requirements,
    venue_bookings: (data?.venue_bookings ?? []).map((vb) => ({
      venue: vb.venue ?? null,
      booking_status: vb.booking_status ?? null,
      number_of_shows: vb.number_of_shows ?? null,
      notes: vb.notes ?? null,
      requirements: vb.requirements ?? null,
      schedule_entries: (vb.schedule_entries ?? []) as NonNullable<EventFormPrintInput["venue_bookings"]>[number]["schedule_entries"],
    })),
    documents: (documentsData?.documents ?? []).map((doc) => ({
      file_name: doc.file_name,
      category: doc.category,
    })),
  };

  function openEventFormExport() {
    openEventFormPrintable(eventFormPrintInput);
  }

  function focusChecklistField(target: { tab: "operations" | "accounts"; fieldKey: string }) {
    navigate(resolveBlockerWorkHref(id, target));
  }

  function selectTab(next: EventDetailTab, fieldKey: string | null = null) {
    setTab(next);
    setFocusedFieldKey(fieldKey);
    scrolledToFieldRef.current = null;
    const params = new URLSearchParams(searchParams);
    if ((next === "tasks" || next === "operations") && !fieldKey) params.delete("tab");
    else params.set("tab", next);
    if (fieldKey) params.set("field", fieldKey);
    else params.delete("field");
    setSearchParams(params, { replace: true });
  }

  function closeFile() {
    if (!fileClosedItem || !canUpdateChecklist) return;
    const today = new Date().toISOString().slice(0, 10);
    checklistUpdate.mutate({ item: fileClosedItem, value: today, status: "completed" });
  }

  return (
    <div>
      <PageHeader
        title={e.organisation_name ?? "—"}
        subtitle={e.title}
        actions={
          <>
            <StatusBadge status={e.status} size="md" />
            {showPocAlert && <PocStatusBadge complete={false} />}
            {can(user?.permissions, "event.edit") && (
              <Link to={`/events/${id}/edit`} className="carved-btn rounded-full bg-neutral-btn px-4 py-2 text-sm font-medium text-ink-secondary etched">
                Edit
              </Link>
            )}
            {can(user?.permissions, "event.archive") && (
              <button
                type="button"
                onClick={() => {
                  setKeepOrgDetails(true);
                  setDeleteModal(true);
                }}
                className="carved-btn rounded-full bg-status-cancelled/10 px-4 py-2 text-sm font-medium text-status-cancelled etched"
              >
                Delete Record
              </button>
            )}
          </>
        }
      />

      {showPocAlert && pocCompletion && (
        <PocIncompleteBanner poc={pocCompletion} eventId={e.id} />
      )}

      <div className="carved-card mb-5 grid grid-cols-2 gap-4 rounded-2xl bg-marble-highlight/50 p-5 md:grid-cols-5">
        <SummaryItem label="Type" value={formatEventType(e.event_type)} />
        <SummaryItem label="Dates" value={e.event_start_date ? `${formatDate(e.event_start_date)}${e.event_end_date && e.event_end_date !== e.event_start_date ? " to " + formatDate(e.event_end_date) : ""}` : "-"} />
        <SummaryItem label="Owner" value={e.event_owner ?? "-"} />
        <SummaryItem label="Approval" value={prettyState(e.approval_status)} />
        <SummaryItem label="Payment status" value={prettyState(e.payment_status)} />
      </div>

      <LifecycleWorkflowStack
        workflow={workflow}
        forceExpandPhase={forceExpandPhase}
        confirmSummary="Confirmation blockers cleared"
        eventSummary={eventPrepSummary}
        accountsSummary={fileClosed ? "File closed" : "Post-event & accounts"}
        confirmContent={(
          <div className="space-y-6">
            <LifecyclePanel
              event={e}
              actions={actions}
              nextAction={checklistData?.lifecycle.nextAction ?? null}
              canChangeStatus={canChangeStatus}
              canShowStatusActions={activeWorkflowPhase === "confirm"}
              onOpenBlocker={focusChecklistField}
              onGenerateMom={requestGenerateMom}
              onOpenEventFormPrintable={openEventFormExport}
              onChoose={(status) => {
                setStatusModal(status);
                setReason("");
              }}
              completion={{
                operations: e.ops_completion,
                accounts: e.accounts_completion,
                overall: e.overall_completion,
              }}
              embedded
            />
            <div>
              <div className="mb-3">
                <h2 className="text-base font-semibold text-ink-primary etched-deep">Confirmation checklist</h2>
                <p className="text-xs text-ink-muted etched">
                  Confirmation blockers deep-link into the fields below. Complete these to advance.
                </p>
              </div>
              <ChecklistModuleView
                sections={confirmSections}
                canEdit={canUpdateChecklist}
                savingItemId={savingChecklistItemId}
                focusedFieldKey={focusedFieldKey}
                finalShowDate={e.event_end_date ?? e.event_start_date}
                showGoToTop
                onGoToTop={clearFocusedField}
                onUpdate={(item, value, status, correctionReason) => checklistUpdate.mutate({ item, value, status, correctionReason })}
              />
            </div>
          </div>
        )}
        eventContent={(
          <div className="space-y-6">
            <div>
              <p className="text-xs text-ink-muted etched">
                After confirmation, finish ops actions and the event form in parallel — neither blocks the other.
                Window runs through the first show date.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl bg-marble-shadow/20 px-3.5 py-3">
                  <ProgressBar label="Ops actions" value={eventPrepOpsRatio} compact />
                </div>
                <div className="rounded-xl bg-marble-shadow/20 px-3.5 py-3">
                  <ProgressBar
                    label="Event form"
                    value={readiness ? readiness.percentage / 100 : null}
                    compact
                  />
                </div>
              </div>
            </div>

            <div id="lifecycle-event-prep-ops">
              <div className="mb-3">
                <h2 className="text-base font-semibold text-ink-primary etched-deep">Ops actions</h2>
                <p className="text-xs text-ink-muted etched">
                  NOC, OnStage/Emailer, Monthly Chart, and Technical Meeting — post-confirm prep.
                </p>
              </div>
              <ChecklistModuleView
                sections={eventPrepOpsSections}
                canEdit={canUpdateChecklist}
                savingItemId={savingChecklistItemId}
                focusedFieldKey={focusedFieldKey}
                finalShowDate={e.event_end_date ?? e.event_start_date}
                showGoToTop
                onGoToTop={clearFocusedField}
                onUpdate={(item, value, status, correctionReason) => checklistUpdate.mutate({ item, value, status, correctionReason })}
              />
            </div>

            <div id="lifecycle-event-prep-form">
              <div className="mb-3">
                <h2 className="text-base font-semibold text-ink-primary etched-deep">Event form readiness</h2>
                <p className="text-xs text-ink-muted etched">
                  Required event-form fields. Automated — these rows cannot be manually ticked.
                </p>
              </div>
              {readiness ? (
                <EventReadinessPanel eventId={e.id} readiness={readiness} detailed />
              ) : (
                <p className="text-sm text-ink-muted etched">Readiness data is not available yet.</p>
              )}
            </div>
          </div>
        )}
        accountsContent={(
          <div className="space-y-6">
            {Object.keys(postEventSections).length > 0 && (
              <div>
                <div className="mb-3">
                  <h2 className="text-base font-semibold text-ink-primary etched-deep">Post-event closure</h2>
                  <p className="text-xs text-ink-muted etched">Feedback and closure actions after the final show.</p>
                </div>
                <ChecklistModuleView
                  sections={postEventSections}
                  canEdit={canUpdateChecklist}
                  savingItemId={savingChecklistItemId}
                  focusedFieldKey={focusedFieldKey}
                  finalShowDate={e.event_end_date ?? e.event_start_date}
                  onUpdate={(item, value, status, correctionReason) => checklistUpdate.mutate({ item, value, status, correctionReason })}
                />
              </div>
            )}
            <div>
              <div className="mb-3">
                <h2 className="text-base font-semibold text-ink-primary etched-deep">Accounts tracking</h2>
                <p className="text-xs text-ink-muted etched">File ping-pong, TDS, and refunds.</p>
              </div>
              <ChecklistModuleView
                sections={accountsSections}
                canEdit={canUpdateChecklist}
                savingItemId={savingChecklistItemId}
                focusedFieldKey={focusedFieldKey}
                finalShowDate={null}
                onUpdate={(item, value, status, correctionReason) => checklistUpdate.mutate({ item, value, status, correctionReason })}
              />
            </div>
            {canUpdateChecklist && !fileClosed && fileClosedItem && activeWorkflowPhase === "accounts" && (
              <div className="rounded-2xl bg-marble-shadow/25 px-4 py-4">
                <h3 className="text-sm font-semibold text-ink-primary etched-deep">Close file</h3>
                <p className="mt-1 text-xs text-ink-muted etched">
                  Mark the venue hire file closed when accounts and post-event work are finished.
                </p>
                <button
                  type="button"
                  disabled={checklistUpdate.isPending}
                  onClick={closeFile}
                  className="carved-btn-sage mt-3 rounded-full bg-sage-btn px-5 py-2 text-sm font-semibold text-sage-text etched disabled:opacity-60"
                >
                  {checklistUpdate.isPending ? "Closing..." : "Close file"}
                </button>
              </div>
            )}
            {fileClosed && (
              <div className="rounded-2xl bg-status-confirmed/10 px-4 py-3 text-sm text-sage-text etched">
                File closed{fileClosedItem?.value ? ` on ${formatDate(fileClosedItem.value)}` : ""}.
              </div>
            )}
          </div>
        )}
      />

      {momOpen && (
        <MomPanel
          autoHtml={momAutoHtml}
          customNotes={momCustomNotes}
          onCustomNotesChange={setMomCustomNotes}
          copyStatus={copyStatus}
          exportMenuOpen={exportMenuOpen}
          onToggleExport={() => setExportMenuOpen((open) => !open)}
          onCopy={copyMomText}
          onExportWord={exportMomWord}
          onExportPdf={openMomPrintable}
          onPrint={openMomPrintable}
          escapeEnabled={!momMissingPrompt}
          onClose={() => {
            setMomOpen(false);
            setExportMenuOpen(false);
          }}
          onRegenerate={requestGenerateMom}
        />
      )}

      {momMissingPrompt && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-ink-primary/30 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mom-missing-title"
        >
          <div className="w-full max-w-md rounded-2xl bg-marble-highlight p-6 shadow-xl">
            <h2 id="mom-missing-title" className="text-sm font-semibold uppercase tracking-wider text-sage etched">Generate MoM</h2>
            <p className="mt-3 text-sm text-ink-secondary etched">{momMissingPrompt}</p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setMomMissingPrompt(null)}
                className="carved-btn rounded-full bg-neutral-btn px-4 py-2 text-sm font-medium text-ink-secondary etched"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setMomMissingPrompt(null);
                  setMomOpen(true);
                }}
                className="carved-btn-sage rounded-full bg-sage-btn px-4 py-2 text-sm font-semibold text-sage-text etched"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

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
          ["tasks", `Tasks${pendingTasks.length ? ` (${pendingTasks.length})` : ""}`],
          ["venues", venuesAndScheduleTabLabel(
            data?.venue_bookings.length ?? 0,
            e.event_readiness?.sections.find((section) => section.key === VENUES_SCHEDULE_READINESS_KEY)?.state,
          )],
          ["documents", `Documents${documentsData?.documents.length ? ` (${documentsData.documents.length})` : ""}`],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => selectTab(key)}
            className={
              "rounded-full px-4 py-1.5 text-sm font-medium etched " +
              (visibleTab === key ? "bg-terracotta-btn text-terracotta-text carved-btn-terracotta" : "text-ink-secondary hover:bg-marble-shadow/40")
            }
          >
            {label}
          </button>
        ))}
      </div>

      {visibleTab === "tasks" && (
        <section className="carved-card rounded-2xl bg-marble-highlight/50 p-5">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-ink-muted etched">
              Showing {showAllWorkflowTasks ? "all" : "active-workflow"} tasks
            </p>
            <button
              type="button"
              onClick={() => setShowAllWorkflowTasks((value) => !value)}
              className="text-xs font-medium text-sage-text underline decoration-current/40 underline-offset-2 etched hover:decoration-current"
            >
              {showAllWorkflowTasks ? "Show active workflow only" : "Show all tasks"}
            </button>
          </div>
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
          <TaskList
            tasks={workflowScopedTasks.map((task) => {
              const original = allEventTasks.find((row) => String(row.id) === task.id);
              return original ?? task;
            })}
          />
        </section>
      )}

      {visibleTab === "venues" && (
        <div id={VENUES_SCHEDULE_ANCHOR_ID} className="scroll-mt-3">
          <VenuesView
            bookings={data?.venue_bookings ?? []}
            canEdit={can(user?.permissions, "event.edit")}
            eventId={id}
          />
        </div>
      )}
      {visibleTab === "documents" && (
        <DocumentsView
          eventId={id}
          documents={documentsData?.documents ?? []}
          canUpload={can(user?.permissions, "document.upload")}
          canArchive={can(user?.permissions, "document.delete")}
        />
      )}

      {deleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-primary/20 backdrop-blur-sm" onClick={() => setDeleteModal(false)}>
          <div className="carved-card w-full max-w-lg rounded-2xl bg-marble-highlight p-6" onClick={(ev) => ev.stopPropagation()}>
            <h3 className="mb-2 text-lg font-semibold text-ink-primary etched-deep">Delete Record</h3>
            <p className="text-sm text-ink-secondary etched">
              This will remove the event from calendars, task views, dashboard counts, and active records. The event is archived rather than permanently erased.
            </p>
            <label className="mt-4 flex items-start gap-3 rounded-xl bg-marble-shadow/30 p-3 text-sm text-ink-secondary etched">
              <input
                type="checkbox"
                checked={keepOrgDetails}
                onChange={(ev) => setKeepOrgDetails(ev.target.checked)}
                className="mt-0.5 h-4 w-4 accent-terracotta"
              />
              <span>
                <span className="block font-semibold text-ink-primary etched-deep">Keep organisation and POC details</span>
                <span className="block text-xs text-ink-muted">The client organisation, primary contact, and contact history remain available for future enquiries.</span>
              </span>
            </label>
            {!keepOrgDetails && (
              <p className="mt-2 rounded-lg bg-status-cancelled/10 px-3 py-2 text-xs text-status-cancelled etched">
                Organisation and POC details must be kept when deleting an event record.
              </p>
            )}
            {archiveEvent.error && <p role="alert" className="mt-3 text-sm text-status-cancelled etched">{(archiveEvent.error as Error).message}</p>}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteModal(false)}
                className="carved-btn rounded-full bg-neutral-btn px-4 py-2 text-sm font-medium text-ink-secondary etched"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!keepOrgDetails || archiveEvent.isPending}
                onClick={() => archiveEvent.mutate()}
                className="carved-btn rounded-full bg-status-cancelled/10 px-4 py-2 text-sm font-semibold text-status-cancelled etched disabled:opacity-60"
              >
                {archiveEvent.isPending ? "Deleting..." : "Delete Record"}
              </button>
            </div>
          </div>
        </div>
      )}

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
                onClick={() => {
                  const trimmed = reason.trim();
                  transition.mutate({
                    to: statusModal,
                    reason: requiresReason(e.status, statusModal) ? trimmed : null,
                    note: requiresReason(e.status, statusModal) ? null : trimmed || null,
                  });
                }}
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

function MomPanel({
  autoHtml,
  customNotes,
  onCustomNotesChange,
  copyStatus,
  exportMenuOpen,
  onToggleExport,
  onCopy,
  onExportWord,
  onExportPdf,
  onPrint,
  escapeEnabled = true,
  onClose,
  onRegenerate,
}: {
  autoHtml: string;
  customNotes: string;
  onCustomNotesChange: (value: string) => void;
  copyStatus: "idle" | "copied" | "failed";
  exportMenuOpen: boolean;
  onToggleExport: () => void;
  onCopy: () => void;
  onExportWord: () => void;
  onExportPdf: () => void;
  onPrint: () => void;
  escapeEnabled?: boolean;
  onClose: () => void;
  onRegenerate: () => void;
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const onCloseRef = useRef(onClose);
  const escapeEnabledRef = useRef(escapeEnabled);
  onCloseRef.current = onClose;
  escapeEnabledRef.current = escapeEnabled;

  useEffect(() => {
    titleRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && escapeEnabledRef.current) onCloseRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-primary/30 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mom-panel-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[min(92vh,52rem)] w-full max-w-3xl flex-col rounded-2xl bg-marble-highlight shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-marble-shadow/35 px-5 py-4">
          <div className="min-w-0">
            <h2
              id="mom-panel-title"
              ref={titleRef}
              tabIndex={-1}
              className="text-sm font-semibold uppercase tracking-wider text-sage etched outline-none"
            >
              Minutes of Meeting
            </h2>
            <p className="mt-1 text-xs text-ink-muted etched">
              Auto-filled through Program Officer. Add Technical Officer and any other undecided items below.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onRegenerate} className="carved-btn rounded-full bg-neutral-btn px-3 py-1.5 text-xs font-medium text-ink-secondary etched">
              Refresh from event
            </button>
            <button type="button" onClick={onClose} className="carved-btn rounded-full bg-neutral-btn px-3 py-1.5 text-xs font-medium text-ink-secondary etched">
              Close
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-4">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-sage etched">Generated MoM</span>
            <div
              className="carved rounded-xl border border-marble-shadow/40 bg-marble-highlight/80 px-4 py-3 font-serif text-[15px] leading-relaxed text-ink-primary"
              dangerouslySetInnerHTML={{ __html: autoHtml }}
            />
          </div>

          <label className="mb-4 block">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-sage etched">Customised information</span>
            <textarea
              value={customNotes}
              onChange={(e) => onCustomNotesChange(e.target.value)}
              rows={4}
              placeholder={"Technical Officer: Name – phone\nInterval duration, unloading notes, foyer specifics, or any other MoM wording…"}
              className="carved input text-sm"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-marble-shadow/35 px-5 py-4">
          <button type="button" onClick={onCopy} className="carved-btn-sage rounded-full bg-sage-btn px-4 py-2 text-sm font-semibold text-sage-text etched">
            {copyStatus === "copied" ? "Copied" : copyStatus === "failed" ? "Copy failed" : "Copy Text"}
          </button>
          <div className="relative">
            <button type="button" onClick={onToggleExport} className="carved-btn rounded-full bg-neutral-btn px-4 py-2 text-sm font-medium text-ink-secondary etched">
              Export
            </button>
            {exportMenuOpen && (
              <div className="absolute bottom-full left-0 z-10 mb-2 min-w-36 rounded-xl bg-marble-highlight p-2 shadow-lg">
                <button type="button" onClick={onExportPdf} className="block w-full rounded-lg px-3 py-2 text-left text-sm text-ink-primary hover:bg-marble-shadow/40">
                  Print / PDF
                </button>
                <button type="button" onClick={onExportWord} className="block w-full rounded-lg px-3 py-2 text-left text-sm text-ink-primary hover:bg-marble-shadow/40">
                  Word
                </button>
              </div>
            )}
          </div>
          <button type="button" onClick={onPrint} className="carved-btn rounded-full bg-neutral-btn px-4 py-2 text-sm font-medium text-ink-secondary etched">
            Print / PDF
          </button>
        </div>
      </div>
    </div>
  );
}

function LifecyclePanel({
  event,
  actions,
  nextAction,
  canChangeStatus,
  canShowStatusActions,
  onOpenBlocker,
  onGenerateMom,
  onOpenEventFormPrintable,
  onChoose,
  completion,
  embedded = false,
}: {
  event: DetailResponse["event"];
  actions: LifecycleAction[];
  nextAction: LifecycleAction | null;
  canChangeStatus: boolean;
  canShowStatusActions: boolean;
  onOpenBlocker: (target: { tab: "operations" | "accounts"; fieldKey: string }) => void;
  onGenerateMom: () => void;
  onOpenEventFormPrintable: () => void;
  onChoose: (status: EventStatus) => void;
  completion: {
    operations: number | null;
    accounts: number | null;
    overall: number | null;
  };
  embedded?: boolean;
}) {
  const forwardStatuses: EventStatus[] = ["approved", "confirmed"];
  const visibleActions = useMemo(() => {
    const preferred: EventStatus[] = ["approved", "confirmed", "tentative", "regret", "cancelled"];
    return [...actions].sort((a, b) => preferred.indexOf(a.status) - preferred.indexOf(b.status));
  }, [actions]);
  const closeOutActions = visibleActions.filter((action) => action.status === "regret" || action.status === "cancelled");
  // Surface the milestone the user is actively progressing: once the
  // confirmation-letter thread is underway (Made/Couriered), highlight
  // `confirmed`'s next sub-step rather than defaulting back to approval.
  const blockedForwardAction = nextAction
    ? null
    : selectBlockedForwardAction(visibleActions, event.confirmation_status, forwardStatuses);
  const visibleBlocker = blockedForwardAction
    ? selectNextLifecycleBlocker(blockedForwardAction.blockers)
    : null;
  const visibleBlockerTarget = visibleBlocker
    ? BLOCKER_TARGETS[visibleBlocker]
    : undefined;
  const displayedForwardAction = nextAction ?? blockedForwardAction;

  return (
    <section
      id="event-lifecycle"
      className={
        embedded
          ? "scroll-mt-2"
          : "carved-card mb-5 scroll-mt-2 rounded-2xl bg-marble-highlight/50 p-5"
      }
    >
      <div className="mb-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-start lg:gap-5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-sage etched">
            {embedded ? "Confirmation status" : "Lifecycle"}
          </h2>
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
          <div className="mt-3 grid max-w-sm grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <SummaryItem label="Approval" value={prettyState(event.approval_status)} />
            <SummaryItem label="Confirmation" value={prettyState(event.confirmation_status)} />
          </div>
        </div>

        <div className="min-w-0 w-full rounded-xl bg-marble-shadow/20 px-3.5 py-3 lg:w-[16rem] lg:justify-self-center">
          <h3 className="mb-2.5 text-[10px] font-semibold uppercase tracking-wider text-ink-muted etched">Completion</h3>
          <div className="space-y-2">
            <ProgressBar label="Operations" value={completion.operations} compact />
            <ProgressBar label="Accounts" value={completion.accounts} compact />
            <ProgressBar label="Overall" value={completion.overall} emphasis compact />
          </div>
        </div>

        <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-56 lg:justify-self-end lg:items-end">
          <button
            type="button"
            onClick={onGenerateMom}
            className="carved-btn-sage w-full rounded-full bg-sage-btn px-4 py-2 text-sm font-semibold text-sage-text etched sm:w-auto"
          >
            Generate MoM
          </button>
          <div className="w-full rounded-2xl bg-marble-shadow/25 px-3 py-2.5 sm:min-w-56">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-muted etched">Event form</p>
            <button
              type="button"
              onClick={onOpenEventFormPrintable}
              className="carved-btn w-full rounded-full bg-neutral-btn px-3 py-1.5 text-xs font-medium text-ink-secondary etched"
            >
              Print / PDF
            </button>
          </div>
        </div>
      </div>

      <LifecycleTrack
        current={event.status}
        eventType={event.event_type}
        actions={visibleActions}
        canChangeStatus={canChangeStatus && canShowStatusActions}
        onChoose={onChoose}
        onOpenBlocker={onOpenBlocker}
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
          {canChangeStatus && canShowStatusActions && displayedForwardAction && (
            <button
              type="button"
              disabled={!nextAction}
              onClick={() => {
                if (nextAction) onChoose(nextAction.status);
              }}
              title={!nextAction && visibleBlocker ? `Blocked until resolved: ${visibleBlocker}` : undefined}
              className={forwardMilestoneButtonClass(displayedForwardAction.status, !nextAction)}
            >
              {nextAction ? "Advance to" : "Continue to"} {milestoneLabel(displayedForwardAction.status)}
            </button>
          )}
          {canChangeStatus && !canShowStatusActions && (nextAction || closeOutActions.length > 0) && (
            <span className="rounded-full bg-marble-shadow/50 px-3 py-1.5 text-xs font-medium text-ink-muted etched">
              Status changes are available while Confirm is the active workflow
            </span>
          )}
        </div>

        {blockedForwardAction && visibleBlocker && (
          <div className="mt-3 rounded-xl bg-status-awaitingApproval/10 px-4 py-3 text-xs text-status-awaitingApproval etched">
            {visibleBlockerTarget ? (
              <button
                type="button"
                onClick={() => onOpenBlocker(visibleBlockerTarget)}
                className="text-left font-medium underline decoration-current/40 underline-offset-2 hover:decoration-current"
                title={`Go to ${visibleBlockerTarget.label}`}
              >
                {visibleBlocker}
              </button>
            ) : (
              <span>{visibleBlocker}</span>
            )}
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
  savingItemId,
  focusedFieldKey,
  finalShowDate,
  pocCompletion,
  showGoToTop = false,
  onGoToTop,
  onUpdate,
}: {
  sections: Record<string, ChecklistItem[]>;
  canEdit: boolean;
  savingItemId: string | null;
  focusedFieldKey: string | null;
  finalShowDate: string | null;
  pocCompletion?: PocCompletionStatus;
  showGoToTop?: boolean;
  onGoToTop?: () => void;
  onUpdate: (item: ChecklistItem, value: string | null, status?: string, correctionReason?: string | null) => void;
}) {
  const entries = Object.entries(sections);
  if (!entries.length) {
    return <div className="carved-card rounded-2xl bg-marble-highlight/50 p-5 text-sm text-ink-muted etched">No checklist items yet.</div>;
  }
  // Build a lookup of every field across all sections, so a field's
  // visibility_rule can resolve against a controller that lives in a
  // different section (e.g. instalment dates are controlled by the Instalment
  // toggle in the same Financials section). Also used for transitive
  // visibility (Emailer dates hide when Emailer itself is hidden).
  const itemByKey = new Map<string, ChecklistItem>();
  for (const items of Object.values(sections)) {
    for (const item of items) itemByKey.set(item.field_key, item);
  }
  return (
    <div className="space-y-4">
      {showGoToTop && <GoToTopButton targetId="event-lifecycle" onBeforeScroll={onGoToTop} />}
      {entries.map(([section, items]) => {
        const visibleItems = items.filter((item) => isChecklistFieldVisible(item, itemByKey));
        if (!visibleItems.length) return null;
        return (
          <section key={section} className="carved-card rounded-2xl bg-marble-highlight/50 p-5">
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-sage etched">{section}</h3>
            {section === "Point of Contact" && pocCompletion && !pocCompletion.complete && (
              <div className="mb-4 rounded-xl border border-status-awaitingApproval/35 bg-status-awaitingApproval/10 px-3 py-2 text-xs text-ink-secondary etched">
                <span className="font-semibold text-status-awaitingApproval">
                  {pocCompletion.filledCount}/{pocCompletion.totalCount} fields complete
                </span>
                {pocCompletion.missingLabels.length > 0 && (
                  <span> — still needed: {pocCompletion.missingLabels.join(", ")}</span>
                )}
              </div>
            )}
            <div className="grid gap-3 md:grid-cols-2">
              {visibleItems.map((item) => (
                <Fragment key={item.id}>
                  {section === "Onstage/Emailer" && item.field_key === "emailer" && (
                    <div className="md:col-span-2 mt-1 border-t border-marble-shadow/50 pt-4">
                      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-sage etched">Emailer</h4>
                    </div>
                  )}
                  <div className={isFullWidthChecklistField(item.field_key) ? "md:col-span-2" : undefined}>
                    <ChecklistField
                      key={`${item.id}:${item.value ?? ""}:${item.status}`}
                      item={item}
                      focused={focusedFieldKey === item.field_key}
                      canEdit={canEdit && savingItemId !== item.id}
                      finalShowDate={finalShowDate}
                      onUpdate={onUpdate}
                    />
                  </div>
                </Fragment>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ChecklistField({ item, focused, canEdit, finalShowDate, onUpdate }: { item: ChecklistItem; focused: boolean; canEdit: boolean; finalShowDate: string | null; onUpdate: (item: ChecklistItem, value: string | null, status?: string, correctionReason?: string | null) => void }) {
  const disabled = !canEdit || Boolean(item.is_computed);
  const baseClass = "carved mt-1 w-full rounded-xl bg-marble-shadow/40 px-3 py-2 text-sm text-ink-primary focus:outline-none disabled:opacity-60";
  const [validationError, setValidationError] = useState<string | null>(null);

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
        {/* Instalment = No means there are no installments to track, so there is
            nothing to progress — hide the status badge in that case. */}
        {item.field_key === "instalment" && (item.value ?? "").trim().toLowerCase() === "no" ? null : (
          <span className={"rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider " + statusClass(item.status)}>
            {item.status.replace(/_/g, " ")}
          </span>
        )}
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
          className="mt-3 h-4 w-4 accent-terracotta"
        />
      ) : (
        <input
          disabled={disabled}
          type={item.field_type === "date" ? "date" : item.field_type === "number" ? "number" : "text"}
          lang={item.field_type === "date" ? "en-GB" : undefined}
          defaultValue={item.value ?? ""}
          aria-invalid={Boolean(validationError)}
          aria-describedby={validationError ? `checklist-error-${item.id}` : undefined}
          onChange={() => validationError && setValidationError(null)}
          onBlur={(ev) => {
            const next = ev.currentTarget.value || null;
            if (next === (item.value ?? null)) return;
            const warning = item.field_type === "date" ? getPostShowDateWarning(item.field_key, next, finalShowDate) : null;
            if (warning) {
              setValidationError(warning);
              ev.currentTarget.value = item.value ?? "";
              return;
            }
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
      {validationError && (
        <span id={`checklist-error-${item.id}`} role="alert" className="mt-2 block text-xs font-medium text-red-700">
          {validationError}
        </span>
      )}
    </label>
  );
}

function TaskList({ tasks }: { tasks: Array<Record<string, unknown>> }) {
  if (!tasks.length) return <p className="text-sm text-ink-muted etched">No tasks for this event.</p>;

  const openTasks = tasks.filter((task) => {
    const status = String(task.status);
    return status !== "completed" && status !== "cancelled";
  });
  const completedTasks = tasks.filter((task) => {
    const status = String(task.status);
    return status === "completed" || status === "cancelled";
  });

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        {openTasks.length === 0 ? (
          <p className="text-sm text-ink-muted etched">No open tasks.</p>
        ) : (
          openTasks.map((task) => <EventTaskRow key={task.id as string} task={task} />)
        )}
      </div>
      {completedTasks.length > 0 && (
        <div>
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-muted etched">
            Completed ({completedTasks.length})
          </h3>
          <div className="space-y-2">
            {completedTasks.map((task) => <EventTaskRow key={task.id as string} task={task} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function EventTaskRow({ task }: { task: Record<string, unknown> }) {
  return (
    <div className="rounded-xl bg-marble-shadow/30 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-ink-primary etched-deep">{task.title as string}</span>
        <span className={statusClass(String(task.status))}>{taskStatusLabel(String(task.status))}</span>
      </div>
      <div className="mt-1 text-xs text-ink-muted etched">
        {task.task_type === "automatic" ? "System-generated" : "Manual"}
        {task.assignee_name ? ` · ${task.assignee_name as string}` : ""}
      </div>
    </div>
  );
}

function parseEventDetailTab(value: string | null): EventDetailTab | null {
  if (value === "operations" || value === "accounts" || value === "tasks" || value === "venues" || value === "documents") {
    return value;
  }
  return null;
}

const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  DOCUMENT_CATEGORIES.map((c) => [c, c.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase())])
);

function formatFileSize(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function DocumentsView({
  eventId,
  documents,
  canUpload,
  canArchive,
}: {
  eventId: string;
  documents: EventDocument[];
  canUpload: boolean;
  canArchive: boolean;
}) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState<string>("other");
  const [notes, setNotes] = useState("");
  const [fileInputKey, setFileInputKey] = useState(0);

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a file first");
      const form = new FormData();
      form.append("file", file);
      form.append("category", category);
      if (notes.trim()) form.append("notes", notes.trim());
      return apiUpload(`/events/${eventId}/documents`, form);
    },
    onSuccess: () => {
      setFile(null);
      setNotes("");
      setCategory("other");
      setFileInputKey((k) => k + 1);
      qc.invalidateQueries({ queryKey: ["event", eventId, "documents"] });
      qc.invalidateQueries({ queryKey: ["event", eventId] });
    },
  });

  const archive = useMutation({
    mutationFn: (docId: string) => apiDelete(`/documents/${docId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["event", eventId, "documents"] });
      qc.invalidateQueries({ queryKey: ["event", eventId] });
    },
  });

  const tooLarge = file != null && file.size > MAX_DOCUMENT_BYTES;

  return (
    <div className="space-y-4">
      {canUpload && (
        <section className="carved-card rounded-2xl bg-marble-highlight/50 p-5">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-sage etched">Upload document</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="text-xs font-semibold text-ink-secondary etched">File (max 25 MB)</span>
              <input
                key={fileInputKey}
                type="file"
                onChange={(ev) => setFile(ev.target.files?.[0] ?? null)}
                className="carved mt-1 w-full rounded-xl bg-marble-shadow/40 px-3 py-2 text-sm text-ink-primary file:mr-3 file:rounded-full file:border-0 file:bg-neutral-btn file:px-3 file:py-1 file:text-xs file:font-medium"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-ink-secondary etched">Category</span>
              <select
                value={category}
                onChange={(ev) => setCategory(ev.target.value)}
                className="carved mt-1 w-full rounded-xl bg-marble-shadow/40 px-3 py-2 text-sm text-ink-primary focus:outline-none"
              >
                {DOCUMENT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                ))}
              </select>
            </label>
            <label className="block md:col-span-2">
              <span className="text-xs font-semibold text-ink-secondary etched">Notes (optional)</span>
              <input
                value={notes}
                onChange={(ev) => setNotes(ev.target.value)}
                className="carved mt-1 w-full rounded-xl bg-marble-shadow/40 px-3 py-2 text-sm text-ink-primary focus:outline-none"
                placeholder="Context for this document"
              />
            </label>
          </div>
          {tooLarge && <p className="mt-2 text-xs text-status-cancelled etched">This file exceeds the 25 MB limit.</p>}
          {upload.error && <p role="alert" className="mt-2 text-xs text-status-cancelled etched">{(upload.error as Error).message}</p>}
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              disabled={!file || tooLarge || upload.isPending}
              onClick={() => upload.mutate()}
              className="carved-btn-sage rounded-full bg-sage-btn px-5 py-2 text-sm font-semibold text-sage-text etched disabled:opacity-60"
            >
              {upload.isPending ? "Uploading..." : "Upload"}
            </button>
          </div>
        </section>
      )}

      <section className="carved-card rounded-2xl bg-marble-highlight/50 p-5">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-sage etched">Documents</h3>
        {documents.length === 0 ? (
          <p className="text-sm text-ink-muted etched">No documents uploaded for this event.</p>
        ) : (
          <div className="space-y-2">
            {documents.map((doc) => (
              <div key={doc.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-marble-shadow/30 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink-primary etched-deep">{doc.file_name}</span>
                    <span className="rounded-full bg-sage/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-sage-text">
                      {CATEGORY_LABELS[doc.category ?? "other"] ?? doc.category}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-ink-muted etched">
                    {formatFileSize(doc.file_size)} · {formatDateTime(doc.uploaded_at)}
                    {doc.uploaded_by_name ? ` · ${doc.uploaded_by_name}` : ""}
                    {doc.notes ? ` · ${doc.notes}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={`/api/documents/${doc.id}/download`}
                    className="carved-btn rounded-full bg-neutral-btn px-3 py-1.5 text-xs font-medium text-ink-secondary etched"
                  >
                    Download
                  </a>
                  {canArchive && (
                    <button
                      type="button"
                      disabled={archive.isPending}
                      onClick={() => {
                        if (window.confirm(`Archive "${doc.file_name}"? It will no longer appear for this event.`)) {
                          archive.mutate(doc.id);
                        }
                      }}
                      className="carved-btn rounded-full bg-status-cancelled/10 px-3 py-1.5 text-xs font-medium text-status-cancelled etched disabled:opacity-60"
                    >
                      Archive
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {archive.error && <p role="alert" className="mt-2 text-xs text-status-cancelled etched">{(archive.error as Error).message}</p>}
      </section>
    </div>
  );
}

function formatAcTiming(
  start: string | null | undefined,
  end: string | null | undefined,
  minutes: number | null | undefined,
): string | null {
  if (!start && !end) return null;
  const range = formatTimeRange(start, end);
  return minutes != null ? `${range} (${formatDuration(minutes)})` : range;
}

function ScheduleTimingCell({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="rounded-lg bg-marble-highlight/80 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted etched">{label}</div>
      <div className="mt-0.5 text-sm font-medium tabular-nums text-ink-primary etched-deep">{value}</div>
    </div>
  );
}

function ScheduleEntryCard({ entry, compact = false }: { entry: ScheduleEntryView; compact?: boolean }) {
  const withAc = formatAcTiming(entry.with_ac_start, entry.with_ac_end, entry.with_ac_minutes);
  const withoutAc = formatAcTiming(entry.without_ac_start, entry.without_ac_end, entry.without_ac_minutes);
  const mainTime = entry.start_time || entry.end_time ? formatTimeRange(entry.start_time, entry.end_time) : null;

  if (compact) {
    return (
      <tr className="border-b border-marble-shadow/20 last:border-b-0 align-top">
        <td className="px-3 py-2.5">
          <div className="font-medium text-sage-text etched-deep">{formatActivityType(entry.activity_type)}</div>
          {entry.notes && <div className="mt-1 text-xs text-ink-muted etched">{entry.notes}</div>}
        </td>
        <td className="px-3 py-2.5 text-ink-secondary etched">{entry.activity_date ? formatDate(entry.activity_date) : "—"}</td>
        <td className="px-3 py-2.5 tabular-nums text-ink-primary etched-deep">{mainTime ?? "—"}</td>
        <td className="px-3 py-2.5 tabular-nums text-ink-secondary etched">{withAc ?? "—"}</td>
        <td className="px-3 py-2.5 tabular-nums text-ink-secondary etched">{withoutAc ?? "—"}</td>
      </tr>
    );
  }

  return (
    <article className="rounded-xl border border-marble-shadow/30 bg-marble-highlight/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h5 className="text-sm font-semibold text-sage-text etched-deep">{formatActivityType(entry.activity_type)}</h5>
        {entry.activity_date && (
          <span className="rounded-full bg-marble-shadow/35 px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wider text-ink-secondary etched">
            {formatDate(entry.activity_date)}
          </span>
        )}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {mainTime && <ScheduleTimingCell label="Time" value={mainTime} />}
        {withAc && <ScheduleTimingCell label="With AC" value={withAc} />}
        {withoutAc && <ScheduleTimingCell label="Without AC" value={withoutAc} />}
      </div>

      {entry.notes && (
        <p className="mt-3 rounded-lg bg-marble-shadow/20 px-3 py-2 text-xs text-ink-muted etched">{entry.notes}</p>
      )}
    </article>
  );
}

function VenueScheduleSection({
  entries,
  venueCount,
}: {
  entries: ScheduleEntryView[];
  venueCount: number;
}) {
  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-marble-shadow/40 bg-marble-shadow/15 px-4 py-5 text-center">
        <p className="text-sm text-ink-muted etched">No schedule entries for this venue yet.</p>
      </div>
    );
  }

  if (shouldUseCompactSchedule(entries.length)) {
    return (
      <div className="overflow-x-auto rounded-xl border border-marble-shadow/30 bg-marble-highlight/50">
        <table className="min-w-full text-left text-sm">
          <thead>
            <tr className="border-b border-marble-shadow/30 text-[10px] uppercase tracking-wider text-ink-muted">
              <th className="px-3 py-2.5 font-semibold etched">Activity</th>
              <th className="px-3 py-2.5 font-semibold etched">Date</th>
              <th className="px-3 py-2.5 font-semibold etched">Time</th>
              <th className="px-3 py-2.5 font-semibold etched">With AC</th>
              <th className="px-3 py-2.5 font-semibold etched">Without AC</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, entryIdx) => (
              <ScheduleEntryCard
                key={entry.id || `${entry.activity_type}-${entry.activity_date}-${entryIdx}`}
                entry={entry}
                compact
              />
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className={"grid gap-3 " + (shouldUseTwoColumnSchedule(entries.length, venueCount) ? "lg:grid-cols-2" : "grid-cols-1")}>
      {entries.map((entry, entryIdx) => (
        <ScheduleEntryCard key={entry.id || `${entry.activity_type}-${entry.activity_date}-${entryIdx}`} entry={entry} />
      ))}
    </div>
  );
}

function VenueBookingPanel({
  booking,
  index,
  venueCount,
  expanded,
  collapsible,
  onToggle,
}: {
  booking: DetailResponse["venue_bookings"][number];
  index: number;
  venueCount: number;
  expanded: boolean;
  collapsible: boolean;
  onToggle: () => void;
}) {
  const entries = (booking.schedule_entries as ScheduleEntryView[]) ?? [];
  const venueName = (booking.venue as string) || "Untitled venue";
  const scheduleSummary = formatScheduleSummary(entries);

  return (
    <section className="carved-card overflow-hidden rounded-2xl bg-marble-highlight/50">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-marble-shadow/25 px-4 py-3 sm:px-5 sm:py-4">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-sage etched">Venue {index + 1}</p>
          <h3 className="mt-1 truncate text-lg font-semibold text-ink-primary etched-deep">{venueName}</h3>
          <p className="mt-1 text-xs text-ink-muted etched">{scheduleSummary}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="rounded-full bg-marble-shadow/40 px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-ink-secondary etched">
            {String(booking.booking_status ?? "—")}
          </span>
          <span className="rounded-full bg-marble-shadow/40 px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-ink-secondary etched">
            {Number(booking.number_of_shows ?? 1)} {Number(booking.number_of_shows ?? 1) === 1 ? "show" : "shows"}
          </span>
          {collapsible && (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={expanded}
              className="carved-btn rounded-full bg-neutral-btn px-3 py-1.5 text-xs font-semibold text-ink-secondary etched"
            >
              {expanded ? "Collapse" : "Expand"}
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="px-4 py-4 sm:px-5">
          <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-muted etched">Schedule</h4>
          <VenueScheduleSection entries={entries} venueCount={venueCount} />
        </div>
      )}
    </section>
  );
}

function VenuesView({
  bookings,
  canEdit,
  eventId,
}: {
  bookings: DetailResponse["venue_bookings"];
  canEdit: boolean;
  eventId: string;
}) {
  const [expandedVenues, setExpandedVenues] = useState<Set<string>>(() => getDefaultExpandedVenueKeys(bookings));
  const collapsible = bookings.length >= 2;

  useEffect(() => {
    setExpandedVenues(getDefaultExpandedVenueKeys(bookings));
  }, [bookings]);

  function toggleVenue(key: string) {
    setExpandedVenues((current) => {
      if (bookings.length >= 3) {
        return current.has(key) ? new Set<string>() : new Set([key]);
      }
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (bookings.length === 0) {
    return (
      <section className="carved-card rounded-2xl bg-marble-highlight/50 p-6">
        <h3 className="text-sm font-semibold text-ink-primary etched-deep">No venues booked</h3>
        <p className="mt-2 text-sm text-ink-secondary etched">
          Venue bookings and activity timings will appear here once they are added on the event form.
        </p>
        {canEdit && (
          <Link
            to={`/events/${eventId}/edit`}
            className="carved-btn-sage mt-4 inline-block rounded-full bg-sage-btn px-5 py-2 text-sm font-semibold text-sage-text etched"
          >
            Add venues &amp; schedule
          </Link>
        )}
      </section>
    );
  }

  return (
    <div className="space-y-4">
      {bookings.length > 1 && (
        <section className="carved-card rounded-2xl bg-marble-highlight/40 p-4 sm:p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted etched">Overview</p>
              <h3 className="mt-1 text-sm font-semibold text-ink-primary etched-deep">
                {bookings.length} venues booked
              </h3>
              <p className="mt-1 text-xs text-ink-muted etched">
                {bookings.length >= 3
                  ? "Use the venue chips below to focus one schedule at a time."
                  : "Tap a venue chip to show or hide its schedule."}
              </p>
            </div>
          </div>
          <div className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1">
            {bookings.map((booking, idx) => {
              const key = getVenueBookingKey(booking, idx);
              const entries = booking.schedule_entries ?? [];
              const isExpanded = expandedVenues.has(key);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleVenue(key)}
                  aria-pressed={isExpanded}
                  className={
                    "shrink-0 rounded-full px-3 py-1.5 text-left text-xs font-medium etched transition-colors " +
                    (isExpanded
                      ? "bg-terracotta-btn text-terracotta-text carved-btn-terracotta"
                      : "carved-btn border border-ink-muted/25 bg-neutral-btn text-ink-secondary hover:bg-neutral-btn-hover")
                  }
                >
                  <span className="block max-w-[12rem] truncate">{(booking.venue as string) || `Venue ${idx + 1}`}</span>
                  <span className="mt-0.5 block text-[10px] uppercase tracking-wider opacity-80">
                    {formatScheduleSummary(entries)}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <div className="space-y-4">
        {bookings.map((booking, idx) => {
          const key = getVenueBookingKey(booking, idx);
          return (
            <VenueBookingPanel
              key={key}
              booking={booking}
              index={idx}
              venueCount={bookings.length}
              expanded={!collapsible || expandedVenues.has(key)}
              collapsible={collapsible}
              onToggle={() => toggleVenue(key)}
            />
          );
        })}
      </div>
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

function normaliseEventType(value: string | null | undefined): string | null {
  switch (value) {
    case "EE":
    case "FR":
    case "VFH":
    case "Free Event":
      return value;
    case "FE":
      return "Free Event";
    case "FR (Foundation)":
      return "FR";
    case "VFH (Venue For Hire)":
      return "VFH";
    default:
      return value?.trim() ? value : null;
  }
}

function formatEventType(value: string | null | undefined): string {
  return normaliseEventType(value) ?? "-";
}

function ProgressBar({
  label,
  value,
  emphasis,
  compact,
}: {
  label: string;
  value: number | null;
  emphasis?: boolean;
  compact?: boolean;
}) {
  const pct = value != null ? Math.round(value * 100) : 0;
  return (
    <div>
      <div className={`mb-0.5 flex justify-between ${compact ? "text-[11px]" : "text-xs"}`}>
        <span className={emphasis ? "font-semibold text-ink-primary etched-deep" : "text-ink-secondary etched"}>{label}</span>
        <span className={`tabular-nums ${emphasis ? "font-semibold text-sage-text etched" : "text-ink-muted etched"}`}>{pct}%</span>
      </div>
      <div className={`overflow-hidden rounded-full bg-marble-shadow/60 ${compact ? "h-1.5" : "h-2"}`}>
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
  current, eventType, actions, canChangeStatus, onChoose, onOpenBlocker,
}: {
  current: EventStatus;
  eventType: string | null;
  actions: LifecycleAction[];
  canChangeStatus: boolean;
  onChoose: (status: EventStatus) => void;
  onOpenBlocker: (target: { tab: "operations" | "accounts"; fieldKey: string }) => void;
}) {
  // Terminal decline states — show a banner instead of the track.
  if (current === "regret" || current === "cancelled") {
    const label = STATUS_LABELS[current];
    const token = current === "regret" ? "bg-status-regret/10 text-status-regret" : "bg-status-cancelled/10 text-status-cancelled";
    return (
      <div className={"carved-card mb-6 rounded-2xl px-5 py-3 text-sm font-semibold etched " + token}>
        Event marked as {label}. Reopening requires conflict-override permission.
      </div>
    );
  }

  // Build the track. Approval is VFH-only; Tentative is a holding status, not a normal milestone.
  const track: EventStatus[] = normaliseEventType(eventType) === "VFH"
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
          const action = actions.find((candidate) => candidate.status === s);
          const blocker = action ? selectNextLifecycleBlocker(action.blockers) : null;
          const blockerTarget = blocker ? BLOCKER_TARGETS[blocker] : undefined;
          const canUseMilestone = Boolean(canChangeStatus && action && (action.allowed || blockerTarget));
          // Colour language: current = terracotta, ready = sage, blocked =
          // amber (same family as "Next step blocked"), past = soft sage,
          // future/unavailable = muted. Never paint a blocked Confirmed/Approval
          // milestone in confirmed-green — that reads as done.
          const milestoneClass =
            "rounded-full px-3 py-1.5 text-xs font-semibold etched transition-colors " +
            (isCurrent
              ? currentMilestoneTrackClass(s)
              : action
                ? action.allowed
                  ? "carved-btn-sage bg-sage-btn text-sage-text hover:bg-sage-btn-hover"
                  : "bg-status-awaitingApproval/15 text-status-awaitingApproval ring-1 ring-status-awaitingApproval/25 hover:bg-status-awaitingApproval/20"
                : isPast
                  ? "bg-sage/10 text-sage-text"
                  : "bg-marble-shadow/30 text-ink-muted");
          const milestoneContent = <>{milestoneLabel(s)}{isApprovedGate && " ★"}</>;
          return (
            <li key={s} className="flex items-center">
              {canUseMilestone ? (
                <button
                  type="button"
                  aria-current={isCurrent ? "step" : undefined}
                  className={milestoneClass}
                  title={action?.allowed ? `Advance to ${milestoneLabel(s)}` : blocker ? `Resolve blocker: ${blocker}` : undefined}
                  onClick={() => {
                    if (action?.allowed) onChoose(s);
                    else if (blockerTarget) onOpenBlocker(blockerTarget);
                  }}
                >
                  {milestoneContent}
                </button>
              ) : (
                <span
                  aria-current={isCurrent ? "step" : undefined}
                  className={milestoneClass}
                  title={isApprovedGate ? "VFH approval gate" : undefined}
                >
                  {milestoneContent}
                </span>
              )}
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

function currentMilestoneTrackClass(status: EventStatus): string {
  const surface = getEventStatusSurface(status);
  const carved = status === "confirmed" || status === "approved" ? "carved-btn-sage" : "carved-btn";
  return `${carved} ${surface.chip}`;
}

function forwardMilestoneButtonClass(status: EventStatus, blocked: boolean): string {
  const base = "rounded-full px-4 py-2 text-sm font-semibold etched disabled:cursor-not-allowed disabled:opacity-50";
  // Blocked: grey and unclickable — resolve via the blocker name link below.
  if (blocked) {
    return `${base} carved-btn bg-marble-shadow/45 text-ink-muted`;
  }
  if (status === "confirmed") {
    return `${base} carved-btn-sage bg-sage-btn text-sage-text hover:bg-sage-btn-hover`;
  }
  return `${base} carved-btn-terracotta bg-terracotta-btn text-terracotta-text hover:bg-terracotta-btn-hover`;
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
  if (status === "open") return "Open";
  if (status === "in_progress") return "In progress";
  if (status === "completed") return "Done";
  if (status === "cancelled") return "Cancelled";
  return status.replace(/_/g, " ");
}
