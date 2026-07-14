import { describe, expect, it } from "vitest";
import {
  CATERING_MEAL_TYPES,
  cateringMealPaxKey,
  cateringMealRequiredKey,
} from "../../worker/lib/catering-meals";
import {
  buildMomDocument,
  buildMomAutoText,
  formatMomLongDate,
  formatMomTime,
  getMomMissingFields,
  momMissingFieldsMessage,
} from "./mom";

const sample = {
  title: "Gujrati Play - Long Drive",
  description: "Gujrati Play - Long Drive",
  organisation_name: "Kaveesha Entertainments",
  event_type: "VFH",
  program_officer: "Ms. Binaifar Bhesania",
  event_start_date: "2026-07-30",
  requirements: {
    program_officer_phone: "022 66223822",
    sound: "NCPA basic sound",
    light: "NCPA basic lights",
    light_call_time: "14:30",
    ushers_required: "Yes",
    ushers_call_time: "18:00",
    house_seats_release: "Yes",
    house_tickets: "NCPA pass",
    catering_required: "Yes",
    catering_provider: "NCPA canteen",
    catering_lunch_required: "Yes",
    catering_lunch_pax: "120",
    catering_hi_tea_required: "Yes",
    catering_hi_tea_pax: "80",
    interval: "Yes",
    stage_setup: "Props, sofas & chairs by organisers. Black cyclorama & wings ready by 2:30pm.",
    digital_standee: "Yes",
    digital_standee_note: "2 Standees",
    parking: "1 Parking space for tempo required",
    security: "Stage door monitoring",
    housekeeping: "Toilets cleaned and opened by 2pm",
    orchestra_pit_chairs: "Keep",
    orchestra_pit_chairs_note: "12 chairs",
  },
  venue_bookings: [
    {
      venue: "Godrej Dance Theatre",
      number_of_shows: 1,
      schedule_entries: [
        {
          activity_type: "setup",
          activity_date: "2026-07-30",
          start_time: "14:30",
          end_time: "15:30",
          without_ac_start: "14:30",
          without_ac_end: "15:30",
        },
        {
          activity_type: "show",
          activity_date: "2026-07-30",
          start_time: "19:00",
          end_time: "21:20",
          with_ac_start: "15:30",
          with_ac_end: "21:30",
        },
        {
          activity_type: "dismantling",
          activity_date: "2026-07-30",
          start_time: "21:30",
          end_time: "00:30",
        },
      ],
    },
  ],
};

describe("formatMomTime", () => {
  it("formats 12-hour times for MoM copy", () => {
    expect(formatMomTime("14:30")).toBe("2:30pm");
    expect(formatMomTime("19:00")).toBe("7pm");
  });
});

describe("formatMomLongDate", () => {
  it("formats weekday long dates", () => {
    expect(formatMomLongDate("2026-07-30")).toContain("July");
    expect(formatMomLongDate("2026-07-30")).toContain("2026");
  });
});

describe("getMomMissingFields", () => {
  it("lists empty MoM-relevant fields", () => {
    const missing = getMomMissingFields({ title: "Only title" });
    expect(missing.map((f) => f.key)).toContain("organisation_name");
    expect(missing.map((f) => f.key)).toContain("venue");
    expect(momMissingFieldsMessage(missing)).toContain("not filled");
  });

  it("returns no missing fields for a complete sample", () => {
    expect(getMomMissingFields(sample)).toEqual([]);
  });
});

