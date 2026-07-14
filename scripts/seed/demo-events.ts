/**
 * Local demo data seed.
 *
 * Creates a small, coherent starter dataset of enquiry-stage events you can
 * manually drive through the lifecycle:
 *   - 6 events, ALL on `enquiry` status (no pre-advanced states)
 *   - Enquiry dates in June (lifecycle starts in the past month, from "today")
 *   - Show dates from September onward, each ≥ ~1 month after its enquiry date
 *   - Varied event types, single/multi-venue bookings, checklists, tasks,
 *     notifications, and an inquiry document per event
 *
 * The seed clears all transactional data first, so the Calendar and Event
 * Detail pages start from a clean slate.
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
import { LEGACY_ROLE_PERMISSIONS } from "../../worker/lib/rbac";

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

const OWNERS = ["Aditi Rao", "Dev Mehta", "Farah Contractor", "Kabir Shah", "Leena Iyer"];
const OFFICERS = ["Mira Kapoor", "Nikhil D'Souza", "Rhea Menon", "Samar Khan", "Tara Desai"];
const SOURCES = ["Referral", "Website", "Repeat Client", "Phone Call", "Email"];
const DEMO_TODAY = "2026-07-08";
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
  if (["not required", "n/a", "n.a.", "not applicable"].includes(v)) return "not_applicable";
  if (fieldType === "dropdown" || fieldType === "status") {
    const doneValues = ["yes", "sent", "approved", "received", "completed", "ready", "applicable", "full received"];
    if (doneValues.includes(v)) return "completed";
    // A negative default is "not started"; only a non-default, non-done value
    // is "in progress". Must mirror worker/lib/operations.ts itemStatusForValue.
    const notDoneValues = ["no", "not sent", "incomplete", "not required", "pending", "awaiting", "requested", "open", "not ready", "not recorded"];
    if (notDoneValues.includes(v)) return "not_started";
    return "in_progress";
  }
  return "completed";
}

function checklistValue(def: ChecklistDefinition, event: DemoEvent): string | null {
  const showDate = event.startDate;
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
    case "vendor_registration_form": return "Pending";
    case "approval_required": return event.eventType === "VFH" ? "Required" : "Not Required";
    case "approval_sent_on": return null;
    case "approval_received_on": return null;
    case "genre_head": return event.eventType === "VFH" ? "Programming Head" : null;
    case "setup_date": return addDays(showDate, -1);
    case "rehearsal_date": return event.duration > 1 ? showDate : null;
    case "event_dates": return event.duration > 1 ? `${event.startDate} to ${event.endDate}` : event.startDate;
    case "dismantling_date": return addDays(event.endDate, 1);
    case "timings_with_ac": return "18:00-22:00";
    case "ac_hours": return "4h";
    case "timings_without_ac": return "10:00-18:00";
    case "non_ac_hours": return "8h";
    case "costing_email": return active ? "Yes" : "No";
    case "proforma_invoice": return active ? "Sent" : "Not Sent";
    case "installment_1_expected_date": return addDays(event.enquiryDate, 7);
    case "installment_2_expected_date": return null;
    case "installment_3_expected_date": return null;
    case "installment_4_expected_date": return null;
    case "installment_5_expected_date": return null;
    case "payment_status": return active ? "Completed" : "Incomplete";
    case "confirmation_made": return "No";
    case "confirmation_couriered": return null;
    case "confirmation_signed_received": return "No";
    case "exec_sound_light": return event.index % 2 === 0 ? "Captured on form" : "Not started";
    case "exec_catering_decorator": return event.index % 3 === 0 ? "Verified" : "Not started";
    case "req_piano": return event.nature.includes("Music") ? "Required" : "Not Required";
    case "req_liquor_license": return event.eventType === "EE" ? "Required" : "Not Required";
    case "req_orchestra_pit_chairs": return event.venues.includes("TATA") ? "Required" : "Not Required";
    case "req_digital_standee": return "Required";
    case "req_car_display": return event.index % 9 === 0 ? "Required" : "Not Required";
    case "req_bike_display": return "Not Required";
    case "req_stalls": return event.index % 5 === 0 ? "Required" : "Not Required";
    case "req_telecasting_media": return event.eventType === "EE" ? "Required" : "Not Required";
    case "noc_sent": return event.index % 4 === 0 ? "Yes" : "No";
    case "noc_sent_on": return event.index % 4 === 0 ? addDays(event.startDate, -14) : null;
    case "onstage_asked_client": return active ? addDays(event.startDate, -12) : null;
    case "onstage_received_from_client": return null;
    case "onstage_sent_to_team": return null;
    case "onstage_verified": return null;
    case "onstage_complete": return null;
    case "technical_meeting_date": return addDays(event.startDate, -5);
    case "minutes_of_meeting": return "No";
    case "no_of_crew_cards": return String(8 + (event.index % 18));
    case "house_seats": return String(4 + (event.index % 10));
    case "licenses": return event.index % 3 === 0 ? "PPL, IPRS" : "Standard venue permissions";
    case "licenses_status": return event.index % 3 === 0 ? "Received" : "Not required";
    case "decorator_name": return ["Bloom & Beam", "StageCraft", "Ivory Events"][event.index % 3]!;
    case "decorator_tier": return ["A", "B", "C"][event.index % 3]!;
    case "caterer_name": return ["Copper Plate", "Saffron Kitchen", "Bay Leaf"][event.index % 3]!;
    case "caterer_tier": return ["A", "B", "C"][event.index % 3]!;
    case "type_of_catering": return ["Veg", "Non-Veg", "Veg & Non-Veg", "Tea/Coffee"][event.index % 4]!;
    case "no_of_pax": return String(120 + event.index * 12);
    case "feedback_sent": return null;
    case "feedback_received": return null;
    case "event_report": return "Not Ready";
    case "box_office_statement": return "Awaiting";
    case "event_status": return event.status;
    case "file_sent_to_accounts": return null;
    case "notify_after_3_days": return "Yes";
    case "file_received_back_edit_1": return "Pending";
    case "file_received_back_edit_2": return "Pending";
    case "final_file_received": return "No";
    case "security_deposit_refund": return event.eventType === "VFH" ? "Applicable" : "N/A";
    case "box_office_collection_refund": return event.eventType === "FR" ? "Applicable" : "N/A";
    case "payment_advice": return "Awaiting";
    case "tds_certificate_sent_to_client": return "No";
    case "tds_certificate_refund_and_payment_advice": return "Awaiting";
    case "payment_ledger": return "Requested";
    case "tax_invoice_sent": return "Not Sent";
    case "box_office_statement_sent": return "Not Sent";
    case "payment_advice_received_from_client": return "No";
    case "tds_certificate_from_client": return "N.A.";
    case "tds_payment_and_advice_sent": return "Awaiting";
    case "payment_ledger_sent": return "Requested";
    case "accounts_file_status": return "Open";
    case "outstanding_to_client": return "Pending";
    case "notifications_triggered": return "2";
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

/**
 * Six enquiry-stage events. Every event starts at `enquiry` so the lifecycle
 * can be driven manually from the UI. Four enquiry dates fall in June and two
 * in early July (the lifecycle starts ~1 month before "today"); show dates
 * begin in September and stay ≥ 1 month ahead of the enquiry date.
 *
 *   #  enquiry     show         type        venues
 *   1  2026-06-08  2026-09-10   VFH         JBT, TATA
 *   2  2026-06-12  2026-09-18   EE          TATA, LT
 *   3  2026-06-17  2026-09-25   FR          TET
 *   4  2026-06-20  2026-10-02   Free Event  JBT, TATA, TET
 *   5  2026-07-01  2026-10-09   VFH         GDT
 *   6  2026-07-05  2026-10-16   EE          LT
 */
