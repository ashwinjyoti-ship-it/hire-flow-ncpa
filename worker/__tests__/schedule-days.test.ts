import { describe, expect, it } from "vitest";
import { applyScheduleDaysToEntries, deriveScheduleDaysFromEntries } from "../lib/schedule-days";
import type { ScheduleEntryInputT } from "../lib/types";

const entries: ScheduleEntryInputT[] = [
  {
    activity_type: "show",
    activity_date: "2026-07-10",
    start_time: "15:00",
    end_time: "17:00",
    with_ac_start: "12:00",
    with_ac_end: "21:00",
    with_ac_minutes: 540,
    without_ac_start: "10:00",
    without_ac_end: "12:00",
    without_ac_minutes: 120,
    notes: null,
  },
  {
    activity_type: "show",
    activity_date: "2026-07-10",
    start_time: "19:00",
    end_time: "21:00",
    with_ac_start: "12:00",
    with_ac_end: "21:00",
    with_ac_minutes: 540,
    without_ac_start: "10:00",
    without_ac_end: "12:00",
    without_ac_minutes: 120,
    notes: null,
  },
];

describe("venue schedule days", () => {
  it("derives one operating window for multiple activities on the same date", () => {
    expect(deriveScheduleDaysFromEntries(entries)).toEqual([{
      activity_date: "2026-07-10",
      with_ac_start: "12:00",
      with_ac_end: "21:00",
      with_ac_minutes: 540,
      without_ac_start: "10:00",
      without_ac_end: "12:00",
      without_ac_minutes: 120,
    }]);
  });

  it("mirrors an edited daily window to every activity for legacy consumers", () => {
    const updated = applyScheduleDaysToEntries(entries, [{
      activity_date: "2026-07-10",
      with_ac_start: "13:00",
      with_ac_end: "22:00",
      with_ac_minutes: 540,
      without_ac_start: "11:00",
      without_ac_end: "13:00",
      without_ac_minutes: 120,
    }]);

    expect(updated).toHaveLength(2);
    expect(updated.every((entry) => entry.with_ac_start === "13:00")).toBe(true);
    expect(updated.every((entry) => entry.without_ac_end === "13:00")).toBe(true);
    expect(updated.map((entry) => entry.start_time)).toEqual(["15:00", "19:00"]);
  });
});
