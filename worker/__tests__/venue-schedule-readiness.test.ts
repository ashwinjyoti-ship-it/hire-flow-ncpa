import { describe, expect, it } from "vitest";
import {
  calculateVenueScheduleReadinessSection,
  parseVenueBookingsForReadiness,
  venueScheduleIssueLabel,
} from "../lib/venue-schedule-readiness";

describe("venue schedule readiness", () => {
  it("flags events with no venue bookings", () => {
    const section = calculateVenueScheduleReadinessSection([]);
    expect(section.state).toBe("missing");
    expect(section.missingLabels).toEqual(["Add at least one venue with activity schedule"]);
  });

  it("flags venues without dated schedule entries", () => {
    const section = calculateVenueScheduleReadinessSection([
      { venue: "TET", schedule_entries: [] },
      { venue: "JBT", schedule_entries: [{ activity_date: "2026-08-28" }] },
    ]);
    expect(section.state).toBe("partial");
    expect(section.filled).toBe(1);
    expect(section.total).toBe(2);
    expect(section.missingLabels).toEqual(["TET: add activity schedule"]);
  });

  it("completes when every venue has at least one dated activity", () => {
    const section = calculateVenueScheduleReadinessSection([
      { venue: "TET", schedule_entries: [{ activity_date: "2026-08-27" }] },
      { venue: "JBT", schedule_entries: [{ activity_date: "2026-08-28" }, { activity_date: null }] },
    ]);
    expect(section.state).toBe("complete");
    expect(section.missingLabels).toEqual([]);
  });

  it("parses venue booking rows from D1 schedule_json", () => {
    const bookings = parseVenueBookingsForReadiness([
      { venue: "TET", schedule_json: '[{"activity_date":"2026-08-28"}]' },
    ]);
    expect(bookings[0]?.schedule_entries).toEqual([{ activity_date: "2026-08-28" }]);
  });

  it("shortens venue issue labels for compact chips", () => {
    expect(venueScheduleIssueLabel("TET: add activity schedule")).toBe("TET");
    expect(venueScheduleIssueLabel("Venue 2: select a venue")).toBe("Venue 2");
  });
});
