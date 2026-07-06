/**
 * Local demo data seed for Phase 6 testing.
 *
 * Creates 50 lifecycle-realistic events:
 *   - June enquiries mostly show in September
 *   - July enquiries show in September/October
 *   - August enquiries show in November
 *   - September enquiries show in December
 * with varied lifecycle states, event types, single/multi-venue bookings,
 * checklists, tasks, and notifications.
 *
 * Usage:
 *   PATH="$PWD/node_modules/.bin:$PATH" tsx scripts/seed/demo-events.ts --env=local
 *   PATH="$PWD/node_modules/.bin:$PATH" tsx scripts/seed/demo-events.ts --env=remote --allow-remote-demo
 *
 * Remote usage requires --allow-remote-demo. It clears transactional data so
 * the Calendar and Event Detail pages are easy to test with a fresh, coherent
 * dataset.
 */
import { queryAll, SqlBatch, sqlStr, type SeedEnv } from "./d1-client";

type EventType = "EE" | "FR" | "VFH" | "Free Event";
type EventStatus = "enquiry" | "tentative" | "approved" | "confirmed" | "regret" | "cancelled";

type ChecklistDefinition = {
  id: string;
  module: "operations" | "accounts";
  section: string;
  field_key: string;
  label: string;
  field_type: string;
  default_value: string | null;
  vfh_only: number;
  is_computed: number;
};

const MAIN_VENUES = ["JBT", "TATA", "TET", "LT", "GDT"];

const FALLBACK_ORGS = [
  "Aarohan Foundation",
  "Blue Banyan Media",
  "Crescent Financial Services",
  "Dharavi Design Collective",
  "Eka Culture Trust",
  "FableTree Productions",
  "Gulmohar Arts Society",
  "Harmonia Learning",
  "Indigo Corporate Forum",
  "Junoon Events",
  "Katha Kids Foundation",
  "Lotus Legal Partners",
  "Mosaic Music Academy",
  "Nava Bharat Foundation",
  "Opus Brand Studio",
  "Prism Healthcare",
  "Qube Technologies",
  "Raag Rang Trust",
  "Saffron School of Arts",
  "Tara Hospitality Group",
];

const EVENT_TYPES: EventType[] = ["VFH", "EE", "FR", "Free Event"];
const OWNERS = ["Aditi Rao", "Dev Mehta", "Farah Contractor", "Kabir Shah", "Leena Iyer"];
const OFFICERS = ["Mira Kapoor", "Nikhil D'Souza", "Rhea Menon", "Samar Khan", "Tara Desai"];
const SOURCES = ["Referral", "Website", "Repeat Client", "Phone Call", "Email"];
const DEMO_TODAY = "2026-07-06";
const DEMO_PASSWORD_HASH = `scrypt:${"00".repeat(16)}:${"00".repeat(32)}`;
const DEMO_USERS = [
  { id: "demo_user_admin", email: "demo.admin@ncpa.local", name: "Demo Admin", role: "admin", organisation: "Operations" },
  { id: "demo_user_aditi", email: "aditi.rao@ncpa.local", name: "Aditi Rao", role: "venue_manager", organisation: "Venue Hire" },
  { id: "demo_user_dev", email: "dev.mehta@ncpa.local", name: "Dev Mehta", role: "coordinator", organisation: "Venue Hire" },
  { id: "demo_user_farah", email: "farah.contractor@ncpa.local", name: "Farah Contractor", role: "coordinator", organisation: "Accounts" },
  { id: "demo_user_kabir", email: "kabir.shah@ncpa.local", name: "Kabir Shah", role: "coordinator", organisation: "Technical" },
  { id: "demo_user_leena", email: "leena.iyer@ncpa.local", name: "Leena Iyer", role: "viewer", organisation: "Management" },
];

function parseEnv(): SeedEnv {
  const arg = process.argv.find((a) => a.startsWith("--env="));
  const env = (arg ? arg.replace("--env=", "") : "local") as SeedEnv;
  if (env !== "local" && env !== "preview" && env !== "remote") {
    throw new Error(`Unknown --env: ${env}. Use local|preview|remote.`);
  }
  if (env !== "local" && !process.argv.includes("--allow-remote-demo")) {
    throw new Error("Remote demo seeding is destructive. Re-run with --allow-remote-demo to confirm.");
  }
  return env;
}

