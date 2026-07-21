import { describe, expect, it } from "vitest";
import {
  activeCanteenTimingKeys,
  CANTEEN_BETWEEN_SHOWS_KEY,
  CANTEEN_IN_INTERVAL_KEY,
  isBetweenShowsCanteenApplicableForEntries,
  isCateringSectionNotApplicable,
  normalizeCateringRequirements,
  SIT_DOWN_MEALS_REQUIRED_KEY,
  THEATRE_CANTEEN_REQUIRED_KEY,
  theatreCanteenTimingsFilledForVenues,
} from "../lib/theatre-canteen";

describe("theatre canteen", () => {
  it("treats between shows as N/A when only one show is scheduled that day", () => {
    const entries = [{ activity_type: "show", activity_date: "2026-08-28" }];
    expect(isBetweenShowsCanteenApplicableForEntries(entries)).toBe(false);
    expect(activeCanteenTimingKeys({ [THEATRE_CANTEEN_REQUIRED_KEY]: "Yes" }, [{ schedule_entries: entries }])).toEqual([
      "canteen_before_show",
      "canteen_in_interval",
    ]);
  });

  it("includes between shows when multiple shows share a day", () => {
    const entries = [
      { activity_type: "show", activity_date: "2026-08-28" },
      { activity_type: "show", activity_date: "2026-08-28" },
    ];
    expect(isBetweenShowsCanteenApplicableForEntries(entries)).toBe(true);
    expect(activeCanteenTimingKeys({ [THEATRE_CANTEEN_REQUIRED_KEY]: "Yes" }, [{ schedule_entries: entries }])).toContain(
      CANTEEN_BETWEEN_SHOWS_KEY,
    );
  });

  it("requires at least one affirmative timing when theatre canteen is yes", () => {
    const venues = [{ schedule_entries: [{ activity_type: "show", activity_date: "2026-08-28" }] }];
    expect(theatreCanteenTimingsFilledForVenues({
      [THEATRE_CANTEEN_REQUIRED_KEY]: "Yes",
      canteen_before_show: "No",
      canteen_in_interval: "No",
    }, venues)).toBe(false);
    expect(theatreCanteenTimingsFilledForVenues({
      [THEATRE_CANTEEN_REQUIRED_KEY]: "Yes",
      canteen_before_show: "No",
      [CANTEEN_IN_INTERVAL_KEY]: "Yes",
    }, venues)).toBe(true);
  });

  it("migrates legacy interval into theatre canteen timings", () => {
    const normalized = normalizeCateringRequirements({
      catering_required: "Yes",
      interval: "Yes",
      catering_provider: "Royal Caterers",
      catering_lunch_required: "Yes",
      catering_lunch_pax: "50",
    });
    expect(normalized[THEATRE_CANTEEN_REQUIRED_KEY]).toBe("Yes");
    expect(normalized[CANTEEN_IN_INTERVAL_KEY]).toBe("Yes");
    expect(normalized[SIT_DOWN_MEALS_REQUIRED_KEY]).toBe("Yes");
  });

  it("marks catering not applicable only when both tracks are no", () => {
    expect(isCateringSectionNotApplicable({
      [THEATRE_CANTEEN_REQUIRED_KEY]: "No",
      [SIT_DOWN_MEALS_REQUIRED_KEY]: "No",
    })).toBe(true);
    expect(isCateringSectionNotApplicable({
      [THEATRE_CANTEEN_REQUIRED_KEY]: "Yes",
      [SIT_DOWN_MEALS_REQUIRED_KEY]: "No",
    })).toBe(false);
  });
});
