import { describe, expect, it } from "vitest";
import {
  approvalRequiredStatus,
  emailerGateStatus,
  gateControllerStatus,
  genreHeadStatus,
  instalmentGateStatus,
  onstageRequiredStatus,
  rollupChecklistSectionStatus,
} from "../lib/checklist-field-status";
import { syncGateControllerStatusesForEvent } from "../lib/operations";

describe("checklist gate controller status", () => {
  it("marks approval required completed once approval is received", () => {
    expect(approvalRequiredStatus("Not Required", null)).toBe("not_applicable");
    expect(approvalRequiredStatus("Required", null)).toBe("in_progress");
    expect(approvalRequiredStatus("Required", "2026-06-05")).toBe("completed");
  });

  it("marks genre head completed when a value is selected", () => {
    expect(genreHeadStatus(null, "Required")).toBe("not_started");
    expect(genreHeadStatus("Theatre", "Required")).toBe("completed");
    expect(genreHeadStatus("Theatre", "Not Required")).toBe("not_applicable");
  });

  it("marks onstage required completed when the pipeline is complete", () => {
    expect(onstageRequiredStatus("Not Required", null)).toBe("not_applicable");
    expect(onstageRequiredStatus("Required", null)).toBe("in_progress");
    expect(onstageRequiredStatus("Required", "2026-06-10")).toBe("completed");
  });

  it("keeps emailer in progress until the emailer is sent", () => {
    expect(emailerGateStatus("No", null)).toBe("not_started");
    expect(emailerGateStatus("Yes", null)).toBe("in_progress");
    expect(emailerGateStatus("Yes", "2026-06-10")).toBe("completed");
  });

  it("tracks instalment gate status from configured installments", () => {
    expect(instalmentGateStatus("No", {})).toBe("not_started");
    expect(instalmentGateStatus("Yes", {})).toBe("in_progress");
    expect(
      instalmentGateStatus("Yes", {
        installment_1_expected_date: "2026-06-01",
        installment_1_received: "true",
      }),
    ).toBe("completed");
    expect(
      instalmentGateStatus("Yes", {
        installment_1_expected_date: "2026-06-01",
        installment_1_received: null,
      }),
    ).toBe("in_progress");
  });

  it("derives approval section complete when all visible fields are done", () => {
    const values = {
      approval_required: "Required",
      approval_received_on: "2026-06-05",
      genre_head: "Theatre",
    };
    expect(gateControllerStatus("approval_required", values)).toBe("completed");
    expect(gateControllerStatus("genre_head", values)).toBe("completed");
    expect(
      rollupChecklistSectionStatus([
        { status: "completed" },
        { status: "completed" },
        { status: "completed" },
        { status: "completed" },
      ]),
    ).toBe("completed");
    expect(
      rollupChecklistSectionStatus([
        { status: "completed" },
        { status: "completed" },
        { status: "in_progress" },
      ]),
    ).toBe("in_progress");
  });
});

describe("syncGateControllerStatusesForEvent", () => {
  it("persists healed gate controller statuses for approval", async () => {
    const updates: Array<{ field_key: string; status: string }> = [];
    const db = {
      prepare(sql: string) {
        const statement = {
          binds: [] as unknown[],
          bind(...values: unknown[]) {
            this.binds = values;
            return this;
          },
          async all() {
            if (sql.includes("SELECT field_key, value")) {
              return {
                results: [
                  { field_key: "approval_required", value: "Required" },
                  { field_key: "approval_received_on", value: "2026-06-05" },
                  { field_key: "genre_head", value: "Theatre" },
                ],
              };
            }
            return { results: [] };
          },
          async run() {
            if (sql.includes("UPDATE checklist_items SET status")) {
              updates.push({
                field_key: String(statement.binds[3]),
                status: String(statement.binds[0]),
              });
            }
            return { success: true };
          },
        };
        return statement;
      },
    } as unknown as D1Database;

    await syncGateControllerStatusesForEvent(db, "ev_approval");

    const byKey = Object.fromEntries(updates.map((row) => [row.field_key, row.status]));
    expect(byKey.approval_required).toBe("completed");
    expect(byKey.genre_head).toBe("completed");
  });
});
