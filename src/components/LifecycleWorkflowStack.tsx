import { useEffect, useState, type ReactNode } from "react";
import {
  isEventPrepOpsFieldKey,
  isWorkflowPhaseVisible,
  type LifecycleWorkflowPhase,
  WORKFLOW_PHASE_LABELS,
} from "../../worker/lib/lifecycle-workflow-phase";
import { formatDate } from "../lib/use-lookups";

export type WorkflowSnapshot = {
  activePhase: LifecycleWorkflowPhase;
  label: string;
  firstShowDate: string | null;
  finalShowDate: string | null;
  accountsStartDate: string | null;
  fileClosed: boolean;
};

type AccordionPhase = "confirm" | "accounts";

type LifecycleWorkflowStackProps = {
  workflow: WorkflowSnapshot;
  /** Post-confirm ops + form readiness render when the event is confirmed. */
  confirmed: boolean;
  confirmContent: ReactNode;
  postConfirmOpsContent: ReactNode;
  eventReadinessContent: ReactNode;
  accountsContent: ReactNode;
  postConfirmOpsComplete?: boolean;
  postConfirmOpsSummary?: string;
  eventReadinessComplete?: boolean;
  eventReadinessSummary?: string;
  /** Force-expand an accordion phase (e.g. deep link to a confirm/accounts field). */
  forceExpandPhase?: AccordionPhase | "event" | null;
  confirmSummary?: string;
  accountsSummary?: string;
};

export function LifecycleWorkflowStack({
  workflow,
  confirmed,
  confirmContent,
  postConfirmOpsContent,
  eventReadinessContent,
  accountsContent,
  postConfirmOpsComplete = false,
  postConfirmOpsSummary = "Ops actions complete",
  eventReadinessComplete = false,
  eventReadinessSummary = "Event form ready",
  forceExpandPhase = null,
  confirmSummary = "Confirmation blockers cleared",
  accountsSummary = "Accounts & post-event closed",
}: LifecycleWorkflowStackProps) {
  const active = workflow.activePhase;
  const [expanded, setExpanded] = useState<Record<AccordionPhase, boolean>>(() => initialExpanded(active, forceExpandPhase));

  useEffect(() => {
    setExpanded(initialExpanded(active, forceExpandPhase));
  }, [active, forceExpandPhase]);

  const postConfirmActive = confirmed && (active === "event" || active === "duringEvent");
  const accountsOpensLabel = workflow.accountsStartDate
    ? `the morning after the final show (${formatDate(workflow.accountsStartDate)})`
    : "the morning after the final show";

  return (
    <section id="event-lifecycle-workflow" className="mb-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-sage etched">Lifecycle workflow</h2>
          <p className="mt-1 text-xs text-ink-muted etched">
            Focus: <span className="font-medium text-ink-secondary">{workflow.label}</span>
            {workflow.accountsStartDate && active !== "accounts" && active !== "complete" && active !== "terminal" ? (
              <> · Accounts opens {accountsOpensLabel}</>
            ) : null}
          </p>
        </div>
      </div>

      {active === "duringEvent" && (
        <div className="rounded-2xl bg-marble-shadow/30 px-4 py-3 text-sm text-ink-secondary etched">
          Event in progress
          {workflow.finalShowDate ? ` through ${formatDate(workflow.finalShowDate)}` : ""}.
          {" "}Accounts opens {accountsOpensLabel}.
        </div>
      )}

      {active === "complete" && (
        <div className="rounded-2xl bg-status-confirmed/10 px-4 py-3 text-sm text-sage-text etched">
          File closed. Earlier workflows are collapsed below if you need to review.
        </div>
      )}

      {active === "terminal" && (
        <div className="rounded-2xl bg-marble-shadow/30 px-4 py-3 text-sm text-ink-muted etched">
          This event is closed. Lifecycle workflows are not active.
        </div>
      )}

      {active !== "terminal" && isWorkflowPhaseVisible("confirm", active) && (
        <WorkflowAccordion
          phase="confirm"
          active={active}
          expanded={expanded.confirm}
          onToggle={() => setExpanded((prev) => ({ ...prev, confirm: !prev.confirm }))}
          summary={confirmSummary}
        >
          {confirmContent}
        </WorkflowAccordion>
      )}

      {confirmed && (
        <>
          <PostConfirmPanel
            id="lifecycle-post-confirm-ops"
            title="Ops actions"
            complete={postConfirmOpsComplete}
            collapsedSummary={postConfirmOpsSummary}
            activeHighlight={postConfirmActive}
            forceOpen={forceExpandPhase === "event"}
          >
            {postConfirmOpsContent}
          </PostConfirmPanel>
          <PostConfirmPanel
            id="lifecycle-event-readiness"
            title="Event form readiness"
            complete={eventReadinessComplete}
            collapsedSummary={eventReadinessSummary}
            activeHighlight={postConfirmActive}
            forceOpen={false}
          >
            {eventReadinessContent}
          </PostConfirmPanel>
        </>
      )}

      {active !== "terminal" && isWorkflowPhaseVisible("accounts", active) && (
        <WorkflowAccordion
          phase="accounts"
          active={active}
          expanded={expanded.accounts}
          onToggle={() => setExpanded((prev) => ({ ...prev, accounts: !prev.accounts }))}
          summary={accountsSummary}
        >
          {accountsContent}
        </WorkflowAccordion>
      )}
    </section>
  );
}

