/**
 * Printable Event Form snapshot — full filled-form HTML for ops, filing, and signing.
 * Print and "Export to PDF" both open this document; PDF is the browser's Save as PDF.
 */

import {
  CATERING_MEAL_TYPES,
  cateringMealPaxKey,
  cateringMealRequiredKey,
} from "../../worker/lib/catering-meals";
import { escapeHtml } from "./export";
import { omitEventLevelRequirements } from "./event-edit-form";
import { formatDate, formatDuration, formatTime, formatTimeRange } from "./use-lookups";

export type EventFormPrintScheduleEntry = {
  activity_type?: string | null;
  activity_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  with_ac_start?: string | null;
  with_ac_end?: string | null;
  with_ac_minutes?: number | null;
  without_ac_start?: string | null;
  without_ac_end?: string | null;
  without_ac_minutes?: number | null;
  notes?: string | null;
};

export type EventFormPrintVenueBooking = {
  venue?: string | null;
  booking_status?: string | null;
  number_of_shows?: number | null;
  notes?: string | null;
  requirements?: Record<string, unknown> | string | null;
  schedule_entries?: EventFormPrintScheduleEntry[] | null;
};

export type EventFormPrintDocument = {
  file_name: string;
  category?: string | null;
};

export type EventFormPrintInput = {
  event_code?: string | null;
  title?: string | null;
  description?: string | null;
  event_type?: string | null;
  status?: string | null;
  organisation_name?: string | null;
  primary_contact_name?: string | null;
  program_officer?: string | null;
  event_owner?: string | null;
  event_start_date?: string | null;
  event_end_date?: string | null;
  enquiry_source?: string | null;
  priority?: string | null;
  notes?: string | null;
  approval_status?: string | null;
  confirmation_status?: string | null;
  requirements?: Record<string, unknown> | string | null;
  venue_bookings?: EventFormPrintVenueBooking[] | null;
  documents?: EventFormPrintDocument[] | null;
};

const BLANK = "—";

/** Ordered venue requirement fields matching the Add/Edit Event form (excludes event-level contact). */
const CATERING_MEAL_FIELDS = CATERING_MEAL_TYPES.flatMap((meal) => [
  { key: cateringMealRequiredKey(meal.key), label: meal.label },
  { key: cateringMealPaxKey(meal.key), label: `${meal.label} — No. of Pax` },
]);

const REQUIREMENT_FIELDS: Array<{ key: string; label: string }> = [
  { key: "sound", label: "Sound Requirements" },
  { key: "sound_call_time", label: "Sound Call Time" },
  { key: "light", label: "Light Requirements" },
  { key: "light_call_time", label: "Light Call Time" },
  { key: "green_rooms_required", label: "Green Rooms Required" },
  { key: "green_room_amenities", label: "Green Room Amenities" },
  { key: "ushers_required", label: "Ushers Required" },
  { key: "ushers_call_time", label: "Ushers Call Time" },
  { key: "loaders_required", label: "Loaders Required" },
  { key: "loaders_call_time", label: "Loaders Call Time" },
  { key: "house_seats_release", label: "House Seats Release" },
  { key: "house_tickets", label: "House Tickets" },
  { key: "video_recording", label: "Video Recording" },
  { key: "camera_count", label: "No. of Cameras" },
  { key: "recording_type", label: "Recording Type" },
  { key: "piano_required", label: "Piano Required" },
  { key: "piano_tuning_time", label: "Piano Tuning Time" },
  { key: "liquor_licence", label: "Liquor Licence" },
  { key: "liquor_licence_details", label: "Liquor Licence Details" },
  { key: "catering_required", label: "Catering Required" },
  { key: "catering_provider", label: "Caterer" },
  ...CATERING_MEAL_FIELDS,
  { key: "interval", label: "Interval" },
  { key: "decorator_required", label: "Decorator" },
  { key: "decorator_name", label: "Decorator Name" },
  { key: "parking", label: "Parking Requirements" },
  { key: "security", label: "Security Notes" },
  { key: "housekeeping", label: "Housekeeping" },
  { key: "crew_cards", label: "No. of Crew Cards" },
  { key: "licenses_status", label: "Licences — Required" },
  { key: "licenses", label: "Licence Types (PPL/IPRS etc.)" },
  { key: "stage_setup", label: "Stage Setup" },
  { key: "foyer_setup", label: "Foyer Setup" },
  { key: "orchestra_pit_chairs", label: "Orchestra Pit Chairs" },
  { key: "orchestra_pit_chairs_note", label: "Orchestra Pit Chairs — notes" },
  { key: "digital_standee", label: "Digital Standee" },
  { key: "digital_standee_note", label: "Digital Standee — notes" },
  { key: "car_display", label: "Car Display" },
  { key: "car_display_note", label: "Car Display — notes" },
  { key: "bike_display", label: "Bike Display" },
  { key: "bike_display_note", label: "Bike Display — notes" },
  { key: "stalls", label: "Stalls" },
  { key: "stalls_note", label: "Stalls — notes" },
  { key: "telecasting_media", label: "Telecasting / Media" },
  { key: "telecasting_media_note", label: "Telecasting / Media — notes" },
];

