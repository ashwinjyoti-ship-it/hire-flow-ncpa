import { describe, expect, it } from "vitest";
import {
  buildTimingsWithAcText,
  buildTimingsWithoutAcText,
  formatHoursTotal,
  sumAcMinutes,
  type ScheduleTimingRow,
} from "../lib/timing-sync";

describe("timing-sync", () => {
  const rows: ScheduleTimingRow[] = [
    {
      venue: "JBT",
      activity_type: "setup",
      activity_date: "2026-07-10",
      start_time: "10:00",
      end_time: "18:00",
      with_ac_start: "10:00",
      with_ac_end: "14:00",
      with_ac_minutes: 240,
      without_ac_start: "14:00",
      without_ac_end: "18:00",
      without_ac_minutes: 240,
    },
    {
      venue: "TATA",
      activity_type: "show",
      activity_date: "2026-07-11",
      start_time: "19:00",
      end_time: "22:00",
      with_ac_start: "19:00",
      with_ac_end: "22:00",
      with_ac_minutes: 180,
    },
  ];

  it("groups multi-venue AC timings by hall", () => {
    const text = buildTimingsWithAcText(rows);
    expect(text).toContain("[JBT]");
    expect(text).toContain("[TATA]");
    expect(text).toContain("With AC: 10:00-14:00 (4h)");
    expect(text).toContain("With AC: 19:00-22:00 (3h)");
  });

  it("builds without-AC block separately", () => {
    const text = buildTimingsWithoutAcText(rows);
    expect(text).toContain("[JBT]");
    expect(text).toContain("Without AC: 14:00-18:00 (4h)");
    expect(text).not.toContain("[TATA]");
  });

  it("sums AC minutes across venues", () => {
    expect(sumAcMinutes(rows)).toBe(420);
    expect(formatHoursTotal(420)).toBe("7h");
  });
});
