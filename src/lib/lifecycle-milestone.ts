import type { EventStatus } from "../../worker/lib/state-machine";

export type LifecycleMilestoneAction = {
  status: EventStatus;
  allowed: boolean;
  blockers: string[];
};

/**
 * Confirmation-letter sub-step states rolled up on the event
 * (`confirmation_status`). The thread progresses left-to-right; `made` and
 * `couriered` mean the user is actively working through it.
 */
const CONFIRMATION_IN_PROGRESS = new Set(["made", "couriered"]);

/** Whether the confirmation-letter thread has been started but not finished. */
export function confirmationInProgress(confirmationStatus: string | null | undefined): boolean {
  return CONFIRMATION_IN_PROGRESS.has(confirmationStatus ?? "");
}

/**
 * Picks which blocked forward milestone the lifecycle panel should highlight.
 *
 * For a VFH event with approval still pending, both `approved` and `confirmed`
 * can be blocked at once. Simply taking the first in a fixed order always
 * surfaces `approved`, so the panel never reflects progress through the
 * confirmation-letter thread (Made → Couriered → Signed). That hides the next
 * actionable confirmation sub-step — e.g. after couriering it should point to
 * "Signed copy received", not back to approval.
 *
 * Rule: among the blocked forward milestones, prefer `confirmed` when the
 * confirmation-letter thread is already in progress; otherwise keep the
 * approval-first behaviour (correct for VFH at the start, and for non-VFH
 * there is only ever `confirmed`).
 *
 * Returns `null` when no forward milestone is blocked.
 */
export function selectBlockedForwardAction(
  actions: LifecycleMilestoneAction[],
  confirmationStatus: string | null | undefined,
  forwardStatuses: EventStatus[] = ["approved", "confirmed"],
): LifecycleMilestoneAction | null {
  const blocked = actions.filter(
    (a) => forwardStatuses.includes(a.status) && a.blockers.length > 0,
  );
  if (blocked.length === 0) return null;

  if (confirmationInProgress(confirmationStatus)) {
    const confirmed = blocked.find((a) => a.status === "confirmed");
    if (confirmed) return confirmed;
  }
  return blocked[0] ?? null;
}

/**
 * The lifecycle panel should surface one immediate blocker at a time.
 * Back-end blocker arrays are already ordered from nearest to furthest step,
 * so the first blocker is the next thing the user needs to resolve.
 */
export function selectNextLifecycleBlocker(blockers: string[]): string | null {
  return blockers[0] ?? null;
}
