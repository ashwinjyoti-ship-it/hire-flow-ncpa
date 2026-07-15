import { describe, expect, it } from "vitest";
import {
  aggregateRequirements,
  buildEventRequirementsPayload,
  canCreateEvent,
  createDefaultEventLevelRequirements,
  createDefaultVenueRequirements,
  getEventFormDateError,
  getScheduleValidationError,
  hydrateVenueRequirements,
  organisationValueFromName,
  prepareVenueBookingsForSave,
  pickEventLevelRequirements,
  withDefaultVenueRequirements,
} from "./event-edit-form";
import type { VenueBookingInputT } from "../../worker/lib/types";

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

  it("rejects a post-show zero show in schedule details", () => {
    expect(getEventFormDateError({
      event_start_date: "2026-07-01",
      event_end_date: null,
      venue_bookings: [{ venue: "JBT", booking_status: "tentative", number_of_shows: 1, requirements: null, notes: null, schedule_entries: [{ activity_type: "zero_show", activity_date: "2026-07-10", start_time: null, end_time: null, with_ac_start: null, with_ac_end: null, with_ac_minutes: null, without_ac_start: null, without_ac_end: null, without_ac_minutes: null, notes: null }] }],
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

describe("getScheduleValidationError", () => {
  it("no longer blocks save for incomplete schedule rows", () => {
    expect(getScheduleValidationError([
      {
        venue: "JBT",
        booking_status: "tentative",
        number_of_shows: 1,
        requirements: null,
        notes: null,
        schedule_entries: [{
          activity_type: "show",
          activity_date: "",
          start_time: null,
          end_time: null,
          with_ac_start: "18:00",
          with_ac_end: "21:00",
          with_ac_minutes: 180,
          without_ac_start: null,
          without_ac_end: null,
          without_ac_minutes: null,
          notes: null,
        }],
      },
    ])).toBeNull();
  });
});

describe("prepareVenueBookingsForSave", () => {
  it("drops empty venues and undated schedule stubs", () => {
    const prepared = prepareVenueBookingsForSave([
      { venue: "", booking_status: "tentative", number_of_shows: 1, requirements: null, notes: null, schedule_entries: [] },
      {
        venue: "JBT",
        booking_status: "tentative",
        number_of_shows: 1,
        requirements: null,
        notes: null,
        schedule_entries: [
          {
            activity_type: "show",
            activity_date: "2026-07-10",
            start_time: null,
            end_time: null,
            with_ac_start: "18:00",
            with_ac_end: "21:00",
            with_ac_minutes: 180,
            without_ac_start: null,
            without_ac_end: null,
            without_ac_minutes: null,
            notes: null,
          },
          {
            activity_type: "setup",
            activity_date: "",
            start_time: null,
            end_time: null,
            with_ac_start: "10:00",
            with_ac_end: "12:00",
            with_ac_minutes: 120,
            without_ac_start: null,
            without_ac_end: null,
            without_ac_minutes: null,
            notes: null,
          },
        ],
      },
    ]);
    expect(prepared).toHaveLength(1);
    expect(prepared[0]?.schedule_entries).toHaveLength(1);
    expect(prepared[0]?.schedule_entries[0]?.activity_date).toBe("2026-07-10");
  });
});

describe("requirement defaults", () => {
  it("pre-fills every requirement dropdown with its negative option", () => {
    const defaults = createDefaultVenueRequirements();
    expect(defaults.green_rooms_required).toBe("Not Required");
    expect(defaults.video_recording).toBe("No");
    expect(defaults.orchestra_pit_chairs).toBe("Keep");
    expect(defaults.licenses_status).toBe("Not required");
    expect(defaults.catering_breakfast_required).toBe("No");
  });

  it("merges saved values over defaults without dropping explicit choices", () => {
    expect(withDefaultVenueRequirements({ piano_required: "Yes" }).piano_required).toBe("Yes");
    expect(withDefaultVenueRequirements({ piano_required: "Yes" }).licenses_status).toBe("Not required");
    expect(createDefaultEventLevelRequirements().vendor_registration_form).toBe("No Applicable");
  });
});

describe("per-venue requirements helpers", () => {
  it("hydrates empty venue bookings from legacy event requirements", () => {
    const bookings = [
      { venue: "JBT", booking_status: "tentative", number_of_shows: 1, requirements: null, notes: null, schedule_entries: [] },
      { venue: "TATA", booking_status: "tentative", number_of_shows: 1, requirements: { sound: "Already set" }, notes: null, schedule_entries: [] },
    ] as VenueBookingInputT[];

    const hydrated = hydrateVenueRequirements(bookings, {
      program_officer_phone: "022 1",
      sound: "PA",
      light: "Basic",
    });

    expect(hydrated[0]!.requirements).toEqual({ sound: "PA", light: "Basic" });
    expect(hydrated[1]!.requirements).toEqual({ sound: "Already set" });
    expect(pickEventLevelRequirements({
      program_officer_phone: "022 1",
      sound: "PA",
    })).toEqual({ program_officer_phone: "022 1" });
  });

  it("aggregates venue requirements for the denormalised event payload", () => {
    const bookings = [
      { venue: "JBT", booking_status: "tentative", number_of_shows: 1, requirements: { sound: "A", piano_required: "No", crew_cards: "2" }, notes: null, schedule_entries: [] },
      { venue: "TATA", booking_status: "tentative", number_of_shows: 1, requirements: { sound: "B", piano_required: "Yes", crew_cards: "5" }, notes: null, schedule_entries: [] },
    ] as VenueBookingInputT[];

    expect(aggregateRequirements([
      bookings[0]!.requirements as Record<string, unknown>,
      bookings[1]!.requirements as Record<string, unknown>,
    ])).toEqual({
      sound: "A · B",
      piano_required: "Yes",
      crew_cards: "5",
    });

    expect(buildEventRequirementsPayload(bookings, { program_officer_phone: "99" })).toMatchObject({
      program_officer_phone: "99",
      piano_required: "Yes",
      crew_cards: "5",
    });
  });
});
