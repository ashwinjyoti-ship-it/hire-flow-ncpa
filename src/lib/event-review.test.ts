import { describe, expect, it } from "vitest";
import { buildReviewItems } from "./event-review";
import type { EventInputT } from "../../worker/lib/types";

describe("buildReviewItems", () => {
  it("shows exactly the six review boxes requested", () => {
    const form = {
      title: "Test event 45",
      organisation_id: "new:Test",
      event_start_date: "2026-08-28",
      event_end_date: null,
      venue_bookings: [
        {
          venue: "NCPA",
          booking_status: "tentative",
          number_of_shows: 1,
          requirements: null,
          notes: null,
          schedule_entries: [
            {
              activity_type: "show",
              activity_date: "2026-08-28",
              start_time: null,
              end_time: null,
              with_ac_start: "10:00",
              with_ac_end: "12:00",
              with_ac_minutes: 120,
              without_ac_start: "12:00",
              without_ac_end: "15:00",
              without_ac_minutes: 180,
              notes: null,
            },
          ],
        },
      ],
    } as unknown as EventInputT;

    const items = buildReviewItems(form, "Test");

    expect(items.map((item) => item.label)).toEqual([
      "Organisation",
      "Event Name",
      "Operating Window",
      "Venue Booking Status",
      "Number of Shows",
      "AC Hours",
    ]);
    expect(items.find((item) => item.label === "Organisation")?.value).toBe("Test");
    expect(items.find((item) => item.label === "Operating Window")?.value).toBe("08/28/2026");
    expect(items.find((item) => item.label === "AC Hours")?.value).toContain("With AC 2h");
    expect(items.find((item) => item.label === "AC Hours")?.value).toContain("Without AC 3h");
  });
});
