import { describe, expect, it } from "vitest";
import { blockersForTransition, buildLifecycleReadiness, ensureChecklistForEvent, itemStatusForValue, maybeCreateTaskForChecklistItem, reconcileFileToAccountsReminderForEvent, reconcileTasksForLifecycleTransition, syncAdditionalRequirementsChecklist, syncApprovalDependentChecklist, syncEventReferenceChecklist, syncPocChecklist, syncPocFromChecklistItem, mergePocRequirementsForRead, syncRequirementsFromChecklistItem, taskRulesCompletedByLifecycleTransition, type ChecklistItemRow, type EventLifecycleRow } from "../lib/operations";
import { CHECKLIST_DEFINITIONS } from "../../scripts/seed/checklist-definitions";

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
          async first() {
            // No custom checklist intervals stored → defaults (1 day after show).
            if (sql.includes("FROM app_settings")) return null;
            if (sql.includes("JOIN checklist_items ci")) {
              return {
                event_id: "ev_after_show",
                event_status: "confirmed",
                event_end_date: "2026-07-06",
                event_start_date: "2026-07-05",
                event_owner_id: null,
                checklist_item_id: "cli_file_sent",
                file_sent_value: null,
              };
            }
            return null;
          },
          async all() {
            return { results: [] };
          },
          async run() {
            if (sql.includes("INSERT INTO tasks")) {
              inserts.push({ sql, binds: this.binds });
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 1 } };
          },
        };
        return statement;
      },
    } as unknown as D1Database;

    const result = await reconcileFileToAccountsReminderForEvent(db, "ev_after_show", "2026-07-12");

    expect(result).toBe(1);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.sql).toContain("Send file to accounts");
    expect(inserts[0]?.binds).toContain("ev_after_show");
    expect(inserts[0]?.binds).toContain("cli_file_sent");
    expect(inserts[0]?.binds).toContain("2026-07-07");
  });
});

describe("checklist task date synchronization", () => {
  it("updates an existing automatic task to the current source date", async () => {
    const writes: Array<{ sql: string; binds: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        const statement = {
          binds: [] as unknown[],
          bind(...values: unknown[]) { this.binds = values; return this; },
          async first() {
            if (sql.includes("FROM app_settings")) return null;
            if (sql.includes("SELECT event_owner_id")) return { event_owner_id: null };
            return null;
          },
          async run() {
            writes.push({ sql, binds: [...this.binds] });
            return { meta: { changes: 1 } };
          },
        };
        return statement;
      },
    } as unknown as D1Database;
    const item = {
      id: "cli_technical",
      event_id: "ev_foundation_day",
      definition_id: "def_technical",
      module: "operations",
      section: "Technical Meeting & Minutes",
      field_key: "technical_meeting_date",
      label: "Technical Meeting Date",
      status: "completed",
      value: "2026-06-09",
      due_date: "2026-06-09",
      completed_at: null,
      completed_by: null,
      last_updated_at: null,
      last_updated_by: null,
      field_type: "date",
      options: null,
      is_computed: 0,
      triggers_task: JSON.stringify({ rule: "technical_meeting", title: "Technical Meeting", due_after_days: 0 }),
      visibility_rule: null,
      sort_order: 0,
    } satisfies ChecklistItemRow;

    await maybeCreateTaskForChecklistItem(db, item, "user_1");

    const taskWrite = writes.find((write) => write.sql.includes("INSERT INTO tasks"));
    expect(taskWrite?.sql).toContain("ON CONFLICT(idempotency_key) DO UPDATE");
    expect(taskWrite?.binds).toContain("2026-06-09");
  });
});

