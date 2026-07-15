import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isChecklistFieldVisible, isFullWidthChecklistField } from "./checklist-visibility";

describe("isChecklistFieldVisible", () => {
  it("hides dependents when the controller value does not match", () => {
    const items = [
      { field_key: "emailer", value: "No", visibility_rule: null },
      { field_key: "emailer_asked_client", value: null, visibility_rule: "onlyWhen(emailer == Yes)" },
    ];
    const byKey = new Map(items.map((item) => [item.field_key, item]));
    expect(isChecklistFieldVisible(items[1]!, byKey)).toBe(false);
  });

  it("shows dependents when the controller matches, including transitive gates", () => {
    const items = [
      { field_key: "onstage_required", value: "Required", visibility_rule: null },
      { field_key: "onstage_asked_client", value: null, visibility_rule: "onlyWhen(onstage_required == Required)" },
    ];
    const byKey = new Map(items.map((item) => [item.field_key, item]));
    expect(isChecklistFieldVisible(items[1]!, byKey)).toBe(true);
  });
});

describe("isFullWidthChecklistField", () => {
  it("marks all gate controllers full-width", () => {
    for (const key of [
      "onstage_required",
      "emailer",
      "approval_required",
      "instalment",
      "noc_sent",
      "tds_certificate_from_client",
    ]) {
      expect(isFullWidthChecklistField(key)).toBe(true);
    }
  });
});

describe("useChecklistUpdate hook", () => {
  it("uses optimistic updates and per-field saving", () => {
    const root = resolve(import.meta.dirname, "../..");
    const source = readFileSync(resolve(root, "src/lib/use-checklist-update.ts"), "utf8");
    const detail = readFileSync(resolve(root, "src/pages/EventDetailPage.tsx"), "utf8");

    expect(source).toContain("applyOptimisticChecklistUpdate");
    expect(source).toContain("onMutate:");
    expect(source).not.toContain("fetchFreshEventState");
    expect(detail).toContain("useChecklistUpdate");
    expect(detail).toContain("savingItemId={savingChecklistItemId}");
    expect(detail).not.toMatch(/checklistUpdate[\s\S]*fetchFreshEventState/);
  });
});
