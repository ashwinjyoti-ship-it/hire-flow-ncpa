import { describe, expect, it } from "vitest";
import { applyOptimisticChecklistUpdate, type ChecklistCacheResponse } from "./checklist-cache";

function sampleChecklist(): ChecklistCacheResponse {
  return {
    checklist: {
      operations: {
        "Onstage/Emailer": [
          { id: "1", module: "operations", section: "Onstage/Emailer", field_key: "onstage_required", label: "OnStage Required?", status: "in_progress", value: "Required", due_date: null, field_type: "dropdown", options: ["Not Required", "Required"], is_computed: 0 },
          { id: "2", module: "operations", section: "Onstage/Emailer", field_key: "onstage_asked_client", label: "Asked", status: "not_started", value: null, due_date: null, field_type: "date", options: null, is_computed: 0, visibility_rule: "onlyWhen(onstage_required == Required)" },
          { id: "3", module: "operations", section: "Onstage/Emailer", field_key: "emailer", label: "Emailer", status: "not_started", value: "No", due_date: null, field_type: "dropdown", options: ["No", "Yes"], is_computed: 0 },
          { id: "4", module: "operations", section: "Onstage/Emailer", field_key: "emailer_asked_client", label: "Emailer Asked", status: "not_applicable", value: null, due_date: null, field_type: "date", options: null, is_computed: 0, visibility_rule: "onlyWhen(emailer == Yes)" },
        ],
      },
      accounts: {},
    },
    lifecycle: { current: "enquiry", canConfirm: false, blockers: [], nextAction: null, actions: [] },
    poc: null,
  };
}

describe("applyOptimisticChecklistUpdate", () => {
  it("updates the controller and marks OnStage pipeline N/A when Not Required", () => {
    const next = applyOptimisticChecklistUpdate(
      sampleChecklist(),
      { id: "1", field_key: "onstage_required", field_type: "dropdown" },
      "Not Required",
    );
    const items = next.checklist.operations["Onstage/Emailer"]!;
    expect(items.find((i) => i.field_key === "onstage_required")?.value).toBe("Not Required");
    expect(items.find((i) => i.field_key === "onstage_asked_client")?.status).toBe("not_applicable");
    expect(items.find((i) => i.field_key === "emailer")?.value).toBe("No");
  });

  it("expands Emailer dates optimistically when Emailer becomes Yes", () => {
    const next = applyOptimisticChecklistUpdate(
      sampleChecklist(),
      { id: "3", field_key: "emailer", field_type: "dropdown" },
      "Yes",
    );
    const items = next.checklist.operations["Onstage/Emailer"]!;
    expect(items.find((i) => i.field_key === "emailer")?.status).toBe("completed");
    expect(items.find((i) => i.field_key === "emailer_asked_client")?.status).toBe("not_started");
  });
});
