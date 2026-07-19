import { describe, expect, it } from "vitest";
import { blockersForTransition, type EventLifecycleRow } from "../../worker/lib/operations";
import {
  ACTIONABLE_LIFECYCLE_BLOCKERS,
  BLOCKER_TARGETS,
  resolveBlockerWorkHref,
} from "./lifecycle-blocker-targets";

function event(overrides: Partial<EventLifecycleRow> = {}): EventLifecycleRow {
  return {
    id: "ev_1",
    title: "Test",
    event_type: "VFH",
    status: "tentative",
    approval_status: "pending",
    confirmation_status: "none",
    costing_email: "No",
    payment_status: "Incomplete",
    ops_completion: null,
    accounts_completion: null,
    overall_completion: null,
    ...overrides,
  };
}

describe("BLOCKER_TARGETS", () => {
  it("maps every actionable lifecycle blocker to an Operations field", () => {
    for (const blocker of ACTIONABLE_LIFECYCLE_BLOCKERS) {
      const target = BLOCKER_TARGETS[blocker];
      expect(target, `missing target for: ${blocker}`).toBeDefined();
      expect(target!.tab).toBe("operations");
      expect(target!.fieldKey.length).toBeGreaterThan(0);
    }
  });

  it("covers every actionable string that blockersForTransition can emit", () => {
    const emitted = new Set<string>();

    for (const blocker of blockersForTransition(event(), "approved")) {
      emitted.add(blocker);
    }
    for (const blocker of blockersForTransition(event({ confirmation_status: "none" }), "confirmed")) {
      emitted.add(blocker);
    }
    for (const blocker of blockersForTransition(event({ confirmation_status: "made" }), "confirmed")) {
      emitted.add(blocker);
    }
    for (const blocker of blockersForTransition(
      event({ confirmation_status: "couriered", costing_email: "Yes", payment_status: "Completed" }),
      "confirmed",
    )) {
      emitted.add(blocker);
    }
    for (const blocker of blockersForTransition(
      event({ confirmation_status: "signed_received", costing_email: "Yes", payment_status: "Completed", poc_complete: false }),
      "confirmed",
    )) {
      emitted.add(blocker);
    }

    const informational = "Approved is only used for VFH events.";
    for (const blocker of emitted) {
      if (blocker === informational) {
        expect(BLOCKER_TARGETS[blocker]).toBeUndefined();
        continue;
      }
      expect(BLOCKER_TARGETS[blocker], `unmapped blocker from operations: ${blocker}`).toBeDefined();
    }
  });

  it("links payment completion to payment_status (not a stale 'received' key)", () => {
    expect(BLOCKER_TARGETS["Payment must be completed."]?.fieldKey).toBe("payment_status");
    expect(BLOCKER_TARGETS["Payment must be received."]).toBeUndefined();
  });

  it("routes the POC confirmation blocker to the event form POC section", () => {
    expect(resolveBlockerWorkHref("ev_1", BLOCKER_TARGETS["POC not filled, cannot confirm."]!))
      .toBe("/events/ev_1/edit?step=0&section=poc");
  });
});
