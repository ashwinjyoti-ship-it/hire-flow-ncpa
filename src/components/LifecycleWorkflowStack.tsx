import { useEffect, useState, type ReactNode } from "react";
import {
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

const STACK_PHASES: Array<"confirm" | "event" | "accounts"> = ["confirm", "event", "accounts"];

type LifecycleWorkflowStackProps = {
  workflow: WorkflowSnapshot;
  confirmContent: ReactNode;
  eventContent: ReactNode;
  accountsContent: ReactNode;
  /** Force-expand a phase (e.g. deep link to a checklist field). */
  forceExpandPhase?: "confirm" | "event" | "accounts" | null;
  confirmSummary?: string;
  eventSummary?: string;
  accountsSummary?: string;
};

export function LifecycleWorkflowStack({
  workflow,
  confirmContent,
  eventContent,
  accountsContent,
  forceExpandPhase = null,
  confirmSummary = "Confirmation blockers cleared",
  eventSummary = "Event form readiness complete",
  accountsSummary = "Accounts & post-event closed",
}: LifecycleWorkflowStackProps) {
  const active = workflow.activePhase;
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => initialExpanded(active, forceExpandPhase));

  useEffect(() => {
    setExpanded(initialExpanded(active, forceExpandPhase));
  }, [active, forceExpandPhase]);

  const contentByPhase = {
    confirm: confirmContent,
    event: eventContent,
    accounts: accountsContent,
  } as const;
  const summaryByPhase = {
    confirm: confirmSummary,
    event: eventSummary,
    accounts: accountsSummary,
  } as const;

  return (
    <section id="event-lifecycle-workflow" className="mb-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-sage etched">Lifecycle workflow</h2>
          <p className="mt-1 text-xs text-ink-muted etched">
            Focus: <span className="font-medium text-ink-secondary">{workflow.label}</span>
            {workflow.accountsStartDate && active !== "accounts" && active !== "complete" && active !== "terminal" ? (
              <> · Accounts opens {formatDate(workflow.accountsStartDate)}</>
            ) : null}
          </p>
        </div>
      </div>

      {active === "duringEvent" && (
        <div className="rounded-2xl bg-marble-shadow/30 px-4 py-3 text-sm text-ink-secondary etched">
          Event in progress
          {workflow.finalShowDate ? ` through ${formatDate(workflow.finalShowDate)}` : ""}.
          {" "}Accounts and Feedback open
          {workflow.accountsStartDate ? ` on ${formatDate(workflow.accountsStartDate)}` : " the day after the final show"}.
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

      {active !== "terminal" && STACK_PHASES.map((phase) => {
        if (!isWorkflowPhaseVisible(phase, active)) return null;

        const isActive = phase === active;
        const isOpen = Boolean(expanded[phase]);
        return (
          <article
            key={phase}
            id={`lifecycle-phase-${phase}`}
            className={
              "carved-card overflow-hidden rounded-2xl " +
              (isActive ? "bg-marble-highlight/60 ring-1 ring-sage/20" : "bg-marble-highlight/40")
            }
          >
            <button
              type="button"
              onClick={() => setExpanded((prev) => ({ ...prev, [phase]: !prev[phase] }))}
              className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
              aria-expanded={isOpen}
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
                {!isOpen && !isActive && (
                  <p className="mt-1 text-xs text-ink-muted etched">{summaryByPhase[phase]}</p>
                )}
                {!isOpen && isActive && (
                  <p className="mt-1 text-xs text-ink-muted etched">Expand to continue this workflow</p>
                )}
              </div>
              <span className="shrink-0 text-ink-muted" aria-hidden="true">{isOpen ? "▾" : "▸"}</span>
            </button>
            {isOpen && (
              <div className="border-t border-ink-muted/10 px-5 py-4">
                {contentByPhase[phase]}
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}

function initialExpanded(
  active: LifecycleWorkflowPhase,
  force: "confirm" | "event" | "accounts" | null,
): Record<string, boolean> {
  const next: Record<string, boolean> = { confirm: false, event: false, accounts: false };
  if (force) {
    next[force] = true;
    return next;
  }
  if (active === "confirm" || active === "event" || active === "accounts") {
    next[active] = true;
  }
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
  return "confirm";
}
