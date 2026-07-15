import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHECKLIST_INTERVALS,
  dueAfterDaysForRule,
  mergeChecklistIntervals,
} from "../lib/checklist-intervals";

describe("checklist intervals", () => {
  it("exposes the historical hardcoded defaults", () => {
    expect(DEFAULT_CHECKLIST_INTERVALS).toEqual({
      approval_followup: 7,
      instalment: 0,
      confirmation_letter: 3,
      onstage: 3,
      technical_meeting: 0,
      feedback: 5,
      accounts_file: 3,
      send_file_to_accounts: 1,
      tds_send_to_accounts: 0,
    });
  });

  it("merges partial overrides onto defaults", () => {
    expect(mergeChecklistIntervals({ approval_followup: 10, feedback: 2 })).toEqual({
      ...DEFAULT_CHECKLIST_INTERVALS,
      approval_followup: 10,
      feedback: 2,
    });
  });

  it("ignores negative or non-numeric values", () => {
    expect(mergeChecklistIntervals({ approval_followup: -1, onstage: "abc", confirmation_letter: "4" })).toEqual({
      ...DEFAULT_CHECKLIST_INTERVALS,
      confirmation_letter: 4,
    });
  });

  it("resolves due_after_days from settings for known rules", () => {
    const intervals = mergeChecklistIntervals({ confirmation_letter: 9 });
    expect(dueAfterDaysForRule(intervals, "confirmation_letter", 3)).toBe(9);
    expect(dueAfterDaysForRule(intervals, "unknown_rule", 12)).toBe(12);
  });
});