const TIME_KEYS = new Set([
  "sound_call_time",
  "light_call_time",
  "ushers_call_time",
  "loaders_call_time",
  "piano_tuning_time",
]);

const CATEGORY_LABELS: Record<string, string> = {
  inquiry: "Inquiry",
  costing: "Costing",
  approval: "Approval",
  confirmation_letter: "Confirmation letter",
  technical_rider: "Technical rider",
  floor_plan: "Floor plan",
  licence: "Licence",
  accounts: "Accounts",
  tds_certificate: "TDS certificate",
  payment_advice: "Payment advice",
  event_report: "Event report",
  feedback: "Feedback",
  other: "Other",
};

function parseRequirements(value: EventFormPrintInput["requirements"]): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return value;
}

function text(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && !Number.isNaN(value)) return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function display(value: unknown): string {
  return text(value) ?? BLANK;
}

function titleCaseWords(value: string): string {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatEventType(value: string | null | undefined): string {
  if (!value) return BLANK;
  if (value === "VFH") return "VFH (Venue For Hire)";
  if (value === "EE") return "EE";
  if (value === "FR") return "FR (Foundation)";
  if (value === "FE" || value === "Free Event") return "Free Event";
  return value;
}

function formatOperatingWindow(start: string | null | undefined, end: string | null | undefined): string {
  if (!start) return BLANK;
  const startLabel = formatDate(start);
  if (!end || end === start) return startLabel;
  return `${startLabel} to ${formatDate(end)}`;
}

function formatStatus(value: string | null | undefined): string {
  if (!value) return BLANK;
  return titleCaseWords(value);
}

function formatRequirementValue(key: string, value: unknown): string {
  if (TIME_KEYS.has(key)) return formatTime(text(value));
  return display(value);
}

function minutesBetween(start: string | null | undefined, end: string | null | undefined): number | null {
  if (!start || !end) return null;
  const [sh = 0, sm = 0] = start.split(":").map(Number);
  const [eh = 0, em = 0] = end.split(":").map(Number);
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return null;
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins < 0) mins += 24 * 60;
  return mins;
}

function formatAcWindow(
  label: string,
  start: string | null | undefined,
  end: string | null | undefined,
  minutes: number | null | undefined,
): string | null {
  if (!start && !end) return null;
  const duration = minutes ?? minutesBetween(start, end);
  return `${label}: ${formatTimeRange(start, end)} (${formatDuration(duration)})`;
}

function formatScheduleEntry(entry: EventFormPrintScheduleEntry): string {
  const parts = [
    entry.activity_type ? titleCaseWords(entry.activity_type) : null,
    entry.activity_date ? formatDate(entry.activity_date) : null,
    entry.start_time || entry.end_time ? formatTimeRange(entry.start_time, entry.end_time) : null,
    formatAcWindow("With AC", entry.with_ac_start, entry.with_ac_end, entry.with_ac_minutes),
    formatAcWindow("Without AC", entry.without_ac_start, entry.without_ac_end, entry.without_ac_minutes),
    text(entry.notes),
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" · ") : BLANK;
}

function row(label: string, value: string): string {
  return `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`;
}

function section(title: string, bodyHtml: string): string {
  return `<section><h2>${escapeHtml(title)}</h2>${bodyHtml}</section>`;
}

function fieldTable(rows: Array<[string, string]>): string {
  return `<table class="fields">${rows.map(([label, value]) => row(label, value)).join("")}</table>`;
}

/** Primary heading on the printable form — event name only (code lives in the body). */
export function eventFormPrintTitle(input: EventFormPrintInput): string {
  return text(input.title) ?? "Event";
}

/** Browser tab / PDF document title. */
export function eventFormPrintDocumentTitle(input: EventFormPrintInput): string {
  return `Event Form — ${eventFormPrintTitle(input)}`;
}