function now(): string {
  return new Date().toISOString();
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function date(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function clampDay(day: number): number {
  return Math.max(1, Math.min(28, day));
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function maxIsoDate(a: string, b: string): string {
  return a >= b ? a : b;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function statusForValue(fieldType: string, value: string | null, computed: number): string {
  if (computed) return "not_applicable";
  const v = (value ?? "").toLowerCase();
  if (!v) return "not_started";
  if (["not required", "n/a", "n.a."].includes(v)) return "not_applicable";
  if (fieldType === "dropdown" || fieldType === "status") {
    return ["yes", "sent", "approved", "received", "ready", "applicable"].includes(v) ? "completed" : "in_progress";
  }
  return "completed";
}

function venuePlan(index: number): string[] {
  const pattern = index % 10;
  if (pattern === 0) return ["JBT", "TATA", "TET", "LT", "GDT"];
  if (pattern === 3 || pattern === 8) return ["JBT", "TATA", "TET"];
  if (pattern === 2 || pattern === 5 || pattern === 7) return ["TATA", "LT"];
  return [MAIN_VENUES[index % MAIN_VENUES.length]!];
}

function durationDays(index: number, venues: string[]): number {
  if (venues.length >= 5) return 4;
  if (venues.length >= 3) return 3;
  if (venues.length === 2) return index % 2 === 0 ? 2 : 1;
  return index % 4 === 0 ? 2 : 1;
}

function checklistValue(def: ChecklistDefinition, event: DemoEvent): string | null {
  const showDate = event.startDate;
  const confirmed = event.status === "confirmed";
  const approved = event.status === "approved" || confirmed;
  const active = !["regret", "cancelled"].includes(event.status);

  switch (def.field_key) {
    case "event_name": return event.title;
    case "event_type": return event.eventType;
    case "nature_of_event": return event.nature;
    case "venue": return event.venues.join(", ");
    case "poc_name": return `${event.orgName.split(" ")[0]} Coordinator`;
    case "poc_contact_number": return event.phone;
    case "poc_email": return event.email;
    case "bank_details": return `HDFC Bank / ${event.orgName} / XXXX${event.index.toString().padStart(4, "0")}`;
    case "gst_no": return `27AA${slug(event.orgName).slice(0, 4).toUpperCase()}${1000 + event.index}Z1`;
    case "tan_no": return `MUM${10000 + event.index}A`;
    case "pan_no": return `AA${slug(event.orgName).slice(0, 3).toUpperCase()}${1000 + event.index}P`;
    case "signing_authority_address": return `${event.orgName}, Nariman Point, Mumbai`;
    case "courier_address": return `${event.orgName}, Fort, Mumbai 400001`;
    case "vendor_registration_form": return active ? "Received" : "Pending";
    case "approval_required": return event.eventType === "VFH" ? "Required" : "Not Required";
    case "approval_sent_on": return event.eventType === "VFH" && active ? addDays(event.enquiryDate, 2) : null;
    case "approval_received_on": return event.eventType === "VFH" && approved ? addDays(event.enquiryDate, 6) : null;
    case "genre_head": return event.eventType === "VFH" ? "Programming Head" : null;
    case "setup_date": return addDays(showDate, -1);
    case "rehearsal_date": return event.duration > 1 ? showDate : null;
    case "event_dates": return event.duration > 1 ? `${event.startDate} to ${event.endDate}` : event.startDate;
    case "dismantling_date": return addDays(event.endDate, 1);
    case "timings_with_ac": return "18:00-22:00";
    case "ac_hours": return "4h";
    case "timings_without_ac": return "10:00-18:00";
    case "non_ac_hours": return "8h";
    case "costing_email": return confirmed ? "Approved" : active ? "Sent" : "Pending";
    case "proforma_invoice": return confirmed ? "Approved" : active ? "Sent" : "Pending";
    case "installment_1_expected_date": return addDays(event.enquiryDate, 7);
    case "installment_2_expected_date": return confirmed ? addDays(event.startDate, -14) : null;
    case "installment_3_expected_date": return confirmed && event.duration > 2 ? addDays(event.startDate, -7) : null;
    case "installment_4_expected_date": return null;
    case "installment_5_expected_date": return null;
    case "full_payment_received": return confirmed && event.index % 3 !== 0 ? "Yes" : "No";
    case "confirmation_made": return confirmed || approved ? "Yes" : "No";
    case "confirmation_couriered": return confirmed ? addDays(event.enquiryDate, 9) : null;
    case "confirmation_signed_received": return confirmed ? "Yes" : "No";
    case "req_sound": return event.index % 2 === 0 ? "Required" : "Not Required";
    case "req_piano": return event.nature.includes("Music") ? "Required" : "Not Required";
    case "req_liquor_license": return event.eventType === "EE" ? "Required" : "Not Required";
    case "req_orchestra_pit_chairs": return event.venues.includes("TATA") ? "Required" : "Not Required";
    case "req_digital_standee": return "Required";
    case "req_car_display": return event.index % 9 === 0 ? "Required" : "Not Required";
    case "req_bike_display": return "Not Required";
    case "req_stalls": return event.index % 5 === 0 ? "Required" : "Not Required";
    case "req_telecasting_media": return event.eventType === "EE" ? "Required" : "Not Required";
    case "noc_sent_on": return confirmed ? addDays(event.startDate, -10) : null;
    case "noc_status": return confirmed ? "Sent" : "Not Sent";
    case "onstage_asked_client": return active ? addDays(event.startDate, -12) : null;
    case "onstage_received_from_client": return confirmed ? addDays(event.startDate, -8) : null;
    case "onstage_sent_to_team": return confirmed ? addDays(event.startDate, -7) : null;
    case "onstage_verified": return confirmed ? addDays(event.startDate, -5) : null;
    case "onstage_complete": return confirmed ? addDays(event.startDate, -3) : null;
    case "technical_meeting_date": return addDays(event.startDate, -5);
    case "minutes_of_meeting": return confirmed ? "Yes" : "No";
    case "no_of_crew_cards": return String(8 + (event.index % 18));
    case "house_seats": return String(4 + (event.index % 10));
    case "licenses": return event.index % 3 === 0 ? "PPL, IPRS" : "Standard venue permissions";
    case "decorator_name": return ["Bloom & Beam", "StageCraft", "Ivory Events"][event.index % 3]!;
    case "decorator_tier": return ["A", "B", "C"][event.index % 3]!;
    case "caterer_name": return ["Copper Plate", "Saffron Kitchen", "Bay Leaf"][event.index % 3]!;
    case "caterer_tier": return ["A", "B", "C"][event.index % 3]!;
    case "type_of_catering": return ["Veg", "Non-Veg", "Veg & Non-Veg", "Tea/Coffee"][event.index % 4]!;
    case "no_of_pax": return String(120 + event.index * 12);
    case "feedback_sent": return event.startDate < "2026-07-05" && confirmed ? addDays(event.endDate, 1) : null;
    case "feedback_received": return event.startDate < "2026-07-01" && confirmed ? addDays(event.endDate, 4) : null;
    case "event_report": return event.startDate < "2026-07-01" && confirmed ? "Ready" : "Not Ready";
    case "box_office_statement": return confirmed ? "Received" : "Awaiting";
    case "event_status": return event.status;
    case "file_sent_to_accounts": return confirmed ? addDays(event.endDate, 1) : null;
    case "notify_after_3_days": return "Yes";
    case "file_received_back_edit_1": return event.startDate < "2026-07-01" && confirmed ? "Received" : "Pending";
    case "file_received_back_edit_2": return event.startDate < "2026-07-01" && confirmed ? "Received" : "Pending";
    case "final_file_received": return event.startDate < "2026-07-01" && confirmed ? "Yes" : "No";
    case "security_deposit_refund": return event.eventType === "VFH" ? "Applicable" : "N/A";
    case "box_office_collection_refund": return event.eventType === "FR" ? "Applicable" : "N/A";
    case "payment_advice": return confirmed ? "Received" : "Awaiting";
    case "tds_certificate_sent_to_client": return confirmed ? "Yes" : "No";
    case "tds_certificate_refund_and_payment_advice": return confirmed ? "Received" : "Awaiting";
    case "payment_ledger": return confirmed ? "Received" : "Requested";
    case "tax_invoice_sent": return confirmed ? "Sent" : "Not Sent";
    case "box_office_statement_sent": return confirmed ? "Sent" : "Not Sent";
    case "payment_advice_received_from_client": return confirmed ? "Yes" : "No";
    case "tds_certificate_from_client": return event.eventType === "VFH" && confirmed ? "Received" : "N.A.";
    case "tds_payment_and_advice_sent": return confirmed ? "Sent" : "Awaiting";
    case "payment_ledger_sent": return confirmed ? "Sent" : "Requested";
    case "accounts_file_status": return confirmed ? "Closed" : "Open";
    case "outstanding_to_client": return confirmed ? "None" : "Pending";
    case "notifications_triggered": return event.status === "enquiry" || event.status === "tentative" ? "2" : "1";
    default: return def.default_value;
  }
}

type DemoEvent = {
  index: number;
  id: string;
  code: string;
  title: string;
  orgId: string;
  orgName: string;
  contactId: string;
  eventType: EventType;
  status: EventStatus;
  nature: string;
  venues: string[];
  duration: number;
  startDate: string;
  endDate: string;
  enquiryDate: string;
  confirmationDate: string | null;
  email: string;
  phone: string;
};

type LifecycleCohort = {
  enquiryMonth: 6 | 7 | 8 | 9;
  showMonths: number[];
  count: number;
  statuses: EventStatus[];
};

const LIFECYCLE_COHORTS: LifecycleCohort[] = [
  {
    enquiryMonth: 6,
    showMonths: [9],
    count: 14,
    statuses: ["confirmed", "approved", "tentative", "confirmed", "confirmed", "regret", "cancelled", "approved", "tentative", "confirmed", "confirmed", "approved", "tentative", "confirmed"],
  },
  {
    enquiryMonth: 7,
    showMonths: [9, 10],
    count: 14,
    statuses: ["enquiry", "tentative", "approved", "tentative", "confirmed", "enquiry", "approved", "tentative", "cancelled", "tentative", "confirmed", "enquiry", "approved", "tentative"],
  },
  {
    enquiryMonth: 8,
    showMonths: [11],
    count: 12,
    statuses: ["enquiry", "enquiry", "tentative", "tentative", "approved", "enquiry", "tentative", "enquiry", "tentative", "approved", "enquiry", "tentative"],
  },
  {
    enquiryMonth: 9,
    showMonths: [12],
    count: 10,
    statuses: ["enquiry", "enquiry", "tentative", "enquiry", "tentative", "enquiry", "enquiry", "tentative", "enquiry", "enquiry"],
  },
];

function lifecycleDate(enquiryMonth: number, slot: number): string {
  return date(2026, enquiryMonth, clampDay(3 + slot * 2));
}

function showDateForCohort(cohort: LifecycleCohort, slot: number): string {
  const showMonth = cohort.showMonths[slot % cohort.showMonths.length]!;
  const day = clampDay(6 + ((slot * 3) % 21));
  return date(2026, showMonth, day);
}

function confirmationDateForStatus(enquiryDate: string, status: EventStatus, slot: number): string | null {
  if (status === "confirmed") return addDays(enquiryDate, 12 + (slot % 7));
  if (status === "approved") return addDays(enquiryDate, 8 + (slot % 4));
  return null;
}

function buildEvents(orgNames: string[]): DemoEvent[] {
  const natures = [
    "Music Concert",
    "Corporate Leadership Summit",
    "Fundraiser Gala",
    "School Annual Day",
    "Dance Performance",
    "Book Launch",
    "Classical Recital",
    "Technology Showcase",
    "Theatre Festival",
    "Awards Evening",
  ];
  const events: DemoEvent[] = [];
  for (const cohort of LIFECYCLE_COHORTS) {
    for (let slot = 0; slot < cohort.count; slot++) {
      const index = events.length;
      const orgName = orgNames[index % orgNames.length]!;
      const eventType = EVENT_TYPES[index % EVENT_TYPES.length]!;
      let status = cohort.statuses[slot]!;
      if (status === "approved" && eventType !== "VFH") status = "tentative";
      const venues = venuePlan(index);
      const duration = durationDays(index, venues);
      const enquiryDate = lifecycleDate(cohort.enquiryMonth, slot);
      const startDate = showDateForCohort(cohort, slot);
      const endDate = addDays(startDate, duration - 1);
      const code = `DEMO-2026-${pad(cohort.enquiryMonth)}-${pad(slot + 1)}`;
      const nature = natures[index % natures.length]!;
      events.push({
        index,
        id: `demo_ev_${pad(index + 1)}`,
        code,
        title: `${orgName} - ${nature}`,
        orgId: `demo_org_${pad(index % orgNames.length)}`,
        orgName,
        contactId: `demo_ct_${pad(index % orgNames.length)}`,
        eventType,
        status,
        nature,
        venues,
        duration,
        startDate,
        endDate,
        enquiryDate,
        confirmationDate: confirmationDateForStatus(enquiryDate, status, slot),
        email: `events+${slug(orgName)}@example.com`,
        phone: `+91 98${String(70000000 + index * 137).slice(0, 8)}`,
      });
    }
  }
  return events;
}

function clearTransactionalData(batch: SqlBatch): void {
  [
    "documents",
    "notifications",
    "tasks",
    "checklist_corrections",
    "checklist_items",
    "event_activity",
    "event_status_history",
    "schedule_entries",
    "venue_bookings",
    "events",
    "contacts",
    "organisations",
  ].forEach((table) => batch.add(`DELETE FROM ${table};`));
}

function seedVenueLookups(batch: SqlBatch, timestamp: string): void {
  MAIN_VENUES.forEach((venue, i) => {
    batch.add(
      `INSERT INTO dropdown_options (id, list_key, value, sort_order, is_active, metadata, created_at)
       VALUES (${sqlStr(`demo_venue_${slug(venue)}`)}, 'venue', ${sqlStr(venue)}, ${i + 1}, 1, NULL, ${sqlStr(timestamp)})
       ON CONFLICT(list_key, value) DO UPDATE SET is_active = 1, sort_order = excluded.sort_order;`
    );
  });
}

function seedDemoUsers(batch: SqlBatch, timestamp: string): void {
  DEMO_USERS.forEach((user) => {
    batch.add(
      `INSERT INTO users (id, email, name, role, organisation, password_hash, password_algo, password_updated_at, is_active, created_at, updated_at)
       VALUES (${sqlStr(user.id)}, ${sqlStr(user.email)}, ${sqlStr(user.name)}, ${sqlStr(user.role)}, ${sqlStr(user.organisation)},
       ${sqlStr(DEMO_PASSWORD_HASH)}, 'scrypt', ${sqlStr(timestamp)}, 1, ${sqlStr(timestamp)}, ${sqlStr(timestamp)})
       ON CONFLICT(email) DO UPDATE SET
         name = excluded.name,
         role = excluded.role,
         organisation = excluded.organisation,
         is_active = 1,
         updated_at = excluded.updated_at;`
    );
  });
}

function seedOrganisations(batch: SqlBatch, orgNames: string[], timestamp: string): void {
  orgNames.forEach((orgName, i) => {
    const orgId = `demo_org_${pad(i)}`;
    const contactId = `demo_ct_${pad(i)}`;
    const email = `events+${slug(orgName)}@example.com`;
    const phone = `+91 99${String(20000000 + i * 271).slice(0, 8)}`;
    batch.add(
      `INSERT INTO organisations (id, name, org_type, address, gst_number, pan_number, tan_number, bank_details, notes, created_at, updated_at)
       VALUES (${sqlStr(orgId)}, ${sqlStr(orgName)}, ${sqlStr(i % 3 === 0 ? "foundation" : i % 3 === 1 ? "corporate" : "education")}, ${sqlStr(`${12 + i}, Marine Lines, Mumbai`)},
       ${sqlStr(`27DEMO${pad(i)}Z1`)}, ${sqlStr(`DEMO${pad(i)}PAN`)}, ${sqlStr(`MUMD${pad(i)}TAN`)},
       ${sqlStr(JSON.stringify({ bank: "HDFC Bank", account_name: orgName, account_no: `000${i}123456`, ifsc: "HDFC0000001", branch: "Mumbai" }))},
       ${sqlStr("Demo organisation for Phase 6 testing.")}, ${sqlStr(timestamp)}, ${sqlStr(timestamp)});`
    );
    batch.add(
      `INSERT INTO contacts (id, organisation_id, name, role, email, phone, is_primary, signing_authority, courier_address, created_at, updated_at)
       VALUES (${sqlStr(contactId)}, ${sqlStr(orgId)}, ${sqlStr(`${orgName.split(" ")[0]} Coordinator`)}, 'Event Coordinator',
       ${sqlStr(email)}, ${sqlStr(phone)}, 1, 1, ${sqlStr(`${orgName}, Fort, Mumbai 400001`)}, ${sqlStr(timestamp)}, ${sqlStr(timestamp)});`
    );
  });
}

function seedEvents(batch: SqlBatch, events: DemoEvent[], definitions: ChecklistDefinition[], timestamp: string): void {
  for (const event of events) {
    const approvalStatus = event.eventType === "VFH"
      ? event.status === "approved" || event.status === "confirmed" ? "received" : event.status === "cancelled" || event.status === "regret" ? "pending" : "sent"
      : "not_required";
    const confirmationStatus = event.status === "confirmed" ? "signed_received" : event.status === "approved" ? "made" : "none";
    const requirements = {
      sound: event.index % 2 === 0,
      lighting: true,
      stage: event.venues.length > 1 ? "multi-venue coordination" : "standard",
      greenRooms: 1 + (event.index % 3),
      security: event.venues.length >= 3,
      notes: `Demo ${event.venues.length}-venue event for Phase 6 testing.`,
    };
    const lifecycleUpdatedAt = event.confirmationDate ?? addDays(event.enquiryDate, event.status === "enquiry" ? 0 : 5);
    batch.add(
      `INSERT INTO events (id, event_code, title, description, organisation_id, primary_contact_id,
       event_type, program_officer, event_owner, event_start_date, event_end_date, status, form_status,
       approval_status, confirmation_status, enquiry_date, enquiry_source, repeat_client, priority,
       requirements, notes, created_at, updated_at)
       VALUES (${sqlStr(event.id)}, ${sqlStr(event.code)}, ${sqlStr(event.title)}, ${sqlStr(event.nature)},
       ${sqlStr(event.orgId)}, ${sqlStr(event.contactId)}, ${sqlStr(event.eventType)}, ${sqlStr(OFFICERS[event.index % OFFICERS.length])},
       ${sqlStr(OWNERS[event.index % OWNERS.length])}, ${sqlStr(event.startDate)}, ${sqlStr(event.endDate)},
       ${sqlStr(event.status)}, 'published', ${sqlStr(approvalStatus)}, ${sqlStr(confirmationStatus)},
       ${sqlStr(event.enquiryDate)}, ${sqlStr(SOURCES[event.index % SOURCES.length])}, ${event.index % 4 === 0 ? 1 : 0},
       ${sqlStr(event.index % 7 === 0 ? "high" : event.index % 5 === 0 ? "low" : "medium")},
       ${sqlStr(JSON.stringify(requirements))}, ${sqlStr(`Demo seed: ${event.venues.join(", ")} / ${event.status}.`)},
       ${sqlStr(event.enquiryDate + "T10:00:00.000Z")}, ${sqlStr(lifecycleUpdatedAt + "T10:00:00.000Z")});`
    );
    batch.add(
      `INSERT INTO event_status_history (id, event_id, from_status, to_status, changed_by, changed_at, reason)
       VALUES (${sqlStr(`demo_sh_${event.id}_created`)}, ${sqlStr(event.id)}, NULL, 'enquiry', NULL, ${sqlStr(event.enquiryDate + "T10:00:00.000Z")}, 'Demo event created');`
    );
    if (event.status !== "enquiry") {
      batch.add(
        `INSERT INTO event_status_history (id, event_id, from_status, to_status, changed_by, changed_at, reason)
         VALUES (${sqlStr(`demo_sh_${event.id}_current`)}, ${sqlStr(event.id)}, 'enquiry', ${sqlStr(event.status)}, NULL, ${sqlStr(lifecycleUpdatedAt + "T10:00:00.000Z")}, 'Demo lifecycle state');`
      );
    }
    batch.add(
      `INSERT INTO event_activity (id, event_id, activity_type, detail, actor_id, created_at)
       VALUES (${sqlStr(`demo_act_${event.id}`)}, ${sqlStr(event.id)}, 'created', ${sqlStr(JSON.stringify({ title: event.title }))}, NULL, ${sqlStr(timestamp)});`
    );

    seedDocumentsForEvent(batch, event, timestamp);

    event.venues.forEach((venue, venueIndex) => {
      const vbId = `demo_vb_${event.id}_${slug(venue)}`;
      batch.add(
        `INSERT INTO venue_bookings (id, event_id, venue, booking_status, number_of_shows, requirements, notes, sort_order, created_at, updated_at)
         VALUES (${sqlStr(vbId)}, ${sqlStr(event.id)}, ${sqlStr(venue)}, ${sqlStr(event.status === "confirmed" ? "confirmed" : "tentative")},
         ${event.duration}, ${sqlStr(JSON.stringify({ venue, seating: "standard", staffing: venueIndex + 2 }))},
         ${sqlStr(`Demo booking for ${venue}.`)}, ${venueIndex + 1}, ${sqlStr(timestamp)}, ${sqlStr(timestamp)});`
      );
      for (let d = 0; d < event.duration; d++) {
        const activityDate = addDays(event.startDate, d);
        const activityType = d === 0 && event.duration > 1 ? "setup" : d === event.duration - 1 ? "show" : "rehearsal";
        batch.add(
          `INSERT INTO schedule_entries (id, venue_booking_id, event_id, activity_type, activity_date, start_time, end_time,
           with_ac_start, with_ac_end, with_ac_minutes, without_ac_start, without_ac_end, without_ac_minutes, notes, sort_order, created_at)
           VALUES (${sqlStr(`demo_se_${event.id}_${slug(venue)}_${d}`)}, ${sqlStr(vbId)}, ${sqlStr(event.id)}, ${sqlStr(activityType)},
           ${sqlStr(activityDate)}, '10:00', '22:00', '18:00', '22:00', 240, '10:00', '18:00', 480,
           ${sqlStr(`${activityType} at ${venue}`)}, ${d + 1}, ${sqlStr(timestamp)});`
        );
      }
    });

    definitions
      .filter((def) => !def.vfh_only || event.eventType === "VFH")
      .forEach((def) => {
        const value = checklistValue(def, event);
        const status = statusForValue(def.field_type, value, def.is_computed);
        const completedAt = status === "completed" ? timestamp : null;
        const dueDate = def.field_type === "date" ? value : null;
        batch.add(
          `INSERT INTO checklist_items (id, event_id, definition_id, module, section, field_key, label, status, value, due_date,
           completed_at, completed_by, last_updated_at, last_updated_by)
           VALUES (${sqlStr(`demo_cli_${event.id}_${def.field_key}`)}, ${sqlStr(event.id)}, ${sqlStr(def.id)}, ${sqlStr(def.module)},
           ${sqlStr(def.section)}, ${sqlStr(def.field_key)}, ${sqlStr(def.label)}, ${sqlStr(status)}, ${sqlStr(value)},
           ${sqlStr(dueDate)}, ${sqlStr(completedAt)}, NULL, ${sqlStr(timestamp)}, NULL);`
        );
      });

    seedTasksForEvent(batch, event, timestamp);
  }
}

type DemoTaskSpec = {
  slug: string;
  title: string;
  description: string;
  sourceRule: string | null;
  assigneeId: string | null;
  dueDate: string | null;
  priority: "high" | "medium" | "low";
  status: "open" | "in_progress" | "completed" | "cancelled";
};

function demoTaskSpecs(event: DemoEvent): DemoTaskSpec[] {
  const ownerUser = DEMO_USERS[(event.index % (DEMO_USERS.length - 1)) + 1]!;
  const specs: DemoTaskSpec[] = [];
  const approvalDue = addDays(event.enquiryDate, event.eventType === "VFH" ? 5 : 3);
  const confirmationDue = event.confirmationDate ? addDays(event.confirmationDate, 2) : addDays(event.enquiryDate, 14);
  const firstPaymentDue = maxIsoDate(addDays(event.enquiryDate, 10), addDays(event.startDate, -70));
  const secondPaymentDue = addDays(event.startDate, -45);
  const operationsDue = addDays(event.startDate, -28);

  if (event.status === "enquiry" || event.status === "tentative" || event.status === "approved") {
    specs.push({
      slug: "approval",
      title: event.eventType === "VFH" ? "Approval follow-up with programming head" : "Internal approval checkpoint",
      description: "Confirm whether the event can move to the next lifecycle stage.",
      sourceRule: "approval_followup",
      assigneeId: "demo_user_aditi",
      dueDate: approvalDue,
      priority: approvalDue <= DEMO_TODAY ? "high" : "medium",
      status: approvalDue < DEMO_TODAY && event.index % 3 === 0 ? "in_progress" : "open",
    });
  }

  if (event.status === "approved" || event.status === "confirmed") {
    specs.push({
      slug: "confirmation",
      title: "Prepare confirmation letter",
      description: "Generate, courier, and track signed confirmation paperwork.",
      sourceRule: "confirmation_letter",
      assigneeId: ownerUser.id,
      dueDate: confirmationDue,
      priority: event.status === "approved" ? "high" : "medium",
      status: event.status === "confirmed" && confirmationDue < DEMO_TODAY && event.index % 4 === 0 ? "completed" : "open",
    });
  }

  if (event.status === "tentative" || event.status === "approved" || event.status === "confirmed") {
    specs.push({
      slug: "payment",
      title: event.index % 2 === 0 ? "Collect installment payment" : "Reconcile proforma invoice",
      description: "Track expected payment milestone and update accounts checklist.",
      sourceRule: event.index % 2 === 0 ? "installment_due" : "proforma_invoice",
      assigneeId: "demo_user_farah",
      dueDate: event.index % 2 === 0 ? firstPaymentDue : secondPaymentDue,
      priority: (event.index % 2 === 0 ? firstPaymentDue : secondPaymentDue) <= DEMO_TODAY ? "high" : "medium",
      status: (event.index % 2 === 0 ? firstPaymentDue : secondPaymentDue) < DEMO_TODAY && event.index % 4 === 0 ? "in_progress" : "open",
    });
  }

  if (!["regret", "cancelled"].includes(event.status)) {
    specs.push({
      slug: "operations",
      title: event.index % 2 === 0 ? "OnStage technical sheet review" : "Schedule technical meeting",
      description: "Coordinate production, venue, and client technical requirements.",
      sourceRule: event.index % 2 === 0 ? "onstage_followup" : "technical_meeting",
      assigneeId: "demo_user_kabir",
      dueDate: operationsDue,
      priority: operationsDue <= addDays(DEMO_TODAY, 14) ? "high" : "medium",
      status: operationsDue < DEMO_TODAY && event.index % 7 === 0 ? "in_progress" : "open",
    });
  }

  if (event.status === "confirmed") {
    specs.push({
      slug: "accounts",
      title: "Send final file to accounts",
      description: "Close the venue hire file and hand over the account pack.",
      sourceRule: "accounts_file_status",
      assigneeId: "demo_user_farah",
      dueDate: addDays(event.endDate, 1),
      priority: event.startDate < DEMO_TODAY ? "high" : "medium",
      status: event.startDate < addDays(DEMO_TODAY, -10) ? "completed" : "open",
    });
  }

  if (event.startDate < DEMO_TODAY && event.status === "confirmed") {
    specs.push({
      slug: "post_event",
      title: "Send feedback form and event report",
      description: "Collect client feedback and complete the post-event report.",
      sourceRule: "feedback_followup",
      assigneeId: ownerUser.id,
      dueDate: event.index % 3 === 0 ? addDays(DEMO_TODAY, -3) : addDays(DEMO_TODAY, 4),
      priority: event.index % 3 === 0 ? "high" : "medium",
      status: event.index % 4 === 0 ? "in_progress" : "open",
    });
  }

  if (event.index % 6 === 0 || event.status === "cancelled" || event.status === "regret") {
    specs.push({
      slug: "manual",
      title: event.status === "cancelled" ? "Call client about cancelled booking" : "Manual client follow-up",
      description: "General coordination note for the operations team.",
      sourceRule: null,
      assigneeId: event.index % 12 === 0 ? null : ownerUser.id,
      dueDate: event.index % 12 === 0 ? null : addDays(event.enquiryDate, 7 + (event.index % 9)),
      priority: event.index % 12 === 0 ? "low" : "medium",
      status: event.status === "cancelled" ? "cancelled" : "open",
    });
  }

  return specs;
}

function seedTasksForEvent(batch: SqlBatch, event: DemoEvent, timestamp: string): void {
  const specs = demoTaskSpecs(event);
  specs.forEach((spec) => {
    const taskId = `demo_task_${event.id}_${spec.slug}`;
      batch.add(
        `INSERT INTO tasks (id, title, description, event_id, task_type, source_rule, idempotency_key, assignee_id, due_date, priority, status, created_at, updated_at)
         VALUES (${sqlStr(taskId)}, ${sqlStr(spec.title)}, ${sqlStr(spec.description)}, ${sqlStr(event.id)},
         ${sqlStr(spec.sourceRule ? "automatic" : "manual")}, ${sqlStr(spec.sourceRule)}, ${sqlStr(`demo-${event.id}-${spec.slug}`)},
         ${sqlStr(spec.assigneeId)}, ${sqlStr(spec.dueDate)}, ${sqlStr(spec.priority)}, ${sqlStr(spec.status)}, ${sqlStr(timestamp)}, ${sqlStr(timestamp)});`
      );
      batch.add(
        `INSERT INTO notifications (id, idempotency_key, recipient_role, title, body, channel, related_event_id, related_task_id, is_read, created_at)
         VALUES (${sqlStr(`demo_ntf_${event.id}_${spec.slug}`)}, ${sqlStr(`demo-task-${event.id}-${spec.slug}`)}, ${sqlStr(spec.slug === "accounts" ? "admin" : "venue_manager")},
         ${sqlStr(spec.status === "in_progress" ? "Task in progress" : "Demo task ready")}, ${sqlStr(`${spec.title}: ${event.title}`)}, 'in_app',
         ${sqlStr(event.id)}, ${sqlStr(taskId)}, ${spec.status === "completed" ? 1 : 0}, ${sqlStr(timestamp)});`
      );
  });
}

function seedDocumentsForEvent(batch: SqlBatch, event: DemoEvent, timestamp: string): void {
  const categories = event.status === "confirmed"
    ? ["confirmation_letter", "technical_rider", "accounts"]
    : event.status === "approved"
      ? ["approval", "confirmation_letter"]
      : event.status === "tentative"
        ? ["costing"]
        : ["inquiry"];

  categories.slice(0, event.index % 4 === 0 ? 3 : 1).forEach((category, i) => {
    batch.add(
      `INSERT INTO documents (id, event_id, venue_booking_id, checklist_item_id, file_name, r2_key, mime_type, file_size, category, uploaded_by, uploaded_at, notes)
       VALUES (${sqlStr(`demo_doc_${event.id}_${category}`)}, ${sqlStr(event.id)}, NULL, NULL,
       ${sqlStr(`${event.code}-${category.replace(/_/g, "-")}.pdf`)}, ${sqlStr(`demo/${event.id}/${category}.pdf`)},
       'application/pdf', ${112000 + event.index * 137 + i * 221}, ${sqlStr(category)}, 'demo_user_admin', ${sqlStr(timestamp)},
       ${sqlStr("Demo document metadata; no R2 object is required for UI testing.")});`
    );
  });
}

function pickOrganisationNames(env: SeedEnv): string[] {
  const existing = queryAll<{ name: string }>(
    "SELECT DISTINCT name FROM organisations WHERE name IS NOT NULL AND TRIM(name) != '' ORDER BY name LIMIT 20;",
    env
  ).map((row) => row.name.trim())
    .filter((name) => /[A-Za-z]/.test(name) && name.length > 3 && !/^\d+$/.test(name));
  return (existing.length >= 10 ? existing : FALLBACK_ORGS).slice(0, 20);
}

async function main() {
  const env = parseEnv();
  const timestamp = now();
  const orgNames = pickOrganisationNames(env);
  const definitions = queryAll<ChecklistDefinition>(
    `SELECT id, module, section, field_key, label, field_type, default_value, vfh_only, is_computed
     FROM checklist_definitions ORDER BY sort_order`,
    env
  );
  if (!definitions.length) {
    throw new Error("No checklist definitions found. Run npm run db:seed:local before demo seed.");
  }

  const events = buildEvents(orgNames);
  const batch = new SqlBatch(60);
  seedDemoUsers(batch, timestamp);
  clearTransactionalData(batch);
  seedVenueLookups(batch, timestamp);
  seedOrganisations(batch, orgNames, timestamp);
  seedEvents(batch, events, definitions, timestamp);
  const flushed = batch.flush(env);

  const counts = {
    events: queryAll<{ c: number }>("SELECT COUNT(*) AS c FROM events;", env)[0]?.c ?? 0,
    organisations: queryAll<{ c: number }>("SELECT COUNT(*) AS c FROM organisations;", env)[0]?.c ?? 0,
    bookings: queryAll<{ c: number }>("SELECT COUNT(*) AS c FROM venue_bookings;", env)[0]?.c ?? 0,
    schedule: queryAll<{ c: number }>("SELECT COUNT(*) AS c FROM schedule_entries;", env)[0]?.c ?? 0,
    checklist: queryAll<{ c: number }>("SELECT COUNT(*) AS c FROM checklist_items;", env)[0]?.c ?? 0,
    tasks: queryAll<{ c: number }>("SELECT COUNT(*) AS c FROM tasks;", env)[0]?.c ?? 0,
  };

  console.log(`\n✅ Demo event seed complete (${env}).`);
  console.log(`   SQL statements: ${flushed.statements} in ${flushed.chunks} chunks`);
  console.log(`   Organisations:  ${counts.organisations}`);
  console.log(`   Events:         ${counts.events}`);
  console.log(`   Venue bookings: ${counts.bookings}`);
  console.log(`   Schedule rows:  ${counts.schedule}`);
  console.log(`   Checklist rows: ${counts.checklist}`);
  console.log(`   Tasks:          ${counts.tasks}`);
  console.log("");
}

main().catch((err) => {
  console.error("\n❌ Demo seed failed:", err);
  process.exit(1);
});
