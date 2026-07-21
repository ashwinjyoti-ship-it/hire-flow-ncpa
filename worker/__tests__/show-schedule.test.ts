import { describe, expect, it } from "vitest";
import { maxScheduledShowsOnAnyDay } from "../lib/show-schedule";

describe("show schedule helpers", () => {
  it("returns the highest show count on any single day", () => {
    expect(maxScheduledShowsOnAnyDay([
      { activity_type: "show", activity_date: "2026-08-28" },
      { activity_type: "show", activity_date: "2026-08-28" },
      { activity_type: "show", activity_date: "2026-08-29" },
    ])).toBe(2);
    expect(maxScheduledShowsOnAnyDay([
      { activity_type: "show", activity_date: "2026-08-28" },
    ])).toBe(1);
  });
});
