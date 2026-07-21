import { describe, expect, it } from "vitest";
import { countScheduledShowsByDate, deriveVenueShowCount } from "../lib/show-schedule";

describe("show schedule counts", () => {
  it("counts each show occurrence separately on each date", () => {
    const entries = [
      { activity_type: "show", activity_date: "2026-08-12" },
      { activity_type: "show", activity_date: "2026-08-12" },
      { activity_type: "rehearsal", activity_date: "2026-08-12" },
      { activity_type: "show", activity_date: "2026-08-13" },
    ];

    expect(deriveVenueShowCount(entries, 99)).toBe(3);
    expect(Object.fromEntries(countScheduledShowsByDate(entries))).toEqual({
      "2026-08-12": 2,
      "2026-08-13": 1,
    });
  });

  it("preserves an aggregate legacy count only when no schedule details exist", () => {
    expect(deriveVenueShowCount([], 2)).toBe(2);
    expect(deriveVenueShowCount([{ activity_type: "setup", activity_date: "2026-08-12" }], 2)).toBe(0);
  });
});
