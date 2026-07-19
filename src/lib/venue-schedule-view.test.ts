import { describe, expect, it } from "vitest";
import {
  formatScheduleSummary,
  getDefaultExpandedVenueKeys,
  getVenueBookingKey,
  shouldUseCompactSchedule,
  shouldUseTwoColumnSchedule,
} from "./venue-schedule-view";

describe("venue-schedule-view", () => {
  it("formats schedule summaries for empty and populated venues", () => {
    expect(formatScheduleSummary([])).toBe("No schedule yet");
    expect(formatScheduleSummary([{ activity_type: "show", activity_date: "2026-08-28" }])).toBe("1 activity · 1 date");
    expect(
      formatScheduleSummary([
        { activity_type: "setup", activity_date: "2026-08-27" },
        { activity_type: "show", activity_date: "2026-08-28" },
        { activity_type: "dismantling", activity_date: "2026-08-28" },
      ]),
    ).toBe("3 activities · 2 dates");
  });

  it("keeps one or two venues expanded by default and collapses the rest", () => {
    const twoVenues = [{ id: "vb_1" }, { id: "vb_2" }];
    const fourVenues = [{ id: "vb_1" }, { id: "vb_2" }, { id: "vb_3" }, { id: "vb_4" }];

    expect(getDefaultExpandedVenueKeys(twoVenues)).toEqual(new Set(["vb_1", "vb_2"]));
    expect(getDefaultExpandedVenueKeys(fourVenues)).toEqual(new Set(["vb_1"]));
  });

  it("uses compact schedule tables only for busy venues", () => {
    expect(shouldUseCompactSchedule(3)).toBe(false);
    expect(shouldUseCompactSchedule(4)).toBe(true);
  });

  it("limits two-column card grids to a single venue with a short schedule", () => {
    expect(shouldUseTwoColumnSchedule(2, 1)).toBe(true);
    expect(shouldUseTwoColumnSchedule(3, 1)).toBe(false);
    expect(shouldUseTwoColumnSchedule(2, 4)).toBe(false);
  });

  it("falls back to stable venue keys when ids are missing", () => {
    expect(getVenueBookingKey({ id: "vb_9" }, 2)).toBe("vb_9");
    expect(getVenueBookingKey({}, 2)).toBe("venue-2");
  });
});
