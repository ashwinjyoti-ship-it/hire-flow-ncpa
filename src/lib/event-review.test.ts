import { describe, expect, it } from "vitest";
import { buildReviewItems } from "./event-review";
import type { EventInputT } from "../../worker/lib/types";

const baseForm = {
  title: "Test event 45",
  organisation_id: "new:Test",
  event_start_date: "2026-08-28",
  event_end_date: null,
  venue_bookings: [
    {
      venue: "JBT",
      booking_status: "tentative",
      number_of_shows: 2,
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
        {
          activity_type: "show",
          activity_date: "2026-08-28",
          start_time: "18:00",
          end_time: "20:00",
          with_ac_start: null,
          with_ac_end: null,
          with_ac_minutes: null,
          without_ac_start: null,
          without_ac_end: null,
          without_ac_minutes: null,
          notes: null,
        },
      ],
    },
    {
      venue: "TATA",
      booking_status: "confirmed",
      number_of_shows: 1,
      requirements: null,
      notes: "Piano tuned",
      schedule_entries: [
        {
          activity_type: "rehearsal",
          activity_date: "2026-08-27",
          start_time: "09:00",
          end_time: "11:00",
          with_ac_start: "09:00",
          with_ac_end: "11:00",
          with_ac_minutes: 120,
          without_ac_start: null,
          without_ac_end: null,
          without_ac_minutes: null,
          notes: null,
        },
      ],
    },
  ],
} as unknown as EventInputT;

describe("buildReviewItems", () => {
  it("includes every venue booking and schedule entry, not only venue 1", () => {
    const items = buildReviewItems(baseForm, "Test", { organisationType: "Corporate" });

    expect(items.find((item) => item.label === "Organisation")?.value).toBe("Test");
    expect(items.find((item) => item.label === "Event Name")?.value).toBe("Test event 45");
    expect(items.find((item) => item.label === "Operating Window")?.value).toBe("28/08/2026");

    expect(items.find((item) => item.label === "Venue 1")?.value).toBe("JBT");
    expect(items.find((item) => item.label === "Venue 1 Booking Status")?.value).toBe("Tentative");
    expect(items.find((item) => item.label === "Venue 1 Shows — 28/08/2026")?.value).toBe("2 shows");
    expect(items.find((item) => item.label === "Venue 1 Schedule — 28/08/2026")?.value).toContain("With AC 10:00 - 12:00");
    expect(items.find((item) => item.label === "Venue 1 Schedule — 28/08/2026")?.value).toContain("Without AC 12:00 - 15:00");
    expect(items.find((item) => item.label === "Activity 1.1.1")?.value).toBe("Show");
    expect(items.find((item) => item.label === "Activity 1.1.2")?.value).toContain("18:00 - 20:00");

    expect(items.find((item) => item.label === "Venue 2")?.value).toBe("TATA");
    expect(items.find((item) => item.label === "Venue 2 Booking Status")?.value).toBe("Confirmed");
    expect(items.some((item) => item.label.startsWith("Venue 2 Shows"))).toBe(false);
    expect(items.find((item) => item.label === "Venue 2 Notes")?.value).toBe("Piano tuned");
    expect(items.find((item) => item.label === "Activity 2.1.1")?.value).toContain("Rehearsal");
    expect(items.find((item) => item.label === "Venue 2 Schedule — 27/08/2026")?.value).toContain("With AC 09:00 - 11:00");

    // Regression: the old six-box summary only surfaced venue 1 aggregates.
    expect(items.some((item) => item.label === "Venue Booking Status")).toBe(false);
    expect(items.some((item) => item.label === "AC Hours")).toBe(false);
  });

  it("shows requirements under each venue, not only at event level", () => {
    const form = {
      ...baseForm,
      requirements: { program_officer_phone: "022 1" },
      venue_bookings: [
        {
          ...baseForm.venue_bookings[0],
          requirements: { sound: "JBT PA", light: "Warm" },
        },
        {
          ...baseForm.venue_bookings[1],
          requirements: { sound: "TATA line array" },
        },
      ],
    } as unknown as EventInputT;

    const items = buildReviewItems(form, "Test");
    expect(items.find((item) => item.label === "Program Officer Contact")?.value).toBe("022 1");
    expect(items.find((item) => item.label === "Venue 1 Sound")?.value).toBe("JBT PA");
    expect(items.find((item) => item.label === "Venue 1 Light")?.value).toBe("Warm");
    expect(items.find((item) => item.label === "Venue 2 Sound")?.value).toBe("TATA line array");
    expect(items.some((item) => item.label === "Sound")).toBe(false);
  });

  it("notes when a venue has no schedule details yet", () => {
    const form = {
      ...baseForm,
      venue_bookings: [
        {
          venue: "GDT",
          booking_status: "tentative",
          number_of_shows: 1,
          requirements: null,
          notes: null,
          schedule_entries: [],
        },
      ],
    } as unknown as EventInputT;

    const items = buildReviewItems(form, "Test");
    expect(items.find((item) => item.label === "Venue 1 Schedule")?.value).toBe("No schedule details");
  });
});
