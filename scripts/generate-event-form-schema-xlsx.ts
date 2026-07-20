/**
 * Generates docs/event-form-database-schema.xlsx — a client-facing reference for
 * event-form data entry and bulk import. Re-run after schema or form-field changes:
 *   npx tsx scripts/generate-event-form-schema-xlsx.ts
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { utils, write } from "xlsx";
import { CATERING_MEAL_TYPES, cateringMealPaxKey, cateringMealRequiredKey } from "../worker/lib/catering-meals";
import { POC_FIELD_LABELS, POC_REQUIRED_FIELD_KEYS, VENDOR_REGISTRATION_OPTIONS } from "../worker/lib/poc-fields";
import { ACTIVITY_TYPES } from "../worker/lib/types";
import { DROPDOWN_LISTS, VENUES } from "./seed/seed-data";

type Row = Record<string, string | number | boolean | null | undefined>;

function sheet(name: string, rows: Row[]) {
  const ws = utils.json_to_sheet(rows);
  return { name, ws };
}

function columnDef(
  table: string,
  column: string,
  dataType: string,
  required: string,
  notes: string,
  storage: string,
  allowedValues = "",
): Row {
  return { Table: table, Column: column, "Data type": dataType, Required: required, "Allowed values": allowedValues, Storage: storage, Notes: notes };
}

const EVENT_LEVEL_REQUIREMENT_KEYS = [
  { key: "program_officer_phone", label: "Program Officer Phone", type: "text", required: "No", notes: "Auto-filled from programme officer lookup when selected" },
  { key: "poc_name", label: "POC Name", type: "text", required: "Yes (for confirmation)", notes: "Point of contact for the booking organisation" },
  { key: "poc_contact_number", label: "POC Contact Number", type: "text", required: "Yes (for confirmation)", notes: "" },
  { key: "poc_email", label: "POC Email", type: "email", required: "Yes (for confirmation)", notes: "" },
  { key: "event_company_contact_name", label: "Event Company Contact Name", type: "text", required: "No", notes: "Separate from booking org POC when event company differs" },
  { key: "event_company_contact_number", label: "Event Company Contact Number", type: "text", required: "No", notes: "" },
  { key: "event_company_email", label: "Event Company Email", type: "email", required: "No", notes: "" },
  { key: "bank_details", label: "Bank Details", type: "textarea", required: "Yes (for confirmation)", notes: "Free text; multiline" },
  { key: "gst_no", label: "GST No.", type: "text", required: "No", notes: "" },
  { key: "tan_no", label: "TAN No.", type: "text", required: "No", notes: "" },
  { key: "pan_no", label: "PAN No.", type: "text", required: "No", notes: "" },
  { key: "signing_authority_address", label: "Signing Authority & Address", type: "textarea", required: "Yes (for confirmation)", notes: "" },
  { key: "courier_address", label: "Courier Address", type: "textarea", required: "No", notes: "" },
  { key: "vendor_registration_form", label: "Vendor Registration Form", type: "dropdown", required: "No", notes: `Default: Not Applicable. Options: ${VENDOR_REGISTRATION_OPTIONS.join(" | ")}` },
] as const;

const VENUE_REQUIREMENT_FIELDS: Array<{ key: string; label: string; type: string; notes: string }> = [
  { key: "sound", label: "Sound Requirements", type: "text/Yes-No", notes: "Yes | No | free text when required" },
  { key: "sound_call_time", label: "Sound Call Time", type: "time HH:MM", notes: "IST" },
  { key: "light", label: "Light Requirements", type: "text/Yes-No", notes: "" },
  { key: "light_call_time", label: "Light Call Time", type: "time HH:MM", notes: "" },
  { key: "green_rooms_required", label: "Green Rooms Required", type: "Yes/No/N/A", notes: "" },
  { key: "green_room_amenities", label: "Green Room Amenities", type: "text", notes: "" },
  { key: "ushers_required", label: "Ushers Required", type: "Yes/No/N/A", notes: "" },
  { key: "ushers_call_time", label: "Ushers Call Time", type: "time HH:MM", notes: "" },
  { key: "loaders_required", label: "Loaders Required", type: "Yes/No/N/A", notes: "" },
  { key: "loaders_call_time", label: "Loaders Call Time", type: "time HH:MM", notes: "" },
  { key: "house_seats_release", label: "House Seats Release", type: "text", notes: "" },
  { key: "house_tickets", label: "House Tickets", type: "text", notes: "" },
  { key: "video_recording", label: "Video Recording", type: "Yes/No/N/A", notes: "" },
  { key: "camera_count", label: "No. of Cameras", type: "number", notes: "" },
  { key: "recording_type", label: "Recording Type", type: "text", notes: "" },
  { key: "piano_required", label: "Piano Required", type: "Yes/No/N/A", notes: "" },
  { key: "piano_tuning_time", label: "Piano Tuning Time", type: "time HH:MM", notes: "" },
  { key: "liquor_licence", label: "Liquor Licence", type: "Yes/No/N/A", notes: "" },
  { key: "liquor_licence_details", label: "Liquor Licence Details", type: "text", notes: "" },
  { key: "catering_required", label: "Catering Required", type: "Yes/No/N/A", notes: "" },
  { key: "catering_provider", label: "Caterer", type: "dropdown", notes: "Must match caterer lookup value" },
  ...CATERING_MEAL_TYPES.flatMap((meal) => [
    { key: cateringMealRequiredKey(meal.key), label: `${meal.label} — Required`, type: "Yes/No/N/A", notes: "" },
    { key: cateringMealPaxKey(meal.key), label: `${meal.label} — No. of Pax`, type: "number", notes: "Only when meal = Yes" },
  ]),
  { key: "interval", label: "Interval", type: "text", notes: "" },
  { key: "decorator_required", label: "Decorator", type: "Yes/No/N/A", notes: "" },
  { key: "decorator_name", label: "Decorator Name", type: "dropdown/text", notes: "Must match decorator lookup when set" },
  { key: "parking", label: "Parking Requirements", type: "text", notes: "" },
  { key: "security", label: "Security Notes", type: "text", notes: "" },
  { key: "housekeeping", label: "Housekeeping", type: "text", notes: "" },
  { key: "crew_cards", label: "No. of Crew Cards", type: "number", notes: "" },
  { key: "licenses_status", label: "Licences — Required", type: "dropdown", notes: "Not Required | Awaiting | Received" },
  { key: "licenses", label: "Licence Types (PPL/IPRS etc.)", type: "text", notes: "" },
  { key: "stage_setup", label: "Stage Setup", type: "text", notes: "" },
  { key: "foyer_setup", label: "Foyer Setup", type: "text", notes: "" },
  { key: "orchestra_pit_chairs", label: "Orchestra Pit Chairs", type: "Yes/No/N/A", notes: "" },
  { key: "orchestra_pit_chairs_note", label: "Orchestra Pit Chairs — notes", type: "text", notes: "" },
  { key: "digital_standee", label: "Digital Standee", type: "Yes/No/N/A", notes: "" },
  { key: "digital_standee_note", label: "Digital Standee — notes", type: "text", notes: "" },
  { key: "car_display", label: "Car Display", type: "Yes/No/N/A", notes: "" },
  { key: "car_display_note", label: "Car Display — notes", type: "text", notes: "" },
  { key: "bike_display", label: "Bike Display", type: "Yes/No/N/A", notes: "" },
  { key: "bike_display_note", label: "Bike Display — notes", type: "text", notes: "" },
  { key: "stalls", label: "Stalls", type: "Yes/No/N/A", notes: "" },
  { key: "stalls_note", label: "Stalls — notes", type: "text", notes: "" },
  { key: "telecasting_media", label: "Telecasting / Media", type: "Yes/No/N/A", notes: "" },
  { key: "telecasting_media_note", label: "Telecasting / Media — notes", type: "text", notes: "" },
];

const overview: Row[] = [
  { Topic: "Purpose", Detail: "Reference for preparing client-supplied event data that can be imported into NCPA Venue for Hire." },
  { Topic: "App version", Detail: "Generated from repo schema migrations 0001–0041" },
  { Topic: "Date format", Detail: "YYYY-MM-DD (e.g. 2026-07-20). Times: HH:MM in Asia/Kolkata (IST)." },
  { Topic: "IDs", Detail: "System-generated unless importing legacy Enquiry ID as event_code. Do not invent UUIDs for org/contact unless doing a technical migration." },
  { Topic: "Organisation anchor", Detail: "Every event must link to one organisation. Client org name is the primary match key for bulk import." },
  { Topic: "Multi-venue events", Detail: "One event row + one venue_bookings row per venue. Repeat schedule rows per venue booking." },
  { Topic: "JSON requirements", Detail: "POC and technical/catering fields are stored in events.requirements and venue_bookings.requirements JSON — see dedicated sheets." },
  { Topic: "Operations checklist", Detail: "NOT part of the event form. Workflow fields (financials, NOC, etc.) live in checklist_items and are seeded automatically per event." },
  { Topic: "Lookup values", Detail: "Venue, caterer, decorator, staff names must match dropdown_options — see Lookups sheet." },
  { Topic: "Import template", Detail: "Use the Import_Template sheet for flat bulk entry (legacy tracker shape). Full form import needs one row per venue + schedule expansion." },
  { Topic: "Required for confirmation", Detail: `POC fields: ${POC_REQUIRED_FIELD_KEYS.join(", ")}` },
];

const tablesOverview: Row[] = [
  { Table: "organisations", Role: "Client / booking organisation", "Import?": "Yes", "Event form step": "Organisation picker" },
  { Table: "contacts", Role: "People at the organisation", "Import?": "Yes", "Event form step": "Primary contact" },
  { Table: "events", Role: "Master event record", "Import?": "Yes", "Event form step": "Step 1 — header + POC (requirements JSON)" },
  { Table: "venue_bookings", Role: "One row per booked venue", "Import?": "Yes", "Event form step": "Step 2 — per-venue requirements JSON" },
  { Table: "schedule_entries", Role: "Setup / rehearsal / show / dismantling / zero_show", "Import?": "Yes", "Event form step": "Step 2 — schedule grid" },
  { Table: "dropdown_options", Role: "Lookup lists (venues, staff, caterers…)", "Import?": "Admin seed only", "Event form step": "Dropdowns" },
  { Table: "checklist_items", Role: "Operations & accounts workflow", "Import?": "Auto-created", "Event form step": "Operations tab (not event form)" },
  { Table: "documents", Role: "File attachments (R2)", "Import?": "Separate file upload", "Event form step": "Documents section" },
];

const organisations = [
  columnDef("organisations", "id", "TEXT", "System", "ULID-like primary key", "Column"),
  columnDef("organisations", "name", "TEXT", "Yes", "Display name; import match key (case-insensitive)", "Column"),
  columnDef("organisations", "org_type", "TEXT", "No", "e.g. corporate, foundation, individual", "Column"),
  columnDef("organisations", "address", "TEXT", "No", "", "Column"),
  columnDef("organisations", "gst_number", "TEXT", "No", "Org-level; event form uses events.requirements.gst_no", "Column"),
  columnDef("organisations", "pan_number", "TEXT", "No", "", "Column"),
  columnDef("organisations", "tan_number", "TEXT", "No", "", "Column"),
  columnDef("organisations", "bank_details", "JSON", "No", "{bank, account_name, account_no, ifsc, branch}", "Column"),
  columnDef("organisations", "notes", "TEXT", "No", "", "Column"),
];

const contacts = [
  columnDef("contacts", "id", "TEXT", "System", "", "Column"),
  columnDef("contacts", "organisation_id", "TEXT FK", "Yes", "→ organisations.id", "Column"),
  columnDef("contacts", "name", "TEXT", "Yes", "", "Column"),
  columnDef("contacts", "role", "TEXT", "No", "Job title", "Column"),
  columnDef("contacts", "email", "TEXT", "No", "Valid email if provided", "Column"),
  columnDef("contacts", "phone", "TEXT", "No", "", "Column"),
  columnDef("contacts", "is_primary", "INTEGER 0/1", "No", "1 = primary contact for org", "Column"),
  columnDef("contacts", "signing_authority", "INTEGER 0/1", "No", "", "Column"),
  columnDef("contacts", "courier_address", "TEXT", "No", "", "Column"),
];

const events = [
  columnDef("events", "id", "TEXT", "System", "", "Column"),
  columnDef("events", "event_code", "TEXT UNIQUE", "Recommended", "Legacy Enquiry ID; upsert key for import", "Column"),
  columnDef("events", "title", "TEXT", "Yes", "Event title / type of event", "Column"),
  columnDef("events", "description", "TEXT", "No", "", "Column"),
  columnDef("events", "organisation_id", "TEXT FK", "Yes", "→ organisations.id", "Column"),
  columnDef("events", "primary_contact_id", "TEXT FK", "No", "→ contacts.id", "Column"),
  columnDef("events", "event_type", "TEXT", "No", "EE | FR | VFH | Free Event", "Column"),
  columnDef("events", "program_officer", "TEXT", "No", "Must match program_officer lookup", "Column"),
  columnDef("events", "event_owner", "TEXT", "No", "Handled By — handled_by lookup", "Column"),
  columnDef("events", "event_owner_id", "TEXT FK", "No", "→ users.id (optional account link)", "Column"),
  columnDef("events", "event_start_date", "TEXT", "No", "YYYY-MM-DD", "Column"),
  columnDef("events", "event_end_date", "TEXT", "No", "YYYY-MM-DD", "Column"),
  columnDef("events", "status", "TEXT", "Yes", "enquiry | tentative | approved | confirmed | regret | cancelled", "Column", "enquiry | tentative | approved | confirmed | regret | cancelled"),
  columnDef("events", "form_status", "TEXT", "System", "draft | published", "Column"),
  columnDef("events", "approval_status", "TEXT", "System", "not_required | pending | sent | received | approved", "Column"),
  columnDef("events", "confirmation_status", "TEXT", "System", "none | made | couriered | signed_received", "Column"),
  columnDef("events", "enquiry_date", "TEXT", "No", "YYYY-MM-DD", "Column"),
  columnDef("events", "enquiry_source", "TEXT", "No", "enquiry_source lookup", "Column"),
  columnDef("events", "repeat_client", "INTEGER", "No", "0 or 1", "Column"),
  columnDef("events", "priority", "TEXT", "No", "high | medium | low (default medium)", "Column", "high | medium | low"),
  columnDef("events", "requirements", "JSON", "No", "Event-level POC & vendor fields — see events_requirements sheet", "JSON in events.requirements"),
  columnDef("events", "notes", "TEXT", "No", "Free-text remarks", "Column"),
  columnDef("events", "ops_completion", "REAL", "System", "0..1 computed from checklist", "Column"),
  columnDef("events", "accounts_completion", "REAL", "System", "", "Column"),
  columnDef("events", "overall_completion", "REAL", "System", "", "Column"),
];

const venueBookings = [
  columnDef("venue_bookings", "id", "TEXT", "System", "", "Column"),
  columnDef("venue_bookings", "event_id", "TEXT FK", "Yes", "→ events.id", "Column"),
  columnDef("venue_bookings", "venue", "TEXT", "Yes", "Must match venue lookup exactly", "Column"),
  columnDef("venue_bookings", "booking_status", "TEXT", "Yes", "tentative | confirmed", "Column", "tentative | confirmed"),
  columnDef("venue_bookings", "number_of_shows", "INTEGER", "No", "Default 1", "Column"),
  columnDef("venue_bookings", "requirements", "JSON", "No", "Per-venue technical/catering — see venue_requirements sheet", "JSON in venue_bookings.requirements"),
  columnDef("venue_bookings", "notes", "TEXT", "No", "", "Column"),
  columnDef("venue_bookings", "sort_order", "INTEGER", "No", "Display order when multiple venues", "Column"),
];

const scheduleEntries = [
  columnDef("schedule_entries", "id", "TEXT", "System", "", "Column"),
  columnDef("schedule_entries", "venue_booking_id", "TEXT FK", "Yes", "→ venue_bookings.id", "Column"),
  columnDef("schedule_entries", "event_id", "TEXT FK", "Yes", "→ events.id (denormalised)", "Column"),
  columnDef("schedule_entries", "activity_type", "TEXT", "Yes", ACTIVITY_TYPES.join(" | "), "Column", ACTIVITY_TYPES.join(" | ")),
  columnDef("schedule_entries", "activity_date", "TEXT", "Yes", "YYYY-MM-DD", "Column"),
  columnDef("schedule_entries", "start_time", "TEXT", "No", "HH:MM", "Column"),
  columnDef("schedule_entries", "end_time", "TEXT", "No", "HH:MM", "Column"),
  columnDef("schedule_entries", "with_ac_start", "TEXT", "No", "AC window start HH:MM", "Column"),
  columnDef("schedule_entries", "with_ac_end", "TEXT", "No", "AC window end HH:MM", "Column"),
  columnDef("schedule_entries", "with_ac_minutes", "INTEGER", "No", "Computed or entered", "Column"),
  columnDef("schedule_entries", "without_ac_start", "TEXT", "No", "", "Column"),
  columnDef("schedule_entries", "without_ac_end", "TEXT", "No", "", "Column"),
  columnDef("schedule_entries", "without_ac_minutes", "INTEGER", "No", "", "Column"),
  columnDef("schedule_entries", "notes", "TEXT", "No", "", "Column"),
  columnDef("schedule_entries", "sort_order", "INTEGER", "No", "", "Column"),
];

const eventsRequirements: Row[] = EVENT_LEVEL_REQUIREMENT_KEYS.map((f) => ({
  "JSON key": f.key,
  Label: f.label,
  "Data type": f.type,
  Required: f.required,
  "Stored in": "events.requirements",
  Notes: f.notes,
}));

const venueRequirements: Row[] = VENUE_REQUIREMENT_FIELDS.map((f) => ({
  "JSON key": f.key,
  Label: f.label,
  "Data type": f.type,
  "Stored in": "venue_bookings.requirements",
  Notes: f.notes,
}));

const lookups: Row[] = [...VENUES, ...DROPDOWN_LISTS]
  .filter((d) => d.list_key !== "venue" || VENUES.includes(d))
  .map((d) => ({
    list_key: d.list_key,
    value: d.value,
    sort_order: d.sort_order,
    metadata: d.metadata ? JSON.stringify(d.metadata) : "",
  }));

// Deduplicate — VENUES already in DROPDOWN_LISTS via ALL_DROPDOWNS pattern; use combined unique
const lookupMap = new Map<string, Row>();
for (const d of [...VENUES, ...DROPDOWN_LISTS]) {
  lookupMap.set(`${d.list_key}::${d.value}`, {
    list_key: d.list_key,
    value: d.value,
    sort_order: d.sort_order,
    metadata: d.metadata ? JSON.stringify(d.metadata) : "",
  });
}
const lookupsDeduped = [...lookupMap.values()].sort((a, b) =>
  String(a.list_key).localeCompare(String(b.list_key)) || Number(a.sort_order) - Number(b.sort_order),
);

const relationships: Row[] = [
  { Parent: "organisations", Child: "contacts", Cardinality: "1:N", "Join": "contacts.organisation_id = organisations.id" },
  { Parent: "organisations", Child: "events", Cardinality: "1:N", "Join": "events.organisation_id = organisations.id" },
  { Parent: "contacts", Child: "events", Cardinality: "1:N", "Join": "events.primary_contact_id = contacts.id" },
  { Parent: "events", Child: "venue_bookings", Cardinality: "1:N", "Join": "venue_bookings.event_id = events.id" },
  { Parent: "venue_bookings", Child: "schedule_entries", Cardinality: "1:N", "Join": "schedule_entries.venue_booking_id = venue_bookings.id" },
  { Parent: "events", Child: "schedule_entries", Cardinality: "1:N", "Join": "schedule_entries.event_id = events.id" },
  { Parent: "events", Child: "checklist_items", Cardinality: "1:N", "Join": "Auto-seeded on event create" },
  { Parent: "events", Child: "documents", Cardinality: "1:N", "Join": "documents.event_id = events.id" },
];

const importTemplateHeaders = [
  "Enquiry ID",
  "Event Name (Organisation)",
  "Type of Event (Title)",
  "VFH / EE",
  "Venue",
  "Event Start Date",
  "Event End Date",
  "Enquiry Date",
  "Handled By",
  "Program Officer",
  "Enquiry Source",
  "Repeat Client",
  "Status",
  "Contact Person",
  "Email ID",
  "Contact Number",
  "POC Name",
  "POC Contact Number",
  "POC Email",
  "Bank Details",
  "GST No",
  "TAN No",
  "PAN No",
  "Signing Authority Address",
  "Remarks",
];

const importTemplateExample: Row = {
  "Enquiry ID": "ENQ-2026-0001",
  "Event Name (Organisation)": "Example Foundation",
  "Type of Event (Title)": "Classical Concert",
  "VFH / EE": "VFH",
  Venue: "JBT",
  "Event Start Date": "2026-08-15",
  "Event End Date": "2026-08-15",
  "Enquiry Date": "2026-07-01",
  "Handled By": "Farha",
  "Program Officer": "Nasha",
  "Enquiry Source": "Walk-in",
  "Repeat Client": "No",
  Status: "enquiry",
  "Contact Person": "Jane Doe",
  "Email ID": "jane@example.org",
  "Contact Number": "9876543210",
  "POC Name": "Jane Doe",
  "POC Contact Number": "9876543210",
  "POC Email": "jane@example.org",
  "Bank Details": "HDFC, Example Foundation, 1234567890, HDFC0001234",
  "GST No": "27AAAAA0000A1Z5",
  "TAN No": "",
  "PAN No": "",
  "Signing Authority Address": "Jane Doe, 1 Example Road, Mumbai",
  Remarks: "Sample row — delete before import",
};

const importNotes: Row[] = [
  { Field: "Enquiry ID", Mapping: "events.event_code", Notes: "Required for upsert; unique per event" },
  { Field: "Event Name (Organisation)", Mapping: "organisations.name", Notes: "Creates org if not exists (case-insensitive match)" },
  { Field: "Type of Event (Title)", Mapping: "events.title", Notes: "" },
  { Field: "VFH / EE", Mapping: "events.event_type", Notes: "EE | FR | VFH | Free Event" },
  { Field: "Venue", Mapping: "venue_bookings.venue", Notes: "One venue per row; duplicate Enquiry ID with different Venue for multi-venue" },
  { Field: "POC fields", Mapping: "events.requirements JSON keys", Notes: "See events_requirements sheet" },
  { Field: "Per-venue technical fields", Mapping: "venue_bookings.requirements", Notes: "Not in flat template — extend columns or use separate venue sheet" },
  { Field: "Schedule", Mapping: "schedule_entries", Notes: "Flat template creates one 'show' row on event start date if present" },
];

const wb = utils.book_new();
const sheets = [
  sheet("README", overview),
  sheet("Tables_Overview", tablesOverview),
  sheet("organisations", organisations),
  sheet("contacts", contacts),
  sheet("events", events),
  sheet("events_requirements", eventsRequirements),
  sheet("venue_bookings", venueBookings),
  sheet("venue_requirements", venueRequirements),
  sheet("schedule_entries", scheduleEntries),
  sheet("Lookups", lookupsDeduped),
  sheet("Relationships", relationships),
  sheet("Import_Template", [Object.fromEntries(importTemplateHeaders.map((h) => [h, importTemplateExample[h] ?? ""]))]),
  sheet("Import_Field_Map", importNotes),
];

for (const { name, ws } of sheets) {
  utils.book_append_sheet(wb, ws, name.slice(0, 31));
}

const outPath = resolve("docs/event-form-database-schema.xlsx");
const bytes = write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
writeFileSync(outPath, bytes);
console.log(`Wrote ${outPath} (${bytes.length} bytes, ${sheets.length} sheets)`);
