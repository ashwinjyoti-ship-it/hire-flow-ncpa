import { describe, expect, it } from "vitest";
import { blockersForTransition, buildLifecycleReadiness, ensureChecklistForEvent, runOperationalJobs, syncEventReferenceChecklist, taskRulesCompletedByLifecycleTransition, type EventLifecycleRow } from "../lib/operations";

function event(overrides: Partial<EventLifecycleRow>): EventLifecycleRow {
  return {
    id: "ev_test",
    title: "Lifecycle Test",
    status: "tentative",
    event_type: "VFH",
    approval_status: "sent",
    confirmation_status: "none",
    // Default: financials gate satisfied (costing = Yes + payment = Completed)
    // so tests about other parts of the gate aren't cluttered with finance
    // blockers. Tests that care about the financials gate override these.
    costing_email: "Yes",
    payment_status: "Completed",
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

  it("requires costing email = Yes and payment = Completed before confirming", () => {
    // Costing = No → costing blocker.
    expect(blockersForTransition(event({ costing_email: "No", confirmation_status: "signed_received", approval_status: "not_required" }), "confirmed"))
      .toContain("Costing email must be sent.");
    // Payment incomplete → payment blocker.
    expect(blockersForTransition(event({ payment_status: "Incomplete", confirmation_status: "signed_received", approval_status: "not_required" }), "confirmed"))
      .toContain("Payment must be completed.");
    // Both satisfied → no financials blockers.
    const blockers = blockersForTransition(event({ costing_email: "Yes", payment_status: "Completed", confirmation_status: "signed_received", approval_status: "not_required" }), "confirmed");
    expect(blockers).not.toContain("Costing email must be sent.");
    expect(blockers).not.toContain("Payment must be completed.");
    expect(blockers).not.toContain("Amount received must be entered.");
  });

  it("does not block VFH confirmation when approval is Not Required", () => {
    // VFH event, approval marked Not Required, financials + signed confirmation
    // done → no approval blocker, confirmation is allowed.
    const blockers = blockersForTransition(event({
      approval_status: "not_required",
      confirmation_status: "signed_received",
    }), "confirmed");
    expect(blockers).not.toContain("VFH approval must be received or approved.");
  });

  it("still requires VFH approval when approval is marked Required", () => {
    const blockers = blockersForTransition(event({
      approval_status: "pending",
      confirmation_status: "signed_received",
    }), "confirmed");
    expect(blockers).toContain("VFH approval must be received or approved.");
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

  it("completes stale lifecycle tasks as events advance", () => {
    expect(taskRulesCompletedByLifecycleTransition("enquiry", "approved")).toEqual(["approval_followup"]);
    expect(taskRulesCompletedByLifecycleTransition("enquiry", "confirmed")).toEqual(["approval_followup", "confirmation_letter"]);
    expect(taskRulesCompletedByLifecycleTransition("approved", "confirmed")).toEqual(["approval_followup", "confirmation_letter"]);
    expect(taskRulesCompletedByLifecycleTransition("confirmed", "cancelled")).toEqual([]);
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

  it("still syncs event-reference rows for an event whose checklist is already seeded", async () => {
    // Regression (Ankh): an existing event already has all its checklist rows, so
    // the definitions INSERT finds nothing to add. The reference-field sync must
    // still run — otherwise the Operations tab stays blank for every event
    // created before the sync landed. Here `results` from checklist_definitions
    // is empty (already seeded), but the reference UPDATE must still fire.
    const calls: string[] = [];
    const runs: string[] = [];
    const db = {
      prepare(sql: string) {
        calls.push(sql);
        return {
          bind() {
            return this;
          },
          async first() {
            if (sql.includes("FROM events WHERE id = ?")) return { id: "ev_test", event_type: "EE" };
            // syncEventReferenceChecklist reads the event row.
            if (sql.includes("SELECT id, title, event_type, description FROM events")) {
              return { id: "ev_test", title: "Ankh", event_type: "EE", description: "Hindi play" };
            }
            return null;
          },
          async all() {
            if (sql.includes("FROM checklist_definitions cd")) return { results: [] };
            if (sql.includes("SELECT venue FROM venue_bookings")) return { results: [{ venue: "JBT" }] };
            return { results: [] };
          },
          async run() {
            const sql = calls[calls.length - 1] ?? "";
            runs.push(sql);
            // No new checklist definition rows should be inserted for an
            // already-seeded event.
            if (sql.includes("INSERT OR IGNORE INTO checklist_items")) {
              throw new Error("should not re-insert seeded checklist rows");
            }
            return { success: true };
          },
        };
      },
    } as unknown as D1Database;

    await ensureChecklistForEvent(db, "ev_test");

    // The reference sync UPDATEs must have fired even though no new rows were
    // inserted.
    expect(runs.some((sql) => sql.startsWith("UPDATE checklist_items") && sql.includes("field_key = ?"))).toBe(true);
  });

  it("creates a post-show accounts reminder when the file has not been sent", async () => {
    const inserts: Array<{ sql: string; binds: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        const statement = {
          binds: [] as unknown[],
          bind(...values: unknown[]) {
            this.binds = values;
            return this;
          },
          async all() {
            if (sql.includes("cd.triggers_task IS NOT NULL")) return { results: [] };
            if (sql.includes("JOIN checklist_items ci ON ci.event_id = e.id")) {
              return {
                results: [{
                  event_id: "ev_after_show",
                  event_end_date: "2026-07-06",
                  event_start_date: "2026-07-05",
                  checklist_item_id: "cli_file_sent",
                }],
              };
            }
            if (sql.includes("FROM tasks t")) return { results: [] };
            return { results: [] };
          },
          async run() {
            if (sql.includes("INSERT OR IGNORE INTO tasks")) {
              inserts.push({ sql, binds: this.binds });
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 1 } };
          },
        };
        return statement;
      },
    } as unknown as D1Database;

    const result = await runOperationalJobs(db);

    expect(result.tasks).toBe(1);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.sql).toContain("Send file to accounts");
    expect(inserts[0]?.binds).toContain("ev_after_show");
    expect(inserts[0]?.binds).toContain("cli_file_sent");
    expect(inserts[0]?.binds).toContain("2026-07-07");
  });
});

describe("event reference checklist sync", () => {
  // Regression ("Ankh"): the Operations tab reads event_name/event_type/
  // nature_of_event/venue from checklist_items.value, which was seeded NULL at
  // create time. The event form's own data must be mirrored into those rows.

  type Upd = { sql: string; binds: unknown[] };

  function buildDb(opts: { title: string; eventType: string | null; description: string | null; venues: string[]; manualFieldKey?: string; manualValue?: string }) {
    const updates: Upd[] = [];
    const db = {
      prepare(sql: string) {
        const statement = {
          binds: [] as unknown[],
          bind(...values: unknown[]) { this.binds = values; return this; },
          async first() {
            if (sql.includes("SELECT id, title, event_type, description FROM events")) {
              return { id: "ev_ankh", title: opts.title, event_type: opts.eventType, description: opts.description };
            }
            return null;
          },
          async all() {
            if (sql.includes("SELECT venue FROM venue_bookings")) {
              return { results: opts.venues.map((v) => ({ venue: v })) };
            }
            // recalculateEventCompletion reads checklist_items — return empty so
            // completion stays at 0 and the UPDATE is a no-op we can ignore.
            if (sql.includes("FROM checklist_items ci")) return { results: [] };
            return { results: [] };
          },
          async run() {
            if (sql.startsWith("UPDATE checklist_items")) {
              updates.push({ sql, binds: [...this.binds] });
              return { success: true };
            }
            return { success: true };
          },
        };
        return statement;
      },
    } as unknown as D1Database;
    return { db, updates };
  }

  it("mirrors title/type/description/venue into the empty reference checklist rows", async () => {
    const { db, updates } = buildDb({
      title: "Ankh",
      eventType: "EE",
      description: "Hindi play, ticketed event",
      venues: ["JBT", "TATA"],
    });

    await syncEventReferenceChecklist(db, "ev_ankh");

    const fieldUpdates = updates.map((u) => u.binds[u.binds.length - 1]);
    expect(fieldUpdates).toContain("event_name");
    expect(fieldUpdates).toContain("event_type");
    expect(fieldUpdates).toContain("nature_of_event");
    expect(fieldUpdates).toContain("venue");
    const venueUpd = updates.find((u) => u.binds[u.binds.length - 1] === "venue");
    expect(venueUpd?.binds[0]).toBe("JBT, TATA");
    const nameUpd = updates.find((u) => u.binds[u.binds.length - 1] === "event_name");
    expect(nameUpd?.binds[0]).toBe("Ankh");
    const natureUpd = updates.find((u) => u.binds[u.binds.length - 1] === "nature_of_event");
    expect(natureUpd?.binds[0]).toBe("Hindi play, ticketed event");
    // Only empty rows are written.
    for (const u of updates) {
      expect(u.sql).toContain("(value IS NULL OR TRIM(value) = '')");
    }
  });

  it("does not write for fields whose source is empty (no description => no nature_of_event update)", async () => {
    const { db, updates } = buildDb({
      title: "Untitled",
      eventType: null,
      description: null,
      venues: [],
    });

    await syncEventReferenceChecklist(db, "ev_ankh");

    const fieldUpdates = updates.map((u) => u.binds[u.binds.length - 1]);
    // Only title survives (type/description/venue sources are empty).
    expect(fieldUpdates).toEqual(["event_name"]);
  });
});
