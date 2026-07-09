import { describe, expect, it } from "vitest";
import { confirmationInProgress, selectBlockedForwardAction, type LifecycleMilestoneAction } from "./lifecycle-milestone";

/** A forward action that is blocked by the given blocker strings. */
function blocked(status: "approved" | "confirmed", blockers: string[]): LifecycleMilestoneAction {
  return { status, allowed: false, blockers };
}

const APPROVAL_BLOCKER = "VFH approval must be received before marking the event approved.";
const APPROVAL_OR_CONFIRM_BLOCKER = "VFH approval must be received or approved.";

describe("confirmationInProgress", () => {
  it("is true only while the confirmation thread is started but unfinished", () => {
    expect(confirmationInProgress("made")).toBe(true);
    expect(confirmationInProgress("couriered")).toBe(true);
    expect(confirmationInProgress("none")).toBe(false);
    expect(confirmationInProgress(null)).toBe(false);
    expect(confirmationInProgress(undefined)).toBe(false);
    expect(confirmationInProgress("signed_received")).toBe(false);
  });
});

describe("selectBlockedForwardAction", () => {
  it("returns null when no forward milestone is blocked", () => {
    expect(selectBlockedForwardAction([], "none")).toBeNull();
    // confirmed already allowed (no blockers) and approved absent (non-VFH).
    expect(
      selectBlockedForwardAction(
        [{ status: "confirmed", allowed: true, blockers: [] }],
        "none",
      ),
    ).toBeNull();
  });

  it("prefers approval when the confirmation thread has not started (VFH)", () => {
    // approval pending + confirmation none → both blocked; approval is nearest.
    const selected = selectBlockedForwardAction(
      [blocked("approved", [APPROVAL_BLOCKER]), blocked("confirmed", ["Confirmation letter must be made.", APPROVAL_OR_CONFIRM_BLOCKER])],
      "none",
    );
    expect(selected?.status).toBe("approved");
  });

  it("surfaces 'confirmed' once the letter has been made but not couriered", () => {
    const selected = selectBlockedForwardAction(
      [blocked("approved", [APPROVAL_BLOCKER]), blocked("confirmed", ["Confirmation letter must be couriered.", APPROVAL_OR_CONFIRM_BLOCKER])],
      "made",
    );
    expect(selected?.status).toBe("confirmed");
    expect(selected?.blockers).toContain("Confirmation letter must be couriered.");
  });

  it("surfaces the 'Signed copy received' sub-step after the couriered date is entered", () => {
    // The client-reported bug: after couriering, the panel kept showing
    // "Approval is blocked" instead of the next confirmation sub-step.
    const selected = selectBlockedForwardAction(
      [blocked("approved", [APPROVAL_BLOCKER]), blocked("confirmed", ["Signed confirmation must be received.", APPROVAL_OR_CONFIRM_BLOCKER])],
      "couriered",
    );
    expect(selected?.status).toBe("confirmed");
    expect(selected?.blockers).toContain("Signed confirmation must be received.");
  });

  it("falls back to approval once the signed copy is received", () => {
    // Only the approval gate remains → approval is the right thing to show.
    const selected = selectBlockedForwardAction(
      [blocked("approved", [APPROVAL_BLOCKER]), blocked("confirmed", [APPROVAL_OR_CONFIRM_BLOCKER])],
      "signed_received",
    );
    expect(selected?.status).toBe("approved");
  });

  it("picks confirmed for non-VFH events where approval is not a forward action", () => {
    const selected = selectBlockedForwardAction(
      [blocked("confirmed", ["Confirmation letter must be made."])],
      "none",
    );
    expect(selected?.status).toBe("confirmed");
  });
});
