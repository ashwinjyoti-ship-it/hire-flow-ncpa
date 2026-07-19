import { describe, expect, it } from "vitest";
import {
  calculateVenueScheduleReadinessSection,
  collectSetActivityLabels,
  parseVenueBookingsForReadiness,
  venueScheduleIssueLabel,
} from "../lib/venue-schedule-readiness";

describe("venue schedule readiness", () => {
  it("flags events with no venue bookings", () => {
    const section = calculateVenueScheduleReadinessSection([]);
    expect(section.state).toBe("missing");
    expect(section.missingLabels).toEqual(["Add at least one venue with activity schedule"]);
    expect(section.setLabels).toEqual([]);
  });

  it("flags venues without dated schedule entries", () => {
    const section = calculateVenueScheduleReadinessSection([
      { venue: "TET", schedule_entries: [] },
      { venue: "JBT", schedule_entries: [{ activity_type: "show", activity_date: "2026-08-28" }] },
    ]);
    expect(section.state).toBe("partial");
    expect(section.filled).toBe(1);
    expect(section.total).toBe(2);
    expect(section.missingLabels).toEqual(["TET: add activity schedule"]);
    expect(section.setLabels).toEqual(["Show"]);
  });

  it("treats setup/rehearsal without show as partially filled", () => {
    const section = calculateVenueScheduleReadinessSection([
      {
        venue: "TET",
        schedule_entries: [
          { activity_type: "setup", activity_date: "2026-08-27" },
          { activity_type: "rehearsal", activity_date: "2026-08-27" },
        ],
      },
    ]);
    expect(section.state).toBe("partial");
    expect(section.filled).toBe(0);
    expect(section.missingLabels).toEqual(["TET: add show"]);
    expect(section.setLabels).toEqual(["Setup", "Rehearsal"]);
  });

  it("completes only when every venue has a dated show", () => {
    const section = calculateVenueScheduleReadinessSection([
      {
        venue: "TET",
        schedule_entries: [
          { activity_type: "setup", activity_date: "2026-08-27" },
          { activity_type: "show", activity_date: "2026-08-28" },
        ],
      },
      { venue: "JBT", schedule_entries: [{ activity_type: "show", activity_date: "2026-08-28" }, { activity_date: null }] },
    ]);
    expect(section.state).toBe("complete");
    expect(section.missingLabels).toEqual([]);
    expect(section.setLabels).toEqual(["Setup", "Show"]);
  });

  it("lists only the activity types that have dated schedule rows", () => {
    expect(
      collectSetActivityLabels([
        {
          venue: "TET",
          schedule_entries: [
            { activity_type: "show", activity_date: "2026-08-28" },
            { activity_type: "zero_show", activity_date: "2026-08-27" },
            { activity_type: "setup", activity_date: null },
          ],
        },
      ]),
    ).toEqual(["Zero Show", "Show"]);
  });

  it("parses venue booking rows from D1 schedule_json", () => {
    const bookings = parseVenueBookingsForReadiness([
      { venue: "TET", schedule_json: '[{"activity_date":"2026-08-28","activity_type":"show"}]' },
    ]);
    expect(bookings[0]?.schedule_entries).toEqual([{ activity_date: "2026-08-28", activity_type: "show" }]);
  });

  it("shortens venue issue labels for compact chips", () => {
    expect(venueScheduleIssueLabel("TET: add activity schedule")).toBe("TET");
    expect(venueScheduleIssueLabel("TET: add show")).toBe("TET");
    expect(venueScheduleIssueLabel("Venue 2: select a venue")).toBe("Venue 2");
  });
});