function PostConfirmPanel({
  id,
  title,
  complete,
  collapsedSummary,
  activeHighlight,
  forceOpen,
  children,
}: {
  id: string;
  title: string;
  complete: boolean;
  collapsedSummary: string;
  activeHighlight: boolean;
  forceOpen: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => !complete);

  useEffect(() => {
    if (forceOpen) {
      setOpen(true);
      return;
    }
    if (complete) setOpen(false);
    else setOpen(true);
  }, [complete, forceOpen]);

  return (
    <article
      id={id}
      className={
        "carved-card overflow-hidden rounded-2xl " +
        (activeHighlight && !complete ? "bg-marble-highlight/60 ring-1 ring-sage/20" : "bg-marble-highlight/40")
      }
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
        aria-expanded={open}
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-ink-primary etched-deep">{title}</h3>
            {complete ? (
              <span className="rounded-full bg-marble-shadow/50 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-muted etched">
                Done
              </span>
            ) : (
              <span className="rounded-full bg-sage/15 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sage-text etched">
                Active
              </span>
            )}
          </div>
          {!open && (
            <p className="mt-1 text-xs text-ink-muted etched">{collapsedSummary}</p>
          )}
        </div>
        <span className="shrink-0 text-ink-muted" aria-hidden="true">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="border-t border-ink-muted/10 px-5 py-4">
          {children}
        </div>
      )}
    </article>
  );
}

function WorkflowAccordion({
  phase,
  active,
  expanded,
  onToggle,
  summary,
  children,
}: {
  phase: AccordionPhase;
  active: LifecycleWorkflowPhase;
  expanded: boolean;
  onToggle: () => void;
  summary: string;
  children: ReactNode;
}) {
  const isActive = phase === active;
  return (
    <article
      id={`lifecycle-phase-${phase}`}
      className={
        "carved-card overflow-hidden rounded-2xl " +
        (isActive ? "bg-marble-highlight/60 ring-1 ring-sage/20" : "bg-marble-highlight/40")
      }
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
        aria-expanded={expanded}
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-ink-primary etched-deep">
              {WORKFLOW_PHASE_LABELS[phase]}
            </h3>
            {isActive ? (
              <span className="rounded-full bg-sage/15 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sage-text etched">
                Active
              </span>
            ) : (
              <span className="rounded-full bg-marble-shadow/50 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-muted etched">
                Done
              </span>
            )}
          </div>
          {!expanded && !isActive && (
            <p className="mt-1 text-xs text-ink-muted etched">{summary}</p>
          )}
          {!expanded && isActive && (
            <p className="mt-1 text-xs text-ink-muted etched">Expand to continue this workflow</p>
          )}
        </div>
        <span className="shrink-0 text-ink-muted" aria-hidden="true">{expanded ? "▾" : "▸"}</span>
      </button>
      {expanded && (
        <div className="border-t border-ink-muted/10 px-5 py-4">
          {children}
        </div>
      )}
    </article>
  );
}

function initialExpanded(
  active: LifecycleWorkflowPhase,
  force: AccordionPhase | "event" | null,
): Record<AccordionPhase, boolean> {
  const next: Record<AccordionPhase, boolean> = { confirm: false, accounts: false };
  if (force && force !== "event") {
    next[force] = true;
    return next;
  }
  if (active === "confirm") next.confirm = true;
  if (active === "accounts") next.accounts = true;
  return next;
}

/** Map checklist module / field deep links onto a workflow phase. */
export function workflowPhaseForChecklistTarget(
  tab: "operations" | "accounts" | string,
  fieldKey: string | null | undefined,
): "confirm" | "event" | "accounts" | null {
  if (tab === "accounts") return "accounts";
  if (!fieldKey) return tab === "operations" ? "confirm" : null;
  if (
    fieldKey.startsWith("feedback_")
    || fieldKey === "event_report"
    || fieldKey === "box_office_statement"
    || fieldKey === "final_closure_notes"
    || fieldKey === "file_closed"
  ) {
    return "accounts";
  }
  if (isEventPrepOpsFieldKey(fieldKey)) return "event";
  return "confirm";
}
