import { describe, expect, it } from "vitest";
import { isChecklistFieldVisible } from "../lib/checklist-visibility";

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

  it("hides instalment dates when Instalment = No", () => {
    const items = [
      { field_key: "instalment", value: "No", visibility_rule: null },
      { field_key: "installment_1_expected_date", value: null, visibility_rule: "onlyWhen(instalment == Yes)" },
    ];
    const byKey = new Map(items.map((item) => [item.field_key, item]));
    expect(isChecklistFieldVisible(items[1]!, byKey)).toBe(false);
  });
});
