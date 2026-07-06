import { describe, expect, it } from "vitest";
import { blockersForTransition, buildLifecycleReadiness, ensureChecklistForEvent, type EventLifecycleRow } from "../lib/operations";

function event(overrides: Partial<EventLifecycleRow>): EventLifecycleRow {
  return {
    id: "ev_test",
    title: "Lifecycle Test",
    status: "tentative",
    event_type: "VFH",
    approval_status: "sent",
    confirmation_status: "none",
    ops_completion: 0,
    accounts_completion: 0,
    overall_completion: 0,
    ...overrides,
  };
}

describe("operational lifecycle readiness", () => {
  it("does not use tentative as the next normal milestone from enquiry", () => {
    const readiness = buildLifecycleReadiness(event({
      status: "enquiry",
      event_type: "Free Event",
      approval_status: "not_required",
      confirmation_status: "signed_received",
    }));
    const tentative = readiness.actions.find((a) => a.status === "tentative");

    expect(tentative?.allowed).toBe(true);
    expect(tentative?.recommended).toBe(false);
    expect(readiness.nextAction?.status).toBe("confirmed");
  });

  it("points VFH enquiries to approval before confirmation", () => {
    const readiness = buildLifecycleReadiness(event({
      status: "enquiry",
      event_type: "VFH",
      approval_status: "received",
      confirmation_status: "none",
    }));

    expect(readiness.nextAction?.status).toBe("approved");
  });

  it("shows blockers instead of allowing silent confirmation", () => {
    const readiness = buildLifecycleReadiness(event({ status: "tentative" }));
    const confirm = readiness.actions.find((a) => a.status === "confirmed");

    expect(confirm?.allowed).toBe(false);
    expect(confirm?.blockers).toEqual([
      "Confirmation letter must be made.",
      "VFH approval must be received or approved.",
    ]);
  });

  it("walks confirmation blockers in order", () => {
    expect(blockersForTransition(event({ confirmation_status: "none" }), "confirmed")).toContain("Confirmation letter must be made.");
    expect(blockersForTransition(event({ confirmation_status: "made" }), "confirmed")).toContain("Confirmation letter must be couriered.");
    expect(blockersForTransition(event({ confirmation_status: "couriered" }), "confirmed")).toContain("Signed confirmation must be received.");
  });

  it("allows confirmation once approval and signed confirmation are present", () => {
    const readiness = buildLifecycleReadiness(event({
      status: "approved",
      approval_status: "received",
      confirmation_status: "signed_received",
    }));
    const confirm = readiness.actions.find((a) => a.status === "confirmed");

    expect(readiness.canConfirm).toBe(true);
    expect(confirm?.allowed).toBe(true);
    expect(confirm?.recommended).toBe(true);
  });

  it("does not recommend regret when confirmation is blocked", () => {
    const readiness = buildLifecycleReadiness(event({
      status: "approved",
      approval_status: "received",
      confirmation_status: "none",
    }));
    const regret = readiness.actions.find((a) => a.status === "regret");

    expect(readiness.nextAction).toBeNull();
    expect(regret?.allowed).toBe(true);
    expect(regret?.recommended).toBe(false);
  });

  it("skips the approved milestone for non-VFH events", () => {
    const readiness = buildLifecycleReadiness(event({
      status: "tentative",
      event_type: "FE",
      approval_status: "not_required",
      confirmation_status: "none",
    }));
    const approved = readiness.actions.find((a) => a.status === "approved");
    const confirm = readiness.actions.find((a) => a.status === "confirmed");

    expect(approved).toBeUndefined();
    expect(confirm?.allowed).toBe(false);
    expect(confirm?.blockers).toEqual(["Confirmation letter must be made."]);
  });

  it("does not recalculate completion when an event already has its checklist", async () => {
    const calls: string[] = [];
    const db = {
      prepare(sql: string) {
        calls.push(sql);
        return {
          bind() {
            return this;
          },
          async first() {
            if (sql.includes("FROM events WHERE id = ?")) return { id: "ev_test", event_type: "EE" };
            return null;
          },
          async all() {
            if (sql.includes("FROM checklist_definitions cd")) return { results: [] };
            return { results: [] };
          },
          async run() {
            throw new Error("Existing checklist reads should not write to the database");
          },
        };
      },
    } as unknown as D1Database;

    await ensureChecklistForEvent(db, "ev_test");

    expect(calls.some((sql) => sql.includes("UPDATE events SET ops_completion"))).toBe(false);
  });
});
