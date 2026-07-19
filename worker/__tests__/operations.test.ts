import { describe, expect, it } from "vitest";
import { blockersForTransition, buildLifecycleReadiness, ensureChecklistForEvent, itemStatusForValue, maybeCompleteAccountsFileTasks, maybeCreateTaskForChecklistItem, recalculateEventCompletion, reconcileConfirmationLetterAgainstFinancials, reconcileConfirmationLetterDeliveryChain, reconcileFileToAccountsReminderForEvent, reconcileFinancialSequenceForEvent, reconcilePocTaskForEvent, reconcileTasksForLifecycleTransition, syncAdditionalRequirementsChecklist, syncApprovalDependentChecklist, syncEmailerDependentChecklist, syncEventReferenceChecklist, syncInstalmentDependentChecklist, syncNocDependentChecklist, syncOnstageDependentChecklist, syncPocChecklist, syncPocFromChecklistItem, mergePocRequirementsForRead, syncRequirementsFromChecklistItem, syncTdsDependentChecklist, taskRulesCompletedByLifecycleTransition, type ChecklistItemRow, type EventLifecycleRow } from "../lib/operations";
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
    // Costing = No → costing blocker (and payment remains unsatisfied until costing clears).
    expect(blockersForTransition(event({ costing_email: "No", payment_status: "Incomplete", confirmation_status: "signed_received", approval_status: "not_required" }), "confirmed"))
      .toEqual([
        "Costing email must be sent.",
        "Payment must be completed.",
      ]);
    // Payment incomplete → payment blocker.
    expect(blockersForTransition(event({ payment_status: "Incomplete", confirmation_status: "signed_received", approval_status: "not_required" }), "confirmed"))
      .toContain("Payment must be completed.");
    // Both satisfied → no financials blockers.
    const blockers = blockersForTransition(event({ costing_email: "Yes", payment_status: "Completed", confirmation_status: "signed_received", approval_status: "not_required" }), "confirmed");
    expect(blockers).not.toContain("Costing email must be sent.");
    expect(blockers).not.toContain("Payment must be completed.");
    expect(blockers).not.toContain("Amount received must be entered.");
  });

  it("does not treat payment Completed as satisfied while costing email is still No", () => {
    // Invalid stored sequence: Payment Completed + Costing No must keep both
    // financial blockers so fixing costing alone cannot skip payment.
    expect(blockersForTransition(event({
      costing_email: "No",
      payment_status: "Completed",
      confirmation_status: "signed_received",
      approval_status: "not_required",
    }), "confirmed")).toEqual([
      "Costing email must be sent.",
      "Payment must be completed.",
    ]);
  });

  it("resets Completed payment when costing email is still No", async () => {
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
            if (sql.includes("'costing_email', 'proforma_invoice', 'payment_status'")) {
              return {
                results: [
                  { id: "cli_costing", field_key: "costing_email", value: "No" },
                  { id: "cli_proforma", field_key: "proforma_invoice", value: "Not Sent" },
                  { id: "cli_payment", field_key: "payment_status", value: "Completed" },
                ],
              };
            }
            if (sql.includes("FROM checklist_items ci") && sql.includes("module")) {
              return { results: [] };
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

    const healed = await reconcileFinancialSequenceForEvent(db, "ev_fin");
    expect(healed).toBe(true);
    const paymentReset = updates.find((u) => u.sql.includes("UPDATE checklist_items") && u.binds.includes("cli_payment"));
    expect(paymentReset?.binds[0]).toBe("Incomplete");
    expect(paymentReset?.binds[1]).toBe("not_started");
  });

  it("leaves payment alone when costing email is Yes", async () => {
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
            return {
              results: [
                { id: "cli_costing", field_key: "costing_email", value: "Yes" },
                { id: "cli_proforma", field_key: "proforma_invoice", value: "Sent" },
                { id: "cli_payment", field_key: "payment_status", value: "Completed" },
              ],
            };
          },
          async run() {
            updates.push({ sql, binds: [...this.binds] });
            return { success: true };
          },
        };
        return statement;
      },
    } as unknown as D1Database;

    expect(await reconcileFinancialSequenceForEvent(db, "ev_fin")).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it("rolls back Couriered and Signed when financials are incomplete", async () => {
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
            if (sql.includes("'costing_email', 'proforma_invoice', 'payment_status'")) {
              return {
                results: [
                  { field_key: "costing_email", value: "No" },
                  { field_key: "proforma_invoice", value: "Not Sent" },
                  { field_key: "payment_status", value: "Incomplete" },
                ],
              };
            }
            if (sql.includes("confirmation_made")) {
              return {
                results: [
                  { id: "cli_made", field_key: "confirmation_made", value: "Yes" },
                  { id: "cli_couriered", field_key: "confirmation_couriered", value: "2026-07-10" },
                  { id: "cli_signed", field_key: "confirmation_signed_received", value: "Yes" },
                ],
              };
            }
            if (sql.includes("FROM checklist_items ci") && sql.includes("module")) {
              return { results: [] };
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

    expect(await reconcileConfirmationLetterAgainstFinancials(db, "ev_letter")).toBe(true);
    const signedReset = updates.find((u) => u.binds.includes("cli_signed"));
    expect(signedReset?.binds[0]).toBe("No");
    const courieredReset = updates.find((u) => u.binds.includes("cli_couriered"));
    expect(courieredReset?.sql).toContain("value = NULL");
    const statusUpdate = updates.find((u) => u.sql.includes("UPDATE events SET confirmation_status"));
    expect(statusUpdate?.binds[0]).toBe("made");
  });

  it("leaves Couriered and Signed alone when financials are ready", async () => {
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
            return {
              results: [
                { field_key: "costing_email", value: "Yes" },
                { field_key: "proforma_invoice", value: "Not Applicable" },
                { field_key: "payment_status", value: "Completed" },
              ],
            };
          },
          async run() {
            updates.push({ sql, binds: [...this.binds] });
            return { success: true };
          },
        };
        return statement;
      },
    } as unknown as D1Database;

    expect(await reconcileConfirmationLetterAgainstFinancials(db, "ev_letter")).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it("rolls back Signed when Couriered is not set", async () => {
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
            if (sql.includes("FROM checklist_items ci") && sql.includes("module")) {
              return { results: [] };
            }
            return {
              results: [
                { id: "cli_made", field_key: "confirmation_made", value: "Yes" },
                { id: "cli_couriered", field_key: "confirmation_couriered", value: null },
                { id: "cli_signed", field_key: "confirmation_signed_received", value: "Yes" },
              ],
            };
          },
          async run() {
            updates.push({ sql, binds: [...this.binds] });
            return { success: true };
          },
        };
        return statement;
      },
    } as unknown as D1Database;

    expect(await reconcileConfirmationLetterDeliveryChain(db, "ev_letter")).toBe(true);
    const signedReset = updates.find((u) => u.binds.includes("cli_signed"));
    expect(signedReset?.binds[0]).toBe("No");
  });

  it("rolls back Couriered and Signed when Made is No", async () => {
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
            if (sql.includes("FROM checklist_items ci") && sql.includes("module")) {
              return { results: [] };
            }
            return {
              results: [
                { id: "cli_made", field_key: "confirmation_made", value: "No" },
                { id: "cli_couriered", field_key: "confirmation_couriered", value: "2026-07-10" },
                { id: "cli_signed", field_key: "confirmation_signed_received", value: "Yes" },
              ],
            };
          },
          async run() {
            updates.push({ sql, binds: [...this.binds] });
            return { success: true };
          },
        };
        return statement;
      },
    } as unknown as D1Database;

    expect(await reconcileConfirmationLetterDeliveryChain(db, "ev_letter")).toBe(true);
    const courieredReset = updates.find((u) => u.binds.includes("cli_couriered"));
    expect(courieredReset?.sql).toContain("value = NULL");
    const signedReset = updates.find((u) => u.binds.includes("cli_signed"));
    expect(signedReset?.binds[0]).toBe("No");
  });

  it("blocks confirmation when Point of Contact is incomplete", () => {
    const blockers = blockersForTransition(event({
      costing_email: "Yes",
      payment_status: "Completed",
      confirmation_status: "signed_received",
      approval_status: "not_required",
      poc_complete: false,
    }), "confirmed");
    expect(blockers).toContain("POC not filled, cannot confirm.");
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
            if (sql.includes("SELECT status, event_start_date, event_end_date FROM events")) {
              return {
                status: "confirmed",
                event_start_date: "2026-07-05",
                event_end_date: "2026-07-06",
              };
            }
            if (sql.includes("field_key = 'file_closed'")) {
              return { value: null };
            }
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

describe("accounts file ping-pong tasks", () => {
  function accountsItem(overrides: Partial<ChecklistItemRow>): ChecklistItemRow {
    return {
      id: "cli_sent",
      event_id: "ev_accounts",
      definition_id: "def_sent",
      module: "accounts",
      section: "File Tracking",
      field_key: "file_sent_to_accounts",
      label: "File Sent to Accounts — Date",
      status: "completed",
      value: "2026-07-01",
      due_date: "2026-07-01",
      completed_at: null,
      completed_by: null,
      last_updated_at: null,
      last_updated_by: null,
      field_type: "date",
      options: null,
      is_computed: 0,
      triggers_task: JSON.stringify({ rule: "accounts_file", title: "Follow up with Accounts", due_after_days: 3 }),
      visibility_rule: null,
      sort_order: 0,
      ...overrides,
    };
  }

  function buildAccountsDb(tracking: Record<string, string | null>) {
    const writes: Array<{ sql: string; binds: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        const statement = {
          binds: [] as unknown[],
          bind(...values: unknown[]) { this.binds = values; return this; },
          async first() {
            if (sql.includes("FROM app_settings")) return null;
            if (sql.includes("SELECT event_owner_id")) return { event_owner_id: null };
            if (sql.includes("SELECT field_key, value FROM checklist_items")) {
              return null;
            }
            if (sql.includes("SELECT id FROM checklist_items WHERE event_id = ? AND field_key = ?")) {
              const fieldKey = statement.binds[1] as string;
              const id = tracking[`${fieldKey}_id`] ?? `cli_${fieldKey}`;
              return tracking[fieldKey] ? { id } : { id };
            }
            return null;
          },
          async all() {
            if (sql.includes("SELECT field_key, value FROM checklist_items")) {
              return {
                results: Object.entries(tracking)
                  .filter(([key, value]) => !key.endsWith("_id") && value)
                  .map(([field_key, value]) => ({ field_key, value })),
              };
            }
            return { results: [] };
          },
          async run() {
            writes.push({ sql, binds: [...statement.binds] });
            return { meta: { changes: 1 } };
          },
        };
        return statement;
      },
    } as unknown as D1Database;
    return { db, writes };
  }

  it("skips the initial follow-up when Edit 1 is received within 3 days", async () => {
    const { db, writes } = buildAccountsDb({
      file_received_back_edit_1: "2026-07-03",
      file_received_back_edit_1_id: "cli_edit1",
    });
    await maybeCreateTaskForChecklistItem(db, accountsItem({ id: "cli_sent" }), "user_1");
    expect(writes.some((write) => write.sql.includes("INSERT INTO tasks"))).toBe(false);
    expect(writes.some((write) => write.sql.includes("SET status = 'cancelled'"))).toBe(true);
  });

  it("creates a follow-up due 3 days after the file is sent", async () => {
    const { db, writes } = buildAccountsDb({});
    await maybeCreateTaskForChecklistItem(db, accountsItem({ id: "cli_sent" }), "user_1");
    const taskWrite = writes.find((write) => write.sql.includes("INSERT INTO tasks"));
    expect(taskWrite?.binds).toContain("Follow up with Accounts");
    expect(taskWrite?.binds).toContain("2026-07-04");
  });

  it("creates a send-back task due 3 days after Edit 1 is received", async () => {
    const { db, writes } = buildAccountsDb({});
    await maybeCreateTaskForChecklistItem(db, accountsItem({
      id: "cli_edit1",
      field_key: "file_received_back_edit_1",
      label: "File Received Back — Edit 1 — Date",
      value: "2026-07-05",
      due_date: "2026-07-05",
      triggers_task: JSON.stringify({ rule: "accounts_file_send_back", title: "Send file back to Accounts", due_after_days: 3 }),
    }), "user_1");
    const taskWrite = writes.find((write) => write.sql.includes("INSERT INTO tasks"));
    expect(taskWrite?.binds).toContain("Send file back to Accounts");
    expect(taskWrite?.binds).toContain("2026-07-08");
  });

  it("completes the initial follow-up when Edit 1 is recorded", async () => {
    const { db, writes } = buildAccountsDb({
      file_sent_to_accounts: "2026-07-01",
      file_sent_to_accounts_id: "cli_sent",
    });
    await maybeCompleteAccountsFileTasks(db, "ev_accounts", "file_received_back_edit_1", "2026-07-05", "user_1");
    const completeWrite = writes.find((write) => write.sql.includes("SET status = 'completed'"));
    expect(completeWrite?.binds).toContain("cli_sent");
    expect(completeWrite?.binds).toContain("accounts_file");
  });

  it("completes all accounts file tasks when the final file date is entered", async () => {
    const { db, writes } = buildAccountsDb({});
    await maybeCompleteAccountsFileTasks(db, "ev_accounts", "final_file_received", "2026-07-20", "user_1");
    const completeWrites = writes.filter((write) => write.sql.includes("SET status = 'completed'"));
    expect(completeWrites).toHaveLength(2);
    expect(completeWrites[0]?.binds).toContain("accounts_file");
    expect(completeWrites[1]?.binds).toContain("accounts_file_send_back");
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
  // Regression ("Ankh"): the Operations tab reads computed identity rows,
  // which were seeded NULL at
  // create time. The event form's own data must be mirrored into those rows.

  type Upd = { sql: string; binds: unknown[] };

  function buildDb(opts: { title: string; eventType: string | null; description: string | null; venues: string[]; startDate?: string | null; endDate?: string | null }) {
    const updates: Upd[] = [];
    const db = {
      prepare(sql: string) {
        const statement = {
          binds: [] as unknown[],
          bind(...values: unknown[]) { this.binds = values; return this; },
          async first() {
            if (sql.includes("SELECT id, title, event_type, event_start_date, event_end_date FROM events")) {
              return { id: "ev_ankh", title: opts.title, event_type: opts.eventType, event_start_date: opts.startDate ?? null, event_end_date: opts.endDate ?? null };
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

  it("mirrors title/type/date/venue into computed reference checklist rows", async () => {
    const { db, updates } = buildDb({
      title: "Ankh",
      eventType: "EE",
      description: "Hindi play, ticketed event",
      venues: ["JBT", "TATA"],
      startDate: "2026-07-16",
      endDate: "2026-07-17",
    });

    await syncEventReferenceChecklist(db, "ev_ankh");

    const fieldUpdates = updates.map((u) => u.binds[u.binds.length - 1]);
    expect(fieldUpdates).toContain("event_name");
    expect(fieldUpdates).toContain("event_type");
    expect(fieldUpdates).toContain("event_dates");
    expect(fieldUpdates).toContain("venue");
    const venueUpd = updates.find((u) => u.binds[u.binds.length - 1] === "venue");
    expect(venueUpd?.binds[0]).toBe("JBT, TATA");
    const nameUpd = updates.find((u) => u.binds[u.binds.length - 1] === "event_name");
    expect(nameUpd?.binds[0]).toBe("Ankh");
    const datesUpd = updates.find((u) => u.binds[u.binds.length - 1] === "event_dates");
    expect(datesUpd?.binds[0]).toBe("2026-07-16 – 2026-07-17");
    // All identity rows are computed and always mirror the event form.
    for (const u of updates) {
      expect(u.sql).not.toContain("(value IS NULL OR TRIM(value) = '')");
    }
  });

  it("overwrites event_name when the event title is renamed", async () => {
    const { db, updates } = buildDb({
      title: "Renamed Concert",
      eventType: "EE",
      description: "Updated",
      venues: ["JBT"],
    });

    await syncEventReferenceChecklist(db, "ev_ankh");

    const nameUpd = updates.find((u) => u.binds[u.binds.length - 1] === "event_name");
    expect(nameUpd?.binds[0]).toBe("Renamed Concert");
    expect(nameUpd?.sql).not.toContain("(value IS NULL OR TRIM(value) = '')");
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

  it("treats Verified and Captured on form as completed / in progress", () => {
    expect(itemStatusForValue({ field_type: "dropdown", value: "Verified" })).toBe("completed");
    expect(itemStatusForValue({ field_type: "dropdown", value: "Captured on form" })).toBe("in_progress");
    expect(itemStatusForValue({ field_type: "dropdown", value: "Not started" })).toBe("not_started");
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

  it("marks computed timing totals completed when a value is present", () => {
    expect(itemStatusForValue({ field_type: "computed", value: "—", is_computed: 1 })).toBe("not_started");
    expect(itemStatusForValue({ field_type: "computed", value: "2h", is_computed: 1 })).toBe("completed");
  });
});

describe("event completion rollups", () => {
  it("excludes not_applicable checklist items so untouched work does not show fake progress", async () => {
    const completionUpdate: { binds: unknown[] } = { binds: [] };
    const db = {
      prepare(sql: string) {
        return {
          binds: [] as unknown[],
          bind(...values: unknown[]) { this.binds = values; return this; },
          async all() {
            if (!sql.includes("FROM checklist_items ci")) return { results: [] };
            return {
              results: [
                { module: "accounts", status: "not_started", due_date: null, field_key: "final_file_received", value: "No", is_computed: 0, visibility_rule: null },
                { module: "accounts", status: "not_started", due_date: null, field_key: "payment_advice", value: "Awaiting", is_computed: 0, visibility_rule: null },
                { module: "accounts", status: "not_applicable", due_date: null, field_key: "security_deposit_refund", value: "N/A", is_computed: 0, visibility_rule: null },
                { module: "accounts", status: "not_applicable", due_date: null, field_key: "security_deposit_refund", value: "N/A", is_computed: 0, visibility_rule: null },
                { module: "accounts", status: "completed", due_date: null, field_key: "tax_invoice_sent", value: "Sent", is_computed: 0, visibility_rule: null },
                { module: "operations", status: "not_applicable", due_date: null, field_key: "emailer_asked_client", value: null, is_computed: 0, visibility_rule: "onlyWhen(emailer == Yes)" },
                { module: "operations", status: "completed", due_date: null, field_key: "costing_email", value: "Yes", is_computed: 0, visibility_rule: null },
                { module: "operations", status: "not_started", due_date: null, field_key: "payment_status", value: "Incomplete", is_computed: 0, visibility_rule: null },
              ],
            };
          },
          async run() {
            if (sql.includes("UPDATE events SET ops_completion")) {
              completionUpdate.binds = [...this.binds];
            }
            return { success: true };
          },
        };
      },
    } as unknown as D1Database;

    const result = await recalculateEventCompletion(db, "ev_rollup");

    expect(result).toEqual({ operations: 0.5, accounts: 1 / 3, overall: 2 / 5 });
    expect(completionUpdate.binds[0]).toBeCloseTo(0.5);
    expect(completionUpdate.binds[1]).toBeCloseTo(1 / 3);
    expect(completionUpdate.binds[2]).toBeCloseTo(0.4);
  });

  it("returns zero for untouched accounts defaults with only hidden or N/A fields", async () => {
    const db = {
      prepare() {
        return {
          binds: [] as unknown[],
          bind(...values: unknown[]) { this.binds = values; return this; },
          async all() {
            return {
              results: [
                { module: "accounts", status: "not_applicable", due_date: null, field_key: "security_deposit_refund", value: "N/A", is_computed: 0, visibility_rule: null },
                { module: "accounts", status: "not_applicable", due_date: null, field_key: "box_office_collection_refund", value: "N/A", is_computed: 0, visibility_rule: null },
                { module: "accounts", status: "not_applicable", due_date: null, field_key: "tds_certificate_from_client", value: "N.A.", is_computed: 0, visibility_rule: null },
                { module: "accounts", status: "not_applicable", due_date: null, field_key: "tds_received_from_client_date", value: null, is_computed: 0, visibility_rule: "onlyWhen(tds_certificate_from_client == Received)" },
                { module: "accounts", status: "not_started", due_date: null, field_key: "payment_advice", value: "Awaiting", is_computed: 0, visibility_rule: null },
                { module: "accounts", status: "not_started", due_date: null, field_key: "final_file_received", value: "No", is_computed: 0, visibility_rule: null },
              ],
            };
          },
          async run() { return { success: true }; },
        };
      },
    } as unknown as D1Database;

    const result = await recalculateEventCompletion(db, "ev_accounts");
    expect(result.accounts).toBe(0);
  });

  it("excludes hidden instalment dates when Instalment = No", async () => {
    const db = {
      prepare() {
        return {
          binds: [] as unknown[],
          bind(...values: unknown[]) { this.binds = values; return this; },
          async all() {
            return {
              results: [
                { module: "operations", status: "not_started", due_date: null, field_key: "instalment", value: "No", is_computed: 0, visibility_rule: null },
                { module: "operations", status: "not_started", due_date: null, field_key: "installment_1_expected_date", value: null, is_computed: 0, visibility_rule: "onlyWhen(instalment == Yes)" },
                { module: "operations", status: "completed", due_date: null, field_key: "costing_email", value: "Yes", is_computed: 0, visibility_rule: null },
              ],
            };
          },
          async run() { return { success: true }; },
        };
      },
    } as unknown as D1Database;

    const result = await recalculateEventCompletion(db, "ev_instalment");
    // Hidden instalment dates must not count: only Instalment + Costing Email apply.
    expect(result.operations).toBe(0.5);
  });
});

describe("requirements <-> checklist sync", () => {
  type Upd = { sql: string; binds: unknown[] };
  function buildReqDb(
    eventsRequirements: Record<string, unknown> | null,
    venueRequirements: Array<Record<string, unknown> | null> = [],
    checklistValues: Record<string, string | null> = {},
  ) {
    const updates: Upd[] = [];
    const db = {
      prepare(sql: string) {
        const statement = {
          binds: [] as unknown[],
          bind(...values: unknown[]) { this.binds = values; return this; },
          async first() {
            if (sql.includes("SELECT requirements FROM events")) {
              return { requirements: eventsRequirements ? JSON.stringify(eventsRequirements) : null };
            }
            if (sql.includes("SELECT value FROM checklist_items")) {
              const fieldKey = statement.binds[1] as string;
              return { value: checklistValues[fieldKey] ?? null };
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
    it("rolls form cards up into exec_* section rows and syncs Operations Details", async () => {
      const { db, updates } = buildReqDb({
        sound: "8-channel PA",
        light: "LED wash",
        green_rooms_required: "Required",
        catering_required: "Yes",
        catering_provider: "Royal Caterers",
        decorator_required: "Yes",
        decorator_name: "StageCraft",
        parking: "VIP bay",
        digital_standee: "Yes",
        crew_cards: "12",
        licenses_status: "Received",
        licenses: "PPL, IPRS",
        catering_lunch_required: "Yes",
        catering_lunch_pax: "100",
        catering_dinner_required: "Yes",
        catering_dinner_pax: "50",
      });

      await syncAdditionalRequirementsChecklist(db, "ev_ankh");

      const byField = new Map(updates
        .filter((u) => u.sql.startsWith("UPDATE checklist_items"))
        .map((u) => [u.binds[u.binds.length - 1] as string, u.binds[0] as string]));
      expect(byField.get("exec_sound_light")).toBe("Captured on form");
      expect(byField.get("exec_staffing")).toBe("Captured on form");
      expect(byField.get("exec_catering_decorator")).toBe("Captured on form");
      expect(byField.get("exec_operations")).toBe("Captured on form");
      expect(byField.get("exec_additional")).toBe("Captured on form");
      expect(byField.get("no_of_crew_cards")).toBe("12");
      expect(byField.get("caterer_name")).toBe("Royal Caterers");
    });

    it("aggregates venue bookings and marks captured sections from merged requirements", async () => {
      const { db, updates } = buildReqDb(null, [
        { sound: "" },
        { sound: "Line array" },
      ]);

      await syncAdditionalRequirementsChecklist(db, "ev_ankh");

      const byField = new Map(updates
        .filter((u) => u.sql.startsWith("UPDATE checklist_items"))
        .map((u) => [u.binds[u.binds.length - 1] as string, u.binds[0] as string]));
      expect(byField.get("exec_sound_light")).toBe("Captured on form");
    });

    it("leaves sections Not started when only placeholder defaults are present", async () => {
      const { db, updates } = buildReqDb({
        digital_standee: "No",
        piano_required: "No",
        crew_cards: "12",
      });

      await syncAdditionalRequirementsChecklist(db, "ev_ankh");

      const byField = new Map(updates
        .filter((u) => u.sql.startsWith("UPDATE checklist_items"))
        .map((u) => [u.binds[u.binds.length - 1] as string, u.binds[0] as string]));
      expect(byField.get("exec_additional")).toBe("Not started");
      expect(byField.get("exec_recording_special")).toBe("Not started");
      expect(byField.get("no_of_crew_cards")).toBe("12");
    });

    it("does not overwrite Verified or Not applicable section rows", async () => {
      const { db, updates } = buildReqDb(
        { sound: "PA", parking: "VIP" },
        [],
        { exec_sound_light: "Verified", exec_operations: "Not applicable" },
      );

      await syncAdditionalRequirementsChecklist(db, "ev_ankh");

      const fieldKeys = updates
        .filter((u) => u.sql.startsWith("UPDATE checklist_items"))
        .map((u) => u.binds[u.binds.length - 1] as string);
      expect(fieldKeys).not.toContain("exec_sound_light");
      expect(fieldKeys).not.toContain("exec_operations");
    });
  });

  describe("reverse: syncRequirementsFromChecklistItem", () => {
    it("passthroughs Operations Details into the form requirements JSON", async () => {
      const { db, updates } = buildReqDb({ existing_field: "keep me" });

      await syncRequirementsFromChecklistItem(db, "ev_ankh", "caterer_name", "Royal Caterers");

      const evUpd = updates.find((u) => u.sql.startsWith("UPDATE events"));
      expect(evUpd).toBeDefined();
      const written = JSON.parse(evUpd!.binds[0] as string) as Record<string, unknown>;
      expect(written.catering_provider).toBe("Royal Caterers");
      expect(written.existing_field).toBe("keep me");
    });

    it("handles passthrough detail fields", async () => {
      const cases: Array<[string, string | null, string, string]> = [
        ["no_of_crew_cards", "42", "crew_cards", "42"],
        ["licenses_status", "Received", "licenses_status", "Received"],
        ["licenses", "PPL, IPRS", "licenses", "PPL, IPRS"],
        ["decorator_name", "StageCraft", "decorator_name", "StageCraft"],
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

    it("is a no-op for exec_* section rows and unknown fields", async () => {
      const { db, updates } = buildReqDb({ sound: "8-channel PA" });

      await syncRequirementsFromChecklistItem(db, "ev_ankh", "exec_sound_light", "Verified");
      await syncRequirementsFromChecklistItem(db, "ev_ankh", "event_name", "Some Title");

      expect(updates.filter((u) => u.sql.startsWith("UPDATE events"))).toHaveLength(0);
    });

    it("is a no-op when a passthrough value is empty", async () => {
      const { db, updates } = buildReqDb({ crew_cards: "5" });

      await syncRequirementsFromChecklistItem(db, "ev_ankh", "no_of_crew_cards", null);
      await syncRequirementsFromChecklistItem(db, "ev_ankh", "no_of_crew_cards", "");

      expect(updates.filter((u) => u.sql.startsWith("UPDATE events"))).toHaveLength(0);
    });
  });
});

describe("event requirements stay on the event form", () => {
  it("does not seed editable requirement rollups or granular req_* fields", () => {
    const execRows = CHECKLIST_DEFINITIONS.filter((d) => d.section === "Event Requirements");
    expect(execRows).toHaveLength(0);
    expect(CHECKLIST_DEFINITIONS.some((d) => d.field_key === "req_sound")).toBe(false);
  });

  it("does not seed catering data-entry status fields", () => {
    const byKey = Object.fromEntries(CHECKLIST_DEFINITIONS.map((d) => [d.field_key, d]));
    expect(byKey.catering_details).toBeUndefined();
    expect(byKey.caterer_tier).toBeUndefined();
    expect(byKey.type_of_catering).toBeUndefined();
    expect(byKey.no_of_pax).toBeUndefined();
  });
});

describe("operations timings removed", () => {
  it("does not seed AC timings into the Operations checklist", () => {
    const byKey = Object.fromEntries(CHECKLIST_DEFINITIONS.map((d) => [d.field_key, d]));
    expect(byKey.timings_with_ac).toBeUndefined();
    expect(byKey.ac_hours).toBeUndefined();
    expect(byKey.timings_without_ac).toBeUndefined();
    expect(byKey.non_ac_hours).toBeUndefined();
    expect(CHECKLIST_DEFINITIONS.some((d) => d.section === "Timings")).toBe(false);
  });
});

describe("OnStage required + Emailer checklist fields", () => {
  it("seeds Onstage/Emailer section with independent gates and Monthly Chart below", () => {
    const byKey = Object.fromEntries(CHECKLIST_DEFINITIONS.map((d) => [d.field_key, d]));
    expect(byKey.onstage_required?.section).toBe("Onstage/Emailer");
    expect(byKey.onstage_required?.options).toEqual(["Not Required", "Required"]);
    expect(byKey.onstage_required?.default_value).toBe("Required");
    expect(byKey.onstage_asked_client?.visibility_rule).toBe("onlyWhen(onstage_required == Required)");
    expect(byKey.onstage_complete?.visibility_rule).toBe("onlyWhen(onstage_required == Required)");
    expect(byKey.emailer?.section).toBe("Onstage/Emailer");
    expect(byKey.emailer?.options).toEqual(["No", "Yes"]);
    expect(byKey.emailer?.default_value).toBe("No");
    expect(byKey.emailer?.visibility_rule).toBeUndefined();
    expect(byKey.emailer_asked_client?.visibility_rule).toBe("onlyWhen(emailer == Yes)");
    expect(byKey.emailer_received_from_client?.visibility_rule).toBe("onlyWhen(emailer == Yes)");
    expect(byKey.emailer_sent_to_team?.visibility_rule).toBe("onlyWhen(emailer == Yes)");
    expect(byKey.emailer_sent?.visibility_rule).toBe("onlyWhen(emailer == Yes)");
    expect(byKey.monthly_chart_sent?.section).toBe("Monthly Chart");
    expect(byKey.monthly_chart_sent?.label).toBe("SENT for Monthly Chart");
    expect(byKey.monthly_chart_sent?.options).toEqual(["Not sent", "Sent"]);
    expect(byKey.box_office_statement?.section).toBe("Post-Event Closure");

    const ops = CHECKLIST_DEFINITIONS.filter((d) => d.module === "operations");
    const sectionOrder = [...new Set(ops.map((d) => d.section))];
    expect(sectionOrder.indexOf("Onstage/Emailer")).toBeLessThan(sectionOrder.indexOf("Monthly Chart"));
    expect(sectionOrder.indexOf("Monthly Chart")).toBeLessThan(sectionOrder.indexOf("Technical Meeting & Minutes"));
    expect(sectionOrder.at(-1)).toBe("Post-Event Closure");
  });

  it("marks only OnStage pipeline fields not_applicable when OnStage Required? = Not Required", async () => {
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

    await syncOnstageDependentChecklist(db, "ev_1", "Not Required");

    expect(updates).toHaveLength(1);
    expect(updates[0]?.sql).toContain("status = 'not_applicable'");
    expect(updates[0]?.binds[1]).toBe("ev_1");
  });

  it("marks Emailer date fields not_applicable when Emailer = No", async () => {
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

    await syncEmailerDependentChecklist(db, "ev_1", "No");

    expect(updates).toHaveLength(1);
    expect(updates[0]?.sql).toContain("status = 'not_applicable'");
    expect(updates[0]?.binds[1]).toBe("ev_1");
  });

  it("marks instalment date fields not_applicable when Instalment = No", async () => {
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

    await syncInstalmentDependentChecklist(db, "ev_1", "No");

    expect(updates).toHaveLength(1);
    expect(updates[0]?.sql).toContain("installment_1_expected_date");
    expect(updates[0]?.sql).toContain("status = 'not_applicable'");
    expect(updates[0]?.binds[1]).toBe("ev_1");
  });
});

describe("NOC dependent checklist fields", () => {
  it("seeds visibility_rule so date sent only shows when NOC Sent? = Yes", () => {
    const byKey = Object.fromEntries(CHECKLIST_DEFINITIONS.map((d) => [d.field_key, d]));
    expect(byKey.noc_sent?.field_type).toBe("dropdown");
    expect(byKey.noc_sent?.options).toEqual(["Not Applicable", "Not sent", "Sent"]);
    expect(byKey.noc_sent?.default_value).toBe("Not sent");
    expect(byKey.noc_sent_on?.visibility_rule).toBe("onlyWhen(noc_sent == Sent)");
    expect(byKey.noc_status).toBeUndefined();
  });

  it("marks Date Sent not_applicable when NOC Sent? = No", async () => {
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

    await syncNocDependentChecklist(db, "ev_1", "Not sent");

    expect(updates).toHaveLength(1);
    expect(updates[0]?.sql).toContain("status = ?");
    expect(updates[0]?.binds[0]).toBe("not_applicable");
    expect(updates[0]?.binds[updates[0]!.binds.length - 1]).toBe("noc_sent_on");
  });
});

describe("accounts TDS certificate processing", () => {
  it("seeds accounts fields without notify_after_3_days or tds_certificate_sent_to_client", () => {
    const byKey = Object.fromEntries(CHECKLIST_DEFINITIONS.map((d) => [d.field_key, d]));
    expect(byKey.notify_after_3_days).toBeUndefined();
    expect(byKey.tds_certificate_sent_to_client).toBeUndefined();
    expect(byKey.box_office_statement_sent?.options).toEqual(["Not Sent", "Sent", "Not Applicable"]);
    expect(byKey.tds_received_from_client_date?.section).toBe("TDS Certificate Processing");
    expect(byKey.tds_received_from_client_date?.visibility_rule).toBe("onlyWhen(tds_certificate_from_client == Received)");
    expect(byKey.tds_received_from_client_date?.triggers_task?.rule).toBe("tds_send_to_accounts");
    expect(byKey.tds_certificate_sent_to_accounts?.visibility_rule).toBe("onlyWhen(tds_certificate_from_client == Received)");
    expect(byKey.tds_accounts_refund_or_action?.options).toEqual(["Awaiting", "Refunded", "Payment Processed", "N/A"]);
    expect(byKey.tds_proof_sent_to_client?.options).toEqual(["Not Sent", "Sent"]);
  });

  it("marks TDS processing fields not_applicable when From Client is not Received", async () => {
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

    await syncTdsDependentChecklist(db, "ev_1", "N.A.");

    expect(updates).toHaveLength(1);
    expect(updates[0]?.sql).toContain("status = 'not_applicable'");
    expect(updates[0]?.binds[1]).toBe("ev_1");
  });

  it("re-derives TDS processing field status when From Client becomes Received", async () => {
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
            if (sql.includes("SELECT ci.id, ci.value")) {
              return {
                results: [
                  { id: "cli_date", value: null, field_type: "date", is_computed: 0 },
                  { id: "cli_sent", value: "2026-07-01", field_type: "date", is_computed: 0 },
                  { id: "cli_refund", value: "Awaiting", field_type: "dropdown", is_computed: 0 },
                  { id: "cli_proof", value: "Sent", field_type: "dropdown", is_computed: 0 },
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

    await syncTdsDependentChecklist(db, "ev_1", "Received");

    expect(updates).toHaveLength(4);
    const byId = Object.fromEntries(updates.map((u) => [u.binds[u.binds.length - 1], u.binds[0]]));
    expect(byId.cli_date).toBe("not_started");
    expect(byId.cli_sent).toBe("completed");
    expect(byId.cli_refund).toBe("not_started");
    expect(byId.cli_proof).toBe("completed");
  });

  it("treats Not Applicable and Refunded / Payment Processed as terminal statuses", () => {
    expect(itemStatusForValue({ field_type: "dropdown", value: "Not Applicable" })).toBe("not_applicable");
    expect(itemStatusForValue({ field_type: "dropdown", value: "Refunded" })).toBe("completed");
    expect(itemStatusForValue({ field_type: "dropdown", value: "Payment Processed" })).toBe("completed");
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

describe("reconcilePocTaskForEvent", () => {
  it("creates a high-priority automatic task when POC is incomplete", async () => {
    const updates: Array<{ sql: string; binds: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        const statement = {
          binds: [] as unknown[],
          bind(...values: unknown[]) { this.binds = values; return this; },
          async first() {
            if (sql.includes("SELECT id, status, event_owner_id FROM events")) {
              return { id: "ev_poc", status: "tentative", event_owner_id: "user_1" };
            }
            if (sql.includes("SELECT requirements FROM events")) return { requirements: "{}" };
            if (sql.includes("SELECT id FROM checklist_items")) return { id: "cli_poc" };
            return null;
          },
          async all() {
            if (sql.includes("FROM checklist_items")) return { results: [] };
            if (sql.includes("FROM checklist_definitions")) return { results: [] };
            return { results: [] };
          },
          async run() {
            updates.push({ sql, binds: [...this.binds] });
            return { meta: { changes: 1 } };
          },
        };
        return statement;
      },
    } as unknown as D1Database;

    await reconcilePocTaskForEvent(db, "ev_poc");

    const insert = updates.find((u) => u.sql.includes("INSERT INTO tasks"));
    expect(insert).toBeDefined();
    expect(insert!.binds).toContain("Complete Point of Contact");
    expect(insert!.binds).toContain("poc_incomplete");
    expect(insert!.sql).toContain("'high'");
  });
});
