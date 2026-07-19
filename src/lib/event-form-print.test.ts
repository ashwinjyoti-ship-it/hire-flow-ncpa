import { describe, expect, it, vi } from "vitest";
import {
  buildEventFormHtml,
  buildEventFormPrintBody,
  eventFormPrintDescriptionSummary,
  eventFormPrintDocumentTitle,
  eventFormPrintFileBase,
  eventFormPrintTitle,
  openEventFormPrintable,
} from "./event-form-print";

const sample = {
  event_code: "VFH-2026-014",
  title: "Gujrati Play - Long Drive",
  description: "Evening performance",
  event_type: "VFH",
  status: "confirmed",
  organisation_name: "Kaveesha Entertainments",
  primary_contact_name: "Ms. Mehta",
  program_officer: "Ms. Binaifar Bhesania",
  event_owner: "Ashwin",
  event_start_date: "2026-07-30",
  event_end_date: "2026-07-30",
  enquiry_source: "Email",
  priority: "medium",
  notes: "House seats held until Friday.",
  approval_status: "approved",
  confirmation_status: "signed",
  requirements: {
    program_officer_phone: "022 66223822",
    sound: "NCPA basic sound",
    light_call_time: "14:30",
    ushers_required: "Yes",
    stage_setup: "Black cyclorama ready by 2:30pm.",
    digital_standee: "Yes",
    digital_standee_note: "2 Standees",
  },
  venue_bookings: [
    {
      venue: "Godrej Dance Theatre",
      booking_status: "confirmed",
      number_of_shows: 1,
      notes: null,
      schedule_entries: [
        {
          activity_type: "show",
          activity_date: "2026-07-30",
          start_time: "19:00",
          end_time: "21:00",
          with_ac_start: "18:30",
          with_ac_end: "21:00",
          with_ac_minutes: 150,
          without_ac_start: null,
          without_ac_end: null,
          without_ac_minutes: null,
          notes: null,
        },
      ],
    },
  ],
  documents: [
    { file_name: "Confirmation_Letter.pdf", category: "confirmation_letter" },
    { file_name: "Floor_Plan.png", category: "floor_plan" },
  ],
};

describe("event-form-print", () => {
  it("uses event name for the print heading and keeps the code for file naming", () => {
    expect(eventFormPrintTitle(sample)).toBe("Gujrati Play - Long Drive");
    expect(eventFormPrintDocumentTitle(sample)).toBe("Event Form — Gujrati Play - Long Drive");
    expect(eventFormPrintFileBase(sample)).toBe("Event-Form-VFH-2026-014");
  });

  it("summarises long descriptions for the print header", () => {
    expect(eventFormPrintDescriptionSummary("Evening performance")).toBe("Evening performance");
    expect(eventFormPrintDescriptionSummary(null)).toBeNull();
    const long = "A".repeat(300);
    const summary = eventFormPrintDescriptionSummary(long);
    expect(summary).not.toBeNull();
    expect(summary!.length).toBeLessThanOrEqual(281);
    expect(summary!.endsWith("…")).toBe(true);
  });

  it("renders filled client, venue, requirement, document, and sign-off sections", () => {
    const body = buildEventFormPrintBody(sample);

    expect(body).toContain("Event &amp; Client");
    expect(body).toContain("Kaveesha Entertainments");
    expect(body).toContain("Godrej Dance Theatre");
    expect(body).toContain("Show");
    expect(body).toContain("NCPA basic sound");
    expect(body).toContain("14:30");
    expect(body).toContain("Venues, Schedule &amp; Requirements");
    expect(body).toContain("Program officer contact");
    expect(body).toContain("Confirmation_Letter.pdf (Confirmation letter)");
    expect(body).toContain("Floor_Plan.png (Floor plan)");
    expect(body).toContain("House seats held until Friday.");
    expect(body).toContain("Sign-off");
    expect(body).toContain("Prepared by");
  });

  it("prints per-venue requirements when bookings carry their own values", () => {
    const body = buildEventFormPrintBody({
      ...sample,
      requirements: { program_officer_phone: "022 1" },
      venue_bookings: [
        {
          venue: "JBT",
          booking_status: "confirmed",
          number_of_shows: 1,
          requirements: { sound: "JBT PA" },
          schedule_entries: [],
        },
        {
          venue: "TATA",
          booking_status: "tentative",
          number_of_shows: 1,
          requirements: { sound: "TATA array" },
          schedule_entries: [],
        },
      ],
    });

    expect(body).toContain("JBT PA");
    expect(body).toContain("TATA array");
    expect(body).toContain("<h4>Requirements</h4>");
  });

  it("lists blank requirement labels under venues and omits document names when none uploaded", () => {
    const body = buildEventFormPrintBody({
      title: "Draft event",
      requirements: {},
      venue_bookings: [{ venue: "JBT", booking_status: "tentative", number_of_shows: 1, requirements: {}, schedule_entries: [] }],
      documents: [],
    });

    expect(body).toContain("Sound Requirements");
    expect(body).toContain("—");
    expect(body).toContain("No documents uploaded.");
  });

  it("notes when no venue bookings are recorded", () => {
    const body = buildEventFormPrintBody({
      title: "Draft event",
      requirements: {},
      venue_bookings: [],
      documents: [],
    });

    expect(body).toContain("No venue bookings recorded.");
    expect(body).toContain("No documents uploaded.");
  });

  it("opens print HTML via document.write instead of a blob URL", () => {
    const writes: string[] = [];
    const mockWin = {
      document: {
        readyState: "complete",
        open: () => undefined,
        write: (html: string) => {
          writes.push(html);
        },
        close: () => undefined,
      },
      focus: () => undefined,
      print: () => undefined,
      addEventListener: () => undefined,
    };
    const openSpy = vi.fn().mockReturnValue(mockWin);
    vi.stubGlobal("window", { open: openSpy });

    openEventFormPrintable(sample, false);

    expect(openSpy).toHaveBeenCalledWith("", "_blank");
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("<h1>Gujrati Play - Long Drive</h1>");
    expect(writes[0]).not.toContain("blob:");

    vi.unstubAllGlobals();
  });

  it("builds print-ready HTML with separate Print and Export to PDF toolbar actions", () => {
    const html = buildEventFormHtml(sample);

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("window.print()");
    expect(html).toContain(">Print</button>");
    expect(html).toContain(">Export to PDF</button>");
    expect(html).toContain("@page { size: A4;");
    expect(html).toContain("<h1>Gujrati Play - Long Drive</h1>");
    expect(html).toContain('class="header-summary">Evening performance</p>');
    expect(html).not.toContain("<h1>Event Form — VFH-2026-014");
    expect(html).toContain("Filled form snapshot");
  });
});