const DEMO_EVENTS: Array<Pick<DemoEvent, "enquiryDate" | "startDate" | "eventType" | "nature" | "venues">> = [
  { enquiryDate: "2026-06-08", startDate: "2026-09-10", eventType: "VFH", nature: "Classical Recital", venues: ["JBT", "TATA"] },
  { enquiryDate: "2026-06-12", startDate: "2026-09-18", eventType: "EE", nature: "Corporate Leadership Summit", venues: ["TATA", "LT"] },
  { enquiryDate: "2026-06-17", startDate: "2026-09-25", eventType: "FR", nature: "Fundraiser Gala", venues: ["TET"] },
  { enquiryDate: "2026-06-20", startDate: "2026-10-02", eventType: "Free Event", nature: "Dance Performance", venues: ["JBT", "TATA", "TET"] },
  { enquiryDate: "2026-07-01", startDate: "2026-10-09", eventType: "VFH", nature: "Music Concert", venues: ["GDT"] },
  { enquiryDate: "2026-07-05", startDate: "2026-10-16", eventType: "EE", nature: "Awards Evening", venues: ["LT"] },
];

function durationDays(venues: string[]): number {
  if (venues.length >= 3) return 3;
  if (venues.length === 2) return 2;
  return 1;
}

function buildEvents(orgNames: string[]): DemoEvent[] {
  const events: DemoEvent[] = [];
  DEMO_EVENTS.forEach((spec, index) => {
    const orgName = orgNames[index % orgNames.length]!;
    const duration = durationDays(spec.venues);
    const endDate = addDays(spec.startDate, duration - 1);
    const enquiryMonth = Number(spec.enquiryDate.slice(5, 7));
    const code = `DEMO-2026-${pad(enquiryMonth)}-${pad(index + 1)}`;
    events.push({
      index,
      id: `demo_ev_${pad(index + 1)}`,
      code,
      title: `${orgName} - ${spec.nature}`,
      orgId: `demo_org_${pad(index % orgNames.length)}`,
      orgName,
      contactId: `demo_ct_${pad(index % orgNames.length)}`,
      eventType: spec.eventType,
      status: "enquiry",
      nature: spec.nature,
      venues: spec.venues,
      duration,
      startDate: spec.startDate,
      endDate,
      enquiryDate: spec.enquiryDate,
      confirmationDate: null,
      email: `events+${slug(orgName)}@example.com`,
      phone: `+91 98${String(70000000 + index * 137).slice(0, 8)}`,
    });
  });
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
    // Demo accounts carry explicit permission lists (roles are legacy-only).
    const permissions = JSON.stringify(LEGACY_ROLE_PERMISSIONS[user.role] ?? []);
    batch.add(
      `INSERT INTO users (id, email, name, permissions, organisation, password_hash, password_algo, password_updated_at, is_active, created_at, updated_at)
       VALUES (${sqlStr(user.id)}, ${sqlStr(user.email)}, ${sqlStr(user.name)}, ${sqlStr(permissions)}, ${sqlStr(user.organisation)},
       ${sqlStr(DEMO_PASSWORD_HASH)}, 'scrypt', ${sqlStr(timestamp)}, 1, ${sqlStr(timestamp)}, ${sqlStr(timestamp)})
       ON CONFLICT(email) DO UPDATE SET
         name = excluded.name,
         permissions = excluded.permissions,
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
       ${sqlStr("Demo organisation for testing.")}, ${sqlStr(timestamp)}, ${sqlStr(timestamp)});`
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
    // Enquiry-stage defaults: no approval/confirmation yet.
    const approvalStatus = event.eventType === "VFH" ? "pending" : "not_required";
    const confirmationStatus = "none";
    const requirements = {
      sound: event.index % 2 === 0,
      lighting: true,
      stage: event.venues.length > 1 ? "multi-venue coordination" : "standard",
      greenRooms: 1 + (event.index % 3),
      security: event.venues.length >= 3,
      notes: `Demo ${event.venues.length}-venue enquiry.`,
    };
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
       ${sqlStr(event.enquiryDate + "T10:00:00.000Z")}, ${sqlStr(event.enquiryDate + "T10:00:00.000Z")});`
    );
    batch.add(
      `INSERT INTO event_status_history (id, event_id, from_status, to_status, changed_by, changed_at, reason)
       VALUES (${sqlStr(`demo_sh_${event.id}_created`)}, ${sqlStr(event.id)}, NULL, 'enquiry', NULL, ${sqlStr(event.enquiryDate + "T10:00:00.000Z")}, 'Demo event created');`
    );
    batch.add(
      `INSERT INTO event_activity (id, event_id, activity_type, detail, actor_id, created_at)
       VALUES (${sqlStr(`demo_act_${event.id}`)}, ${sqlStr(event.id)}, 'created', ${sqlStr(JSON.stringify({ title: event.title }))}, NULL, ${sqlStr(timestamp)});`
    );

    seedDocumentsForEvent(batch, event, timestamp);

    event.venues.forEach((venue, venueIndex) => {
      const vbId = `demo_vb_${event.id}_${slug(venue)}`;
      batch.add(
        `INSERT INTO venue_bookings (id, event_id, venue, booking_status, number_of_shows, requirements, notes, sort_order, created_at, updated_at)
         VALUES (${sqlStr(vbId)}, ${sqlStr(event.id)}, ${sqlStr(venue)}, 'tentative',
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
  const firstPaymentDue = maxIsoDate(addDays(event.enquiryDate, 10), addDays(event.startDate, -70));
  const operationsDue = addDays(event.startDate, -28);

  // Enquiry-stage: only the "what to do next" tasks are open.
  specs.push({
    slug: "approval",
    title: event.eventType === "VFH" ? "Approval follow-up with programming head" : "Lifecycle readiness checkpoint",
    description: "Confirm whether the event can move to the next lifecycle stage.",
    sourceRule: "approval_followup",
    assigneeId: "demo_user_aditi",
    dueDate: approvalDue,
    priority: approvalDue <= DEMO_TODAY ? "high" : "medium",
    status: approvalDue < DEMO_TODAY ? "in_progress" : "open",
  });

  specs.push({
    slug: "payment",
    title: "Reconcile proforma invoice",
    description: "Track expected payment milestone and update accounts checklist.",
    sourceRule: "proforma_invoice",
    assigneeId: "demo_user_farah",
    dueDate: firstPaymentDue,
    priority: firstPaymentDue <= DEMO_TODAY ? "high" : "medium",
    status: firstPaymentDue < DEMO_TODAY ? "in_progress" : "open",
  });

  specs.push({
    slug: "operations",
    title: event.index % 2 === 0 ? "OnStage technical sheet review" : "Schedule technical meeting",
    description: "Coordinate production, venue, and client technical requirements.",
    sourceRule: event.index % 2 === 0 ? "onstage_followup" : "technical_meeting",
    assigneeId: "demo_user_kabir",
    dueDate: operationsDue,
    priority: operationsDue <= addDays(DEMO_TODAY, 14) ? "high" : "medium",
    status: "open",
  });

  specs.push({
    slug: "manual",
    title: "Manual client follow-up",
    description: "General coordination note for the operations team.",
    sourceRule: null,
    assigneeId: ownerUser.id,
    dueDate: addDays(event.enquiryDate, 7 + (event.index % 9)),
    priority: "medium",
    status: "open",
  });

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
        `INSERT INTO notifications (id, idempotency_key, recipient_permission, title, body, channel, related_event_id, related_task_id, is_read, created_at)
         VALUES (${sqlStr(`demo_ntf_${event.id}_${spec.slug}`)}, ${sqlStr(`demo-task-${event.id}-${spec.slug}`)}, ${sqlStr(spec.slug === "accounts" ? "user.manage" : "task.assign")},
         ${sqlStr(spec.status === "in_progress" ? "Task in progress" : "Demo task ready")}, ${sqlStr(`${spec.title}: ${event.title}`)}, 'in_app',
         ${sqlStr(event.id)}, ${sqlStr(taskId)}, ${spec.status === "completed" ? 1 : 0}, ${sqlStr(timestamp)});`
      );
  });
}

function seedDocumentsForEvent(batch: SqlBatch, event: DemoEvent, timestamp: string): void {
  // Enquiry-stage: only the inbound inquiry document exists.
  batch.add(
    `INSERT INTO documents (id, event_id, venue_booking_id, checklist_item_id, file_name, r2_key, mime_type, file_size, category, uploaded_by, uploaded_at, notes)
     VALUES (${sqlStr(`demo_doc_${event.id}_inquiry`)}, ${sqlStr(event.id)}, NULL, NULL,
     ${sqlStr(`${event.code}-inquiry.pdf`)}, ${sqlStr(`demo/${event.id}/inquiry.pdf`)},
     'application/pdf', ${112000 + event.index * 137}, 'inquiry', 'demo_user_admin', ${sqlStr(timestamp)},
     ${sqlStr("Demo document metadata; no R2 object is required for UI testing.")});`
  );
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