describe("buildMomDocument", () => {
  it("compiles form fields through Program Officer and appends custom notes after", () => {
    const doc = buildMomDocument(sample, "Technical Officer: TBC\nInterval for 15 minutes.");
    expect(doc).toContain("Kaveesha Entertainments");
    expect(doc).toContain("Godrej Dance Theatre");
    expect(doc).toContain("Nature of the event:");
    expect(doc).toContain("NCPA basic sound");
    expect(doc).toContain("2 Standees");
    expect(doc).toContain("12 chairs");
    expect(doc).toContain("Props, sofas & chairs by organisers");
    expect(doc).toContain("Lunch: 120 pax");
    expect(doc).toContain("Hi-Tea: 80 pax");
    expect(doc).toContain("Interval – Yes");
    expect(doc).toContain("Ms. Binaifar Bhesania – 022 66223822");
    expect(doc).toContain("Additional / undecided items:");
    expect(doc).toContain("Technical Officer: TBC");
    expect(doc.indexOf("Program Officer:")).toBeLessThan(doc.indexOf("Technical Officer: TBC"));
  });

  it("uses TBC for empty sections", () => {
    const auto = buildMomAutoText({
      title: "Sparse Event",
      organisation_name: "Org",
      event_start_date: "2026-07-30",
      venue_bookings: [{ venue: "Tata Theatre", number_of_shows: 1, schedule_entries: [] }],
      requirements: {},
    });
    expect(auto).toContain("Setup on Stage: -");
    expect(auto).toContain("TBC");
    expect(auto).toContain("Program Officer: -");
  });

  it("renders zero show entries in the timings section", () => {
    const auto = buildMomAutoText({
      title: "Zero Show Event",
      organisation_name: "Org",
      event_start_date: "2026-07-30",
      venue_bookings: [{
        venue: "JBT",
        number_of_shows: 0,
        schedule_entries: [{
          activity_type: "zero_show",
          activity_date: "2026-07-30",
          start_time: "10:00",
          end_time: "11:00",
        }],
      }],
      requirements: {},
    });
    expect(auto).toContain("Zero Show: 10am to 11am");
  });
});

describe("catering meal MoM mapping", () => {
  function cateringRequirements(overrides: Record<string, string> = {}): Record<string, string> {
    return {
      catering_required: "Yes",
      catering_provider: "NCPA Canteen",
      interval: "Yes",
      ...overrides,
    };
  }

  it("maps every meal pax into the vendors section when marked required", () => {
    const requirements = cateringRequirements();
    for (const meal of CATERING_MEAL_TYPES) {
      requirements[cateringMealRequiredKey(meal.key)] = "Yes";
      requirements[cateringMealPaxKey(meal.key)] = String(50 + CATERING_MEAL_TYPES.indexOf(meal));
    }

    const auto = buildMomAutoText({
      title: "Catering Event",
      organisation_name: "Org",
      event_start_date: "2026-07-30",
      venue_bookings: [{ venue: "JBT", number_of_shows: 1, schedule_entries: [] }],
      requirements,
    });

    expect(auto).toContain("Caterer - NCPA Canteen");
    for (const meal of CATERING_MEAL_TYPES) {
      const pax = requirements[cateringMealPaxKey(meal.key)];
      expect(auto).toContain(`${meal.label}: ${pax} pax`);
    }
    expect(auto).toContain(". Interval: Yes");
  });

  it("omits meals not marked required from the vendors section", () => {
    const auto = buildMomAutoText({
      title: "Catering Event",
      organisation_name: "Org",
      event_start_date: "2026-07-30",
      venue_bookings: [{ venue: "JBT", number_of_shows: 1, schedule_entries: [] }],
      requirements: cateringRequirements({
        catering_lunch_required: "Yes",
        catering_lunch_pax: "120",
        catering_dinner_required: "No",
        catering_dinner_pax: "999",
      }),
    });

    expect(auto).toContain("Lunch: 120 pax");
    expect(auto).not.toContain("Dinner:");
    expect(auto).not.toContain("999 pax");
  });

  it("flags missing pax for each meal marked required", () => {
    for (const meal of CATERING_MEAL_TYPES) {
      const requirements = cateringRequirements({
        [cateringMealRequiredKey(meal.key)]: "Yes",
      });
      const missing = getMomMissingFields({
        title: "Catering Event",
        organisation_name: "Org",
        event_start_date: "2026-07-30",
        program_officer: "Officer",
        venue_bookings: [{
          venue: "JBT",
          number_of_shows: 1,
          schedule_entries: [{ activity_type: "show", activity_date: "2026-07-30", start_time: "19:00", end_time: "21:00" }],
        }],
        requirements: {
          program_officer_phone: "022 1",
          sound: "PA",
          light: "Basic",
          security: "Standard",
          housekeeping: "Standard",
          stage_setup: "Standard",
          ...requirements,
        },
      });
      expect(missing.map((field) => field.key)).toContain(cateringMealPaxKey(meal.key));
    }
  });

  it("shows TBC in vendors when a required meal has no pax but generation continues", () => {
    const auto = buildMomAutoText({
      title: "Catering Event",
      organisation_name: "Org",
      event_start_date: "2026-07-30",
      venue_bookings: [{ venue: "JBT", number_of_shows: 1, schedule_entries: [] }],
      requirements: cateringRequirements({
        catering_breakfast_required: "Yes",
      }),
    });
    expect(auto).toContain("Breakfast: TBC");
  });
});
