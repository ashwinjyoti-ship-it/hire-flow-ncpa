import { describe, expect, it } from "vitest";
import {
  buildMomDocument,
  buildMomDocumentHtml,
  buildMomAutoText,
  buildMomHtml,
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
    theatre_canteen_required: "Yes",
    canteen_before_show: "No",
    canteen_in_interval: "Yes",
    sit_down_meals_required: "Yes",
    catering_provider: "NCPA canteen",
    catering_lunch_required: "Yes",
    catering_lunch_pax: "120",
    catering_hi_tea_required: "Yes",
    catering_hi_tea_pax: "80",
    stage_setup: "Props, sofas & chairs by organisers. Black cyclorama & wings ready by 2:30pm.",
    foyer_setup: "Registration desk in the lobby; two digital standees at the entrance.",
    licenses_status: "Received",
    licenses: "PPL, IPRS",
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
    expect(doc).toContain("Registration desk in the lobby");
    expect(doc).toContain("Licences: Received — PPL, IPRS");
    expect(doc).toContain("Lunch: 120 pax");
    expect(doc).toContain("Hi-Tea: 80 pax");
    expect(doc).toContain("Theatre canteen – Before show: No; In interval: Yes");
    expect(doc).toContain("Sit-down caterer - NCPA canteen");
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
});

describe("buildMomDocumentHtml", () => {
  it("applies bold/underline hierarchy for client-facing mail", () => {
    const html = buildMomDocumentHtml(sample, "Technical Officer: TBC");
    expect(html).toContain("font-weight:700");
    expect(html).toContain("text-decoration:underline");
    expect(html).toContain("Nature of the event:");
    expect(html).toContain("Kaveesha Entertainments");
    expect(html).toContain("Additional / undecided items:");
    expect(html).toContain("Technical Officer: TBC");
    // Escapes raw user content rather than injecting markup.
    expect(html).not.toContain("<script");
  });

  it("escapes HTML special characters in event fields", () => {
    const html = buildMomDocumentHtml({
      title: "A <Play> & Show",
      organisation_name: "Org \"One\"",
      event_start_date: "2026-07-30",
      venue_bookings: [{ venue: "Tata Theatre", schedule_entries: [] }],
      requirements: {},
    });
    expect(html).toContain("A &lt;Play&gt; &amp; Show");
    expect(html).toContain("Org &quot;One&quot;");
    expect(html).not.toContain("A <Play>");
  });
});

describe("buildMomHtml", () => {
  it("wraps rich MoM body in a printable document", () => {
    const page = buildMomHtml(sample, "Minutes of Meeting — Test");
    expect(page).toContain("<!DOCTYPE html>");
    expect(page).toContain("font-weight:700");
    expect(page).toContain(">Print</button>");
    expect(page).toContain(">Export to PDF</button>");
    expect(page).toContain("Godrej Dance Theatre");
  });
});