/** Short description for the print header; full text remains in the Event & Client section. */
export function eventFormPrintDescriptionSummary(
  value: string | null | undefined,
  maxLength = 280,
): string | null {
  const raw = text(value);
  if (!raw) return null;
  const collapsed = raw.replace(/\s+/g, " ");
  if (collapsed.length <= maxLength) return collapsed;
  const slice = collapsed.slice(0, maxLength);
  const lastSpace = slice.lastIndexOf(" ");
  const trimmed = (lastSpace > maxLength * 0.55 ? slice.slice(0, lastSpace) : slice).trimEnd();
  return `${trimmed}…`;
}

export function eventFormPrintFileBase(input: EventFormPrintInput): string {
  const code = text(input.event_code);
  const title = (text(input.title) ?? "event").replace(/[^\w.-]+/g, "-").slice(0, 50);
  return code ? `Event-Form-${code}` : `Event-Form-${title}`;
}

/** Build the filled-form HTML body sections (without document chrome). */
export function buildEventFormPrintBody(input: EventFormPrintInput): string {
  const eventReqs = parseRequirements(input.requirements);
  const bookings = input.venue_bookings ?? [];
  const documents = (input.documents ?? []).filter((doc) => text(doc.file_name));

  const clientRows: Array<[string, string]> = [
    ["Event code", display(input.event_code)],
    ["Organisation", display(input.organisation_name)],
    ["Primary contact", display(input.primary_contact_name)],
    ["Event name", display(input.title)],
    ["Event type", formatEventType(input.event_type)],
    ["Status", formatStatus(input.status)],
    ["Operating window", formatOperatingWindow(input.event_start_date, input.event_end_date)],
    ["Enquiry source", display(input.enquiry_source)],
    ["Priority", formatStatus(input.priority)],
    ["Program officer", display(input.program_officer)],
    ["Program officer contact", display(eventReqs.program_officer_phone)],
    ["Event owner", display(input.event_owner)],
    ["Approval", formatStatus(input.approval_status)],
    ["Signed confirmation", formatStatus(input.confirmation_status)],
    ["Description", display(input.description)],
  ];

  const knownKeys = new Set(REQUIREMENT_FIELDS.map((field) => field.key));

  const venueSections = bookings.length === 0
    ? "<p class=\"empty\">No venue bookings recorded.</p>"
    : bookings.map((booking, index) => {
        const schedule = booking.schedule_entries ?? [];
        const scheduleHtml = schedule.length === 0
          ? "<p class=\"empty\">No schedule entries.</p>"
          : `<ol class="schedule">${schedule.map((entry) => `<li>${escapeHtml(formatScheduleEntry(entry))}</li>`).join("")}</ol>`;
        const venueReqs = parseRequirements(booking.requirements);
        // Legacy events: fall back to event-level requirements when the booking has none.
        const reqs = Object.keys(venueReqs).length > 0 ? venueReqs : omitEventLevelRequirements(eventReqs);
        const requirementRows = REQUIREMENT_FIELDS.map((field): [string, string] => [
          field.label,
          formatRequirementValue(field.key, reqs[field.key]),
        ]);
        const extraKeys = Object.keys(reqs)
          .filter((key) => key !== "program_officer_phone" && !knownKeys.has(key) && text(reqs[key]))
          .sort();
        for (const key of extraKeys) {
          requirementRows.push([titleCaseWords(key), formatRequirementValue(key, reqs[key])]);
        }
        return `<div class="venue-block">
<h3>Venue ${index + 1}</h3>
${fieldTable([
  ["Venue", display(booking.venue)],
  ["Booking status", formatStatus(booking.booking_status)],
  ["Number of shows", display(booking.number_of_shows)],
  ["Notes", display(booking.notes)],
])}
<h4>Schedule</h4>
${scheduleHtml}
<h4>Requirements</h4>
${fieldTable(requirementRows)}
</div>`;
      }).join("");

  const documentsHtml = documents.length === 0
    ? "<p class=\"empty\">No documents uploaded.</p>"
    : `<ul class="docs">${documents.map((doc) => {
        const category = text(doc.category);
        const categoryLabel = category
          ? CATEGORY_LABELS[category] ?? titleCaseWords(category)
          : null;
        const label = categoryLabel
          ? `${doc.file_name} (${categoryLabel})`
          : doc.file_name;
        return `<li>${escapeHtml(label)}</li>`;
      }).join("")}</ul>`;

  const notesSection = section("Notes", `<p class="notes">${escapeHtml(display(input.notes))}</p>`);

  const signatureSection = section(
    "Sign-off",
    `<div class="sign-grid">
<div class="sign-box"><div class="sign-label">Prepared by</div><div class="sign-line"></div><div class="sign-meta">Name / Date</div></div>
<div class="sign-box"><div class="sign-label">Reviewed by</div><div class="sign-line"></div><div class="sign-meta">Name / Date</div></div>
<div class="sign-box"><div class="sign-label">Approved / Signed</div><div class="sign-line"></div><div class="sign-meta">Name / Date</div></div>
</div>`,
  );

  return [
    section("Event & Client", fieldTable(clientRows)),
    section("Venues, Schedule & Requirements", venueSections),
    section("Documents", documentsHtml),
    notesSection,
    signatureSection,
  ].join("\n");
}

