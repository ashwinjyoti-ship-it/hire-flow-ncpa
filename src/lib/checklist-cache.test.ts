import { describe, expect, it } from "vitest";
import { CHECKLIST_DEFINITIONS } from "../../scripts/seed/checklist-definitions";
import { applyOptimisticChecklistUpdate, OPTIMISTIC_GATE_CONTROLLERS, type ChecklistCacheResponse } from "./checklist-cache";

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
        NOC: [
          { id: "5", module: "operations", section: "NOC", field_key: "noc_sent", label: "NOC Sent?", status: "not_started", value: "Not sent", due_date: null, field_type: "dropdown", options: ["Not Applicable", "Not sent", "Sent"], is_computed: 0 },
          { id: "6", module: "operations", section: "NOC", field_key: "noc_sent_on", label: "Date Sent", status: "not_applicable", value: null, due_date: null, field_type: "date", options: null, is_computed: 0, visibility_rule: "onlyWhen(noc_sent == Sent)" },
        ],
      },
      accounts: {
        "TDS Certificate Processing": [
          { id: "7", module: "accounts", section: "TDS Certificate Processing", field_key: "tds_certificate_from_client", label: "TDS Certificate — From Client", status: "not_started", value: "Awaiting", due_date: null, field_type: "dropdown", options: ["Awaiting", "Received"], is_computed: 0 },
          { id: "8", module: "accounts", section: "TDS Certificate Processing", field_key: "tds_received_from_client_date", label: "TDS Received", status: "not_applicable", value: null, due_date: null, field_type: "date", options: null, is_computed: 0, visibility_rule: "onlyWhen(tds_certificate_from_client == Received)" },
        ],
      },
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

  it("expands NOC date when NOC Sent becomes Sent", () => {
    const next = applyOptimisticChecklistUpdate(
      sampleChecklist(),
      { id: "5", field_key: "noc_sent", field_type: "dropdown" },
      "Sent",
    );
    const items = next.checklist.operations.NOC!;
    expect(items.find((i) => i.field_key === "noc_sent_on")?.status).toBe("not_started");
  });

  it("expands TDS processing fields when certificate is Received", () => {
    const next = applyOptimisticChecklistUpdate(
      sampleChecklist(),
      { id: "7", field_key: "tds_certificate_from_client", field_type: "dropdown" },
      "Received",
    );
    const items = next.checklist.accounts["TDS Certificate Processing"]!;
    expect(items.find((i) => i.field_key === "tds_certificate_from_client")?.status).toBe("completed");
    expect(items.find((i) => i.field_key === "tds_received_from_client_date")?.status).toBe("not_started");
  });
});

describe("visibility gate audit", () => {
  it("covers every visibility_rule controller in seed definitions", () => {
    const controllers = new Set<string>();
    for (const def of CHECKLIST_DEFINITIONS) {
      const rule = def.visibility_rule?.trim();
      if (!rule) continue;
      const match = rule.match(/^onlyWhen\(\s*([a-zA-Z0-9_]+)\s*==/i);
      if (match?.[1]) controllers.add(match[1]);
    }

    const covered = new Set<string>(OPTIMISTIC_GATE_CONTROLLERS);
    const missing = [...controllers].filter((key) => !covered.has(key));
    expect(missing, `Add optimistic handlers for: ${missing.join(", ")}`).toEqual([]);
  });
});
