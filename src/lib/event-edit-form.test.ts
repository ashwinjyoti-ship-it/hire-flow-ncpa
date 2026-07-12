import { describe, expect, it } from "vitest";
import { canCreateEvent, getEventFormDateError, organisationValueFromName } from "./event-edit-form";

describe("canCreateEvent", () => {
  it("allows submission when organisation, event name, and date are filled", () => {
    expect(
      canCreateEvent({
        title: "A New Event",
        organisation_id: "org_1",
        event_start_date: "2026-07-10",
      }),
    ).toBe(true);
  });

  it("allows submission when the organisation is typed as a new name", () => {
    expect(
      canCreateEvent({
        title: "A New Event",
        organisation_id: "new:Typed Organisation",
        event_start_date: "2026-07-10",
      }),
    ).toBe(true);
  });

  it("blocks submission when the date is missing", () => {
    expect(
      canCreateEvent({
        title: "A New Event",
        organisation_id: "org_1",
        event_start_date: null,
      }),
    ).toBe(false);
  });
});

describe("getEventFormDateError", () => {
  it("rejects an end date before the start date", () => {
    expect(getEventFormDateError({ event_start_date: "2026-07-10", event_end_date: "2026-07-01", venue_bookings: [] }))
      .toBe("The event end date cannot be before the start date.");
  });

  it("rejects a post-show technical meeting in schedule details", () => {
    expect(getEventFormDateError({
      event_start_date: "2026-07-01",
      event_end_date: null,
      venue_bookings: [{ venue: "JBT", booking_status: "tentative", number_of_shows: 1, requirements: null, notes: null, schedule_entries: [{ activity_type: "technical_meeting", activity_date: "2026-07-10", start_time: null, end_time: null, with_ac_start: null, with_ac_end: null, with_ac_minutes: null, without_ac_start: null, without_ac_end: null, without_ac_minutes: null, notes: null }] }],
    })).toContain("post-show");
  });

  it("allows dismantling after the final show", () => {
    expect(getEventFormDateError({
      event_start_date: "2026-07-01",
      event_end_date: null,
      venue_bookings: [{ venue: "JBT", booking_status: "tentative", number_of_shows: 1, requirements: null, notes: null, schedule_entries: [{ activity_type: "dismantling", activity_date: "2026-07-02", start_time: null, end_time: null, with_ac_start: null, with_ac_end: null, with_ac_minutes: null, without_ac_start: null, without_ac_end: null, without_ac_minutes: null, notes: null }] }],
    })).toBeNull();
  });
});

describe("organisationValueFromName", () => {
  it("stores typed organisation text as a new organisation value", () => {
    expect(organisationValueFromName(" Test Organisation ")).toBe("new:Test Organisation");
  });

  it("clears the form value when the typed organisation is blank", () => {
    expect(organisationValueFromName("   ")).toBe("");
  });
});