describe("task lifecycle reconciliation", () => {
  it("cancels actionable tasks when an event becomes terminal", async () => {
    const writes: Array<{ sql: string; binds: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        return {
          binds: [] as unknown[],
          bind(...values: unknown[]) { this.binds = values; return this; },
          async run() { writes.push({ sql, binds: [...this.binds] }); return { meta: { changes: 2 } }; },
        };
      },
    } as unknown as D1Database;

    await reconcileTasksForLifecycleTransition(db, "ev_cancelled", "confirmed", "cancelled", "user_1");

    expect(writes[0]?.sql).toContain("SET status = 'cancelled'");
    expect(writes[0]?.binds).toContain("Cancelled automatically because event became cancelled.");
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

describe("checklist item status from value", () => {
  // A checklist field is "not done" at its negative default; it only counts as
  // done once the user marks a positive value. Regression: negative defaults
  // used to show as "In progress".
  it("treats negative/placeholder dropdown defaults as not_started", () => {
    // "Not Required" is intentionally excluded — it means the item does not
    // apply, so it resolves to not_applicable (excluded from completion).
    for (const v of ["No", "Not Sent", "Incomplete", "Pending", "Awaiting", "Requested", "Open", "Not Ready"]) {
      expect(itemStatusForValue({ field_type: "dropdown", value: v })).toBe("not_started");
    }
    expect(itemStatusForValue({ field_type: "status", value: "no" })).toBe("not_started");
  });

  it("treats positive/done dropdown values as completed", () => {
    for (const v of ["Yes", "Sent", "Completed", "Received", "Approved", "Ready", "Applicable"]) {
      expect(itemStatusForValue({ field_type: "dropdown", value: v })).toBe("completed");
    }
  });

  it("treats empty and not-applicable values correctly", () => {
    expect(itemStatusForValue({ field_type: "dropdown", value: null })).toBe("not_started");
    expect(itemStatusForValue({ field_type: "dropdown", value: "" })).toBe("not_started");
    expect(itemStatusForValue({ field_type: "dropdown", value: "Not Applicable" })).toBe("not_applicable");
    expect(itemStatusForValue({ field_type: "dropdown", value: "N/A" })).toBe("not_applicable");
    expect(itemStatusForValue({ field_type: "dropdown", value: "No Applicable" })).toBe("not_applicable");
  });

  it("a non-default, non-done dropdown value stays in_progress", () => {
    // e.g. a custom intermediate choice that is neither a known default nor done.
    expect(itemStatusForValue({ field_type: "dropdown", value: "Partially done" })).toBe("in_progress");
  });

  it("keeps future date work in progress until the date is reached", () => {
    expect(itemStatusForValue({ field_type: "date", value: "2026-07-20" }, "2026-07-12")).toBe("in_progress");
    expect(itemStatusForValue({ field_type: "date", value: "2026-07-12" }, "2026-07-12")).toBe("completed");
    expect(itemStatusForValue({ field_type: "date", value: "2026-07-01" }, "2026-07-12")).toBe("completed");
  });
});

describe("additional requirements <-> checklist sync", () => {
  // The event form (events.requirements JSON) and the Operations checklist
  // (checklist_items) must round-trip. Forward map: form value ->
  // checklist Required/Not Required. Reverse map: checklist value -> form
  // vocabulary. Sound is forward-only (free text the checklist can't represent).

  // A mock D1Database. Forward sync updates checklist_items; reverse sync
  // updates events.requirements. Both call recalculateEventCompletion, whose
  // checklist_items reads return empty so completion stays 0 (a no-op UPDATE).
  type Upd = { sql: string; binds: unknown[] };
  function buildReqDb(eventsRequirements: Record<string, unknown> | null, venueRequirements: Array<Record<string, unknown> | null> = []) {
    const updates: Upd[] = [];
    const db = {
      prepare(sql: string) {
        const statement = {
          binds: [] as unknown[],
          bind(...values: unknown[]) { this.binds = values; return this; },
          async first() {
            // Both sync functions SELECT requirements FROM events.
            if (sql.includes("SELECT requirements FROM events")) {
              return { requirements: eventsRequirements ? JSON.stringify(eventsRequirements) : null };
            }
            return null;
          },
          async all() {
            if (sql.includes("FROM checklist_items ci")) return { results: [] };
            if (sql.includes("SELECT requirements FROM venue_bookings") || sql.includes("SELECT id, requirements FROM venue_bookings")) {
              return {
                results: venueRequirements.map((reqs, index) => ({
                  id: `vb_${index}`,
                  requirements: reqs ? JSON.stringify(reqs) : null,
                })),
              };
            }
            return { results: [] };
          },
          async run() {
            updates.push({ sql, binds: [...this.binds] });
            return { success: true };
          },
        };
        return statement;
      },
    } as unknown as D1Database;
    return { db, updates };
  }

  describe("forward: syncAdditionalRequirementsChecklist", () => {
    it("maps dropdown form values to Required/Not Required, writing each row", async () => {
      const { db, updates } = buildReqDb({
        // Yes-vocabulary fields
        digital_standee: "Yes", car_display: "Yes", bike_display: "Yes",
        stalls: "Yes", telecasting_media: "Yes",
        // Inverted vocabulary
        orchestra_pit_chairs: "Keep",
        // Already Required/Not Required
        liquor_licence: "Required",
        // Free-text -> Required when non-empty
        sound: "8-channel PA",
        // Now a Yes/No dropdown (was free text)
        piano_required: "Yes",
        // Passthrough
        crew_cards: "12", licenses: "PPL, IPRS",
      });

      await syncAdditionalRequirementsChecklist(db, "ev_ankh");

      const byField = new Map(updates
        .filter((u) => u.sql.startsWith("UPDATE checklist_items"))
        .map((u) => [u.binds[u.binds.length - 1] as string, u.binds[0] as string]));
      expect(byField.get("req_digital_standee")).toBe("Required");
      expect(byField.get("req_car_display")).toBe("Required");
      expect(byField.get("req_orchestra_pit_chairs")).toBe("Required");
      expect(byField.get("req_liquor_license")).toBe("Required");
      expect(byField.get("req_sound")).toBe("Required");
      expect(byField.get("req_piano")).toBe("Required");
      expect(byField.get("no_of_crew_cards")).toBe("12");
      expect(byField.get("licenses")).toBe("PPL, IPRS");
    });

    it("aggregates requirements across venue bookings when events.requirements is empty", async () => {
      const { db, updates } = buildReqDb(null, [
        { piano_required: "No", sound: "" },
        { piano_required: "Yes", sound: "Line array" },
      ]);

      await syncAdditionalRequirementsChecklist(db, "ev_ankh");

      const byField = new Map(updates
        .filter((u) => u.sql.startsWith("UPDATE checklist_items"))
        .map((u) => [u.binds[u.binds.length - 1] as string, u.binds[0] as string]));
      expect(byField.get("req_piano")).toBe("Required");
      expect(byField.get("req_sound")).toBe("Required");
    });

    it("maps negative/empty form values: No/Remove -> Not Required, blank -> skip", async () => {
      const { db, updates } = buildReqDb({
        digital_standee: "No", car_display: "No",
        orchestra_pit_chairs: "Remove",
        liquor_licence: "Not Required",
        piano_required: "No",
        crew_cards: "12", // set, should still write
        // bike_display / stalls / telecasting_media / sound / licenses omitted entirely
      });

      await syncAdditionalRequirementsChecklist(db, "ev_ankh");

      const byField = new Map(updates
        .filter((u) => u.sql.startsWith("UPDATE checklist_items"))
        .map((u) => [u.binds[u.binds.length - 1] as string, u.binds[0] as string]));
      expect(byField.get("req_digital_standee")).toBe("Not Required");
      expect(byField.get("req_car_display")).toBe("Not Required");
      expect(byField.get("req_orchestra_pit_chairs")).toBe("Not Required");
      expect(byField.get("req_liquor_license")).toBe("Not Required");
      expect(byField.get("req_piano")).toBe("Not Required");
      expect(byField.get("no_of_crew_cards")).toBe("12");
      // Omitted form keys are "silent" and must not produce a checklist write.
      expect(byField.has("req_bike_display")).toBe(false);
      expect(byField.has("req_stalls")).toBe(false);
      expect(byField.has("req_telecasting_media")).toBe(false);
      expect(byField.has("req_sound")).toBe(false);
      expect(byField.has("licenses")).toBe(false);
    });
  });

  describe("reverse: syncRequirementsFromChecklistItem", () => {
    it("maps checklist Required/Not Required back into the form vocabulary", async () => {
      const { db, updates } = buildReqDb({ existing_field: "keep me" });

      await syncRequirementsFromChecklistItem(db, "ev_ankh", "req_car_display", "Required");

      // Single UPDATE events SET requirements = ? ...; binds[0] is the JSON.
      const evUpd = updates.find((u) => u.sql.startsWith("UPDATE events"));
      expect(evUpd).toBeDefined();
      const written = JSON.parse(evUpd!.binds[0] as string) as Record<string, unknown>;
      expect(written.car_display).toBe("Yes");
      // Existing keys must survive the read-modify-write.
      expect(written.existing_field).toBe("keep me");
    });

    it("handles Keep/Remove and liquor vocabulary, plus passthrough fields", async () => {
      const cases: Array<[string, string | null, string, string]> = [
        ["req_orchestra_pit_chairs", "Required", "orchestra_pit_chairs", "Keep"],
        ["req_orchestra_pit_chairs", "Not Required", "orchestra_pit_chairs", "Remove"],
        ["req_liquor_license", "Required", "liquor_licence", "Required"],
        ["req_liquor_license", "Not Required", "liquor_licence", "Not Required"],
        ["req_piano", "Required", "piano_required", "Yes"],
        ["req_piano", "Not Required", "piano_required", "No"],
        ["req_telecasting_media", "Not Required", "telecasting_media", "No"],
        ["no_of_crew_cards", "42", "crew_cards", "42"],
        ["licenses", "PPL, IPRS", "licenses", "PPL, IPRS"],
      ];
      for (const [fieldKey, value, formKey, expected] of cases) {
        const { db, updates } = buildReqDb({});
        await syncRequirementsFromChecklistItem(db, "ev_ankh", fieldKey, value);
        const evUpd = updates.find((u) => u.sql.startsWith("UPDATE events"));
        expect(evUpd).toBeDefined();
        const written = JSON.parse(evUpd!.binds[0] as string) as Record<string, unknown>;
        expect(written[formKey]).toBe(expected);
      }
    });

    it("is a no-op for req_sound (form->checklist only) and unknown fields", async () => {
      const { db, updates } = buildReqDb({ sound: "8-channel PA" });

      await syncRequirementsFromChecklistItem(db, "ev_ankh", "req_sound", "Not Required");
      await syncRequirementsFromChecklistItem(db, "ev_ankh", "event_name", "Some Title");

      // No UPDATE events should be issued.
      expect(updates.find((u) => u.sql.startsWith("UPDATE events"))).toBeUndefined();
    });

    it("is a no-op when a dropdown value is neither Required nor Not Required", async () => {
      const { db, updates } = buildReqDb({});
      await syncRequirementsFromChecklistItem(db, "ev_ankh", "req_car_display", null);
      await syncRequirementsFromChecklistItem(db, "ev_ankh", "req_car_display", "");
      await syncRequirementsFromChecklistItem(db, "ev_ankh", "req_car_display", "Pending");
      expect(updates.find((u) => u.sql.startsWith("UPDATE events"))).toBeUndefined();
    });

    it("survives a malformed requirements JSON (starts fresh, still writes)", async () => {
      const updates: Upd[] = [];
      const db = {
        prepare(sql: string) {
          const statement = {
            binds: [] as unknown[],
            bind(...values: unknown[]) { this.binds = values; return this; },
            async first() {
              if (sql.includes("SELECT requirements FROM events")) return { requirements: "{not json" };
              return null;
            },
            async all() { return { results: [] }; },
            async run() {
              updates.push({ sql, binds: [...this.binds] });
              return { success: true };
            },
          };
          return statement;
        },
      } as unknown as D1Database;

      await syncRequirementsFromChecklistItem(db, "ev_ankh", "req_car_display", "Required");
      // Should not throw; parse failed so we start from {} and still write the
      // single mirrored key.
      const evUpd = updates.find((u) => u.sql.startsWith("UPDATE events"));
      expect(evUpd).toBeDefined();
      const written = JSON.parse(evUpd!.binds[0] as string) as Record<string, unknown>;
      expect(written).toEqual({ car_display: "Yes" });
    });
  });

  describe("round-trip stability", () => {
    // For each Yes/No-style field, checklist -> form -> checklist must yield the
    // same checklist value. This is the invariant that prevents a slow drift
    // when the user edits the checklist, then saves the event form.
    it("checklist -> form -> checklist is idempotent for every mapped dropdown", async () => {
      const roundTrip: Array<[string, string, string, string[]]> = [
        // [fieldKey, checklistVal, formKey, forward yesValues]
        ["req_piano", "Required", "piano_required", ["Yes"]],
        ["req_piano", "Not Required", "piano_required", ["Yes"]],
        ["req_liquor_license", "Required", "liquor_licence", ["Required"]],
        ["req_liquor_license", "Not Required", "liquor_licence", ["Required"]],
        ["req_orchestra_pit_chairs", "Required", "orchestra_pit_chairs", ["Keep"]],
        ["req_orchestra_pit_chairs", "Not Required", "orchestra_pit_chairs", ["Keep"]],
        ["req_digital_standee", "Required", "digital_standee", ["Yes"]],
        ["req_digital_standee", "Not Required", "digital_standee", ["Yes"]],
        ["req_car_display", "Required", "car_display", ["Yes"]],
        ["req_car_display", "Not Required", "car_display", ["Yes"]],
        ["req_bike_display", "Required", "bike_display", ["Yes"]],
        ["req_bike_display", "Not Required", "bike_display", ["Yes"]],
        ["req_stalls", "Required", "stalls", ["Yes"]],
        ["req_stalls", "Not Required", "stalls", ["Yes"]],
        ["req_telecasting_media", "Required", "telecasting_media", ["Yes"]],
        ["req_telecasting_media", "Not Required", "telecasting_media", ["Yes"]],
      ];
      for (const [fieldKey, checklistVal, _formKey, yesValues] of roundTrip) {
        // Reverse: checklist value -> form value.
        const revDb = buildReqDb({});
        await syncRequirementsFromChecklistItem(revDb.db, "ev_ankh", fieldKey, checklistVal);
        const revWritten = JSON.parse(
          revDb.updates.find((u) => u.sql.startsWith("UPDATE events"))!.binds[0] as string,
        ) as Record<string, unknown>;
        const formValue = revWritten[_formKey] as string;

        // Forward: form value -> checklist value.
        const fwdDb = buildReqDb({ [_formKey]: formValue });
        await syncAdditionalRequirementsChecklist(fwdDb.db, "ev_ankh");
        const fwdWritten = fwdDb.updates
          .filter((u) => u.sql.startsWith("UPDATE checklist_items"))
          .map((u) => u.binds[u.binds.length - 1] as string);
        expect(fwdWritten).toContain(fieldKey);
        const fwdValue = fwdDb.updates
          .filter((u) => u.sql.startsWith("UPDATE checklist_items"))
          .map((u) => u.binds[0] as string);
        expect(fwdValue).toContain(checklistVal);
        // Sanity: yesValues membership reproduces the original derivation.
        expect(yesValues.includes(formValue)).toBe(checklistVal === "Required");
      }
    });
  });
});

describe("VFH approval Not Required skips dependent checklist fields", () => {
  it("seeds visibility_rule so dependents only show when Approval Required? = Required", () => {
    const byKey = Object.fromEntries(CHECKLIST_DEFINITIONS.map((d) => [d.field_key, d]));
    for (const key of ["approval_sent_on", "approval_received_on", "genre_head"]) {
      expect(byKey[key]?.visibility_rule).toBe("onlyWhen(approval_required == Required)");
      expect(byKey[key]?.vfh_only).toBe(true);
    }
    expect(byKey.approval_required?.visibility_rule).toBeUndefined();
  });

  it("marks Approval Sent/Received and Genre Head not_applicable when Not Required", async () => {
    const updates: Array<{ sql: string; binds: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        const statement = {
          binds: [] as unknown[],
          bind(...values: unknown[]) {
            this.binds = values;
            return this;
          },
          async all() {
            return { results: [] };
          },
          async run() {
            updates.push({ sql, binds: [...this.binds] });
            return { success: true };
          },
        };
        return statement;
      },
    } as unknown as D1Database;

    await syncApprovalDependentChecklist(db, "ev_vfh", "Not Required");

    expect(updates).toHaveLength(1);
    expect(updates[0]?.sql).toContain("status = 'not_applicable'");
    expect(updates[0]?.sql).toContain("approval_sent_on");
    expect(updates[0]?.sql).toContain("approval_received_on");
    expect(updates[0]?.sql).toContain("genre_head");
    expect(updates[0]?.binds[1]).toBe("ev_vfh");
  });

  it("re-derives dependent statuses from values when Approval becomes Required", async () => {
    const updates: Array<{ sql: string; binds: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        const statement = {
          binds: [] as unknown[],
          bind(...values: unknown[]) {
            this.binds = values;
            return this;
          },
          async all() {
            if (sql.includes("approval_sent_on")) {
              return {
                results: [
                  { id: "cli_sent", value: null, field_type: "date", is_computed: 0 },
                  { id: "cli_recv", value: "2026-07-01", field_type: "date", is_computed: 0 },
                  { id: "cli_genre", value: null, field_type: "text", is_computed: 0 },
                ],
              };
            }
            return { results: [] };
          },
          async run() {
            updates.push({ sql, binds: [...this.binds] });
            return { success: true };
          },
        };
        return statement;
      },
    } as unknown as D1Database;

    await syncApprovalDependentChecklist(db, "ev_vfh", "Required");

    expect(updates).toHaveLength(3);
    const byId = Object.fromEntries(updates.map((u) => [u.binds[2], u.binds[0]]));
    expect(byId.cli_sent).toBe("not_started");
    expect(byId.cli_recv).toBe("completed");
    expect(byId.cli_genre).toBe("not_started");
  });
});

describe("point of contact <-> checklist sync", () => {
  type Upd = { sql: string; binds: unknown[] };

  it("copies POC form values into checklist rows", async () => {
    const updates: Upd[] = [];
    const db = {
      prepare(sql: string) {
        const statement = {
          binds: [] as unknown[],
          bind(...values: unknown[]) { this.binds = values; return this; },
          async first() {
            if (sql.includes("SELECT requirements FROM events")) {
              return { requirements: JSON.stringify({ poc_name: "Karina Arora", vendor_registration_form: "No Applicable" }) };
            }
            return null;
          },
          async all() {
            if (sql.includes("FROM checklist_definitions")) {
              return {
                results: [
                  { field_key: "poc_name", field_type: "text" },
                  { field_key: "vendor_registration_form", field_type: "dropdown" },
                ],
              };
            }
            if (sql.includes("FROM checklist_items ci")) return { results: [] };
            return { results: [] };
          },
          async run() {
            updates.push({ sql, binds: [...this.binds] });
            return { success: true };
          },
        };
        return statement;
      },
    } as unknown as D1Database;

    await syncPocChecklist(db, "ev_poc");

    const checklistUpdates = updates.filter((u) => u.sql.includes("UPDATE checklist_items"));
    expect(checklistUpdates).toHaveLength(2);
    expect(checklistUpdates.some((u) => u.binds[0] === "Karina Arora" && u.binds[4] === "poc_name")).toBe(true);
    expect(checklistUpdates.some((u) => u.binds[0] === "No Applicable" && u.binds[1] === "not_applicable")).toBe(true);
  });

  it("mirrors checklist POC edits back into events.requirements", async () => {
    const updates: Upd[] = [];
    const db = {
      prepare(sql: string) {
        const statement = {
          binds: [] as unknown[],
          bind(...values: unknown[]) { this.binds = values; return this; },
          async first() {
            if (sql.includes("SELECT requirements FROM events")) return { requirements: "{}" };
            return null;
          },
          async all() { return { results: [] }; },
          async run() {
            updates.push({ sql, binds: [...this.binds] });
            return { success: true };
          },
        };
        return statement;
      },
    } as unknown as D1Database;

    await syncPocFromChecklistItem(db, "ev_poc", "poc_email", "karina.arora@cathedral-school.com");

    const eventUpdate = updates.find((u) => u.sql.startsWith("UPDATE events"));
    expect(eventUpdate).toBeDefined();
    expect(JSON.parse(eventUpdate!.binds[0] as string)).toEqual({ poc_email: "karina.arora@cathedral-school.com" });
  });

  it("hydrates missing form POC values from checklist on read", async () => {
    const db = {
      prepare(sql: string) {
        const statement = {
          binds: [] as unknown[],
          bind(...values: unknown[]) { this.binds = values; return this; },
          async first() { return null; },
          async all() {
            if (sql.includes("FROM checklist_items")) {
              return {
                results: [
                  { field_key: "poc_name", value: "Karina Arora" },
                  { field_key: "gst_no", value: "27AAATT3454F1ZI" },
                ],
              };
            }
            return { results: [] };
          },
          async run() { return { success: true }; },
        };
        return statement;
      },
    } as unknown as D1Database;

    const merged = await mergePocRequirementsForRead(db, "ev_poc", JSON.stringify({ poc_email: "karina.arora@cathedral-school.com" }));
    expect(merged).toEqual({
      poc_email: "karina.arora@cathedral-school.com",
      poc_name: "Karina Arora",
      gst_no: "27AAATT3454F1ZI",
    });
  });
});