export function buildEventFormHtml(input: EventFormPrintInput): string {
  const heading = eventFormPrintTitle(input);
  const documentTitle = eventFormPrintDocumentTitle(input);
  const descriptionSummary = eventFormPrintDescriptionSummary(input.description);
  const generatedAt = new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  const summaryHtml = descriptionSummary
    ? `<p class="header-summary">${escapeHtml(descriptionSummary)}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(documentTitle)}</title>
<style>
  :root { color-scheme: light; }
  @page { size: A4; margin: 18mm 15mm 20mm 15mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: Georgia, 'Times New Roman', serif;
    color: #2f2c27;
    line-height: 1.45;
    font-size: 10.5pt;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  @media screen {
    body { margin: 28px auto; padding: 0 12px; max-width: 210mm; }
  }
  header {
    margin-bottom: 16px;
    padding-bottom: 10px;
    border-bottom: 1px solid #cfc7ba;
  }
  h1 { font-size: 18pt; line-height: 1.25; margin: 0 0 6px; font-weight: 700; }
  .header-summary { margin: 0 0 8px; font-size: 10.5pt; color: #4a453d; line-height: 1.5; }
  .meta { color: #6b655c; font-size: 9pt; margin: 0; }
  h2 {
    font-size: 11pt;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin: 20px 0 8px;
    border-bottom: 1px solid #cfc7ba;
    padding-bottom: 4px;
  }
  h3 { font-size: 11pt; margin: 14px 0 6px; }
  h4 { font-size: 10pt; margin: 10px 0 4px; color: #5c564c; }
  section { margin-bottom: 4px; }
  table.fields { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.fields th, table.fields td { vertical-align: top; padding: 5px 10px 5px 0; border-bottom: 1px solid #ece7df; }
  table.fields th { width: 34%; text-align: left; font-weight: 600; color: #5c564c; }
  table.fields td { width: 66%; white-space: pre-wrap; word-break: break-word; }
  .venue-block { margin-bottom: 14px; }
  .schedule, .docs { margin: 0; padding-left: 18px; }
  .schedule li, .docs li { margin: 3px 0; }
  .empty, .notes { margin: 0; }
  .sign-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 8px; }
  .sign-box { min-height: 72px; }
  .sign-label { font-size: 9pt; color: #5c564c; margin-bottom: 28px; }
  .sign-line { border-bottom: 1px solid #2f2c27; margin-bottom: 4px; }
  .sign-meta { font-size: 8pt; color: #6b655c; }
  .toolbar { margin-bottom: 16px; display: flex; gap: 8px; flex-wrap: wrap; }
  .toolbar button { font: inherit; padding: 6px 14px; cursor: pointer; }
  @media print {
    .toolbar { display: none; }
    header { break-after: avoid-page; page-break-after: avoid; }
    h2, h3, h4 { break-after: avoid-page; page-break-after: avoid; }
    table.fields tr { break-inside: avoid; page-break-inside: avoid; }
    .venue-block { break-inside: avoid-page; page-break-inside: avoid; }
    .sign-grid { break-inside: avoid; page-break-inside: avoid; }
  }
</style></head>
<body>
<div class="toolbar">
  <button type="button" onclick="window.print()">Print</button>
  <button type="button" onclick="window.print()">Export to PDF</button>
</div>
<header>
  <h1>${escapeHtml(heading)}</h1>
  ${summaryHtml}
  <div class="meta">NCPA Venue for Hire · Filled form snapshot · Generated ${escapeHtml(generatedAt)} IST</div>
</header>
${buildEventFormPrintBody(input)}
</body></html>`;
}

/** Open the printable event form in a new window for review before printing. */
export function openEventFormPrintable(input: EventFormPrintInput): void {
  const html = buildEventFormHtml(input);
  const win = window.open("", "_blank");
  if (!win) return;

  win.document.open();
  win.document.write(html);
  win.document.close();
}
