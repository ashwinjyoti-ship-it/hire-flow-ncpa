/**
 * Excel seed importer: parses the Executive Event Tracker workbook and maps its
 * transactional sheets into organisations / contacts / events / venue_bookings.
 *
 * Source workbook (relative to repo root):
 *   ../Excel Forms/Executive Event Tracker with Charts 2.xlsx
 *
 * Performance: accumulates ALL inserts into a SqlBatch and flushes in chunks,
 * so we spawn only a handful of `wrangler d1 execute` processes.
 *
 * Idempotent: upserts by event_code and uses INSERT OR IGNORE for orgs/contacts/
 * venue_bookings. Organisations matched by name (case-insensitive, in-memory map).
 */
import { read, utils } from "xlsx";
import { readFileSync } from "node:fs";
import { SqlBatch, sqlStr, type SeedEnv } from "./d1-client";

const WORKBOOK_PATH = "../Excel Forms/Executive Event Tracker with Charts 2.xlsx";

interface SheetRow {
  [key: string]: unknown;
}

function loadRows(sheetName: string): SheetRow[] {
  const buf = readFileSync(WORKBOOK_PATH);
  const wb = read(buf, { type: "buffer", cellDates: true });
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  return utils.sheet_to_json<SheetRow>(ws, { defval: null, raw: false });
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function dateStr(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date && !isNaN(v.getTime())) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = str(v);
  if (!s) return null;
  const m1 = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m1) {
    const a = m1[1]!;
    const b = m1[2]!;
    let c = m1[3]!;
    if (c.length === 2) c = "20" + c;
    if (Number(a) > 12) {
      return `${c}-${b.padStart(2, "0")}-${a.padStart(2, "0")}`;
    }
    return `${c}-${a.padStart(2, "0")}-${b.padStart(2, "0")}`;
  }
  const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;
  return s;
}

function mapStatus(workbookStatus: string | null, sheetName: string): string {
  const s = workbookStatus?.toLowerCase().trim() ?? "";
  if (sheetName === "Regrets") return "cancelled";
  if (sheetName === "Tentative Events") return "tentative";
  if (s.includes("confirm")) return "confirmed";
  if (s.includes("regret")) return "cancelled";
  if (s.includes("tentative")) return "tentative";
  if (s.includes("waitlist")) return "waitlisted";
  return "inquiry";
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export async function seedEventsFromExcel(env: SeedEnv, nowFn: () => string): Promise<number> {
  const batch = new SqlBatch(40);
  const now = nowFn();
  const orgIds = new Map<string, string>(); // lowercased name → org id
  let eventCount = 0;
  const rejected: string[] = [];

  function ensureOrg(name: string): string {
    const key = name.toLowerCase();
    const existing = orgIds.get(key);
    if (existing) return existing;
    const id = `org_${slug(name).slice(0, 40)}_${orgIds.size.toString(36)}`;
    orgIds.set(key, id);
    batch.add(
      `INSERT OR IGNORE INTO organisations (id, name, created_at, updated_at) VALUES (${sqlStr(id)}, ${sqlStr(name)}, ${sqlStr(now)}, ${sqlStr(now)});`
    );
    return id;
  }

  function upsertEvent(row: SheetRow, sheetName: string): void {
    const eventCode = str(row["Enquiry ID"]);
    if (!eventCode) {
      rejected.push(`${sheetName}: row missing Enquiry ID`);
      return;
    }

    const orgName = str(row["Event Name"]) ?? str(row["Type of Event"]) ?? "Unknown Organisation";
    const title = str(row["Type of Event"]) ?? orgName;
    const status = mapStatus(str(row["Status"]), sheetName);
    const orgId = ensureOrg(orgName);

    // Contact (one per row; dedupe handled by ignoring on a composite id later if needed)
    const cName = str(row["Contact Person"]);
    const cEmail = str(row["Email ID"]);
    const cPhone = str(row["Contact Number"]);
    let contactId: string | null = null;
    if (cName || cEmail || cPhone) {
      contactId = `ct_${slug(orgName).slice(0, 24)}_${eventCount.toString(36)}`;
      batch.add(
        `INSERT OR IGNORE INTO contacts (id, organisation_id, name, email, phone, is_primary, created_at, updated_at)
         VALUES (${sqlStr(contactId)}, ${sqlStr(orgId)}, ${sqlStr(cName)}, ${sqlStr(cEmail)}, ${sqlStr(cPhone)}, 1, ${sqlStr(now)}, ${sqlStr(now)});`
      );
    }

    const eventType = str(row["VFH / EE"]);
    const venue = str(row["Venue"]);
    const eventStart = dateStr(row["Event Start Date"]);
    const eventEnd = dateStr(row["Event End Date"]);
    const enquiryDate = dateStr(row["Enquiry Date"]);
    const month = str(row["Month"]);
    const handledBy = str(row["Handled By"]);
    const enquirySource = str(row["Enquiry Source"]);
    const repeatClient = str(row["Repeat Client"]);
    const remarks = str(row["Remarks"]);
    const followUpDate = dateStr(row["Follow-up Date"]);

    const eventId = `ev_${slug(eventCode)}`;
    const notesParts = [remarks, followUpDate ? `Follow-up: ${followUpDate}` : null, month ? `Month: ${month}` : null].filter(Boolean) as string[];
    const repeatVal = repeatClient === "Yes" ? "1" : repeatClient === "No" ? "0" : null;

    batch.add(
      `INSERT INTO events (id, event_code, title, organisation_id, primary_contact_id, event_type, event_owner, event_start_date, event_end_date, enquiry_date, status, enquiry_source, repeat_client, notes, created_at, updated_at)
       VALUES (${sqlStr(eventId)}, ${sqlStr(eventCode)}, ${sqlStr(title)}, ${sqlStr(orgId)}, ${sqlStr(contactId)}, ${sqlStr(eventType)}, ${sqlStr(handledBy)}, ${sqlStr(eventStart)}, ${sqlStr(eventEnd)}, ${sqlStr(enquiryDate)}, ${sqlStr(status)}, ${sqlStr(enquirySource)}, ${sqlStr(repeatVal)}, ${sqlStr(notesParts.join(" | "))}, ${sqlStr(now)}, ${sqlStr(now)})
       ON CONFLICT(event_code) DO UPDATE SET
         title=excluded.title, organisation_id=excluded.organisation_id,
         primary_contact_id=COALESCE(excluded.primary_contact_id, events.primary_contact_id),
         event_type=COALESCE(excluded.event_type, events.event_type),
         event_owner=COALESCE(excluded.event_owner, events.event_owner),
         event_start_date=COALESCE(excluded.event_start_date, events.event_start_date),
         event_end_date=COALESCE(excluded.event_end_date, events.event_end_date),
         enquiry_date=COALESCE(excluded.enquiry_date, events.enquiry_date),
         status=excluded.status, updated_at=excluded.updated_at;`
    );

    if (venue) {
      const vbId = `vb_${slug(eventCode)}_${slug(venue).slice(0, 16)}`;
      batch.add(
        `INSERT OR IGNORE INTO venue_bookings (id, event_id, venue, booking_status, sort_order, created_at, updated_at)
         VALUES (${sqlStr(vbId)}, ${sqlStr(eventId)}, ${sqlStr(venue)}, ${sqlStr(status === "confirmed" ? "confirmed" : "tentative")}, 1, ${sqlStr(now)}, ${sqlStr(now)});`
      );
      if (eventStart) {
        const seId = `se_${vbId}_show`;
        batch.add(
          `INSERT OR IGNORE INTO schedule_entries (id, venue_booking_id, event_id, activity_type, activity_date, sort_order, created_at)
           VALUES (${sqlStr(seId)}, ${sqlStr(vbId)}, ${sqlStr(eventId)}, 'show', ${sqlStr(eventStart)}, 1, ${sqlStr(now)});`
        );
      }
    }

    eventCount++;
  }

  const sheets: Array<{ name: string; normalise?: boolean }> = [
    { name: "Enquiries" },
    { name: "Confirmed Events", normalise: true },
    { name: "Tentative Events" },
    { name: "Regrets" },
  ];

  for (const { name, normalise } of sheets) {
    let rows: SheetRow[] = [];
    try {
      rows = loadRows(name);
    } catch (err) {
      console.log(`    ⚠ Could not read sheet "${name}": ${(err as Error).message}`);
      continue;
    }
    let sheetCount = 0;
    rows.forEach((row, idx) => {
      try {
        if (normalise) {
          // Confirmed Events sheet → normalise into Enquiries column shape.
          const norm: SheetRow = {
            "Enquiry ID": row["Event Name"] ? `CONF_${slug(str(row["Event Name"])!).slice(0, 30)}_${idx}` : null,
            "Event Name": row["Event Name"],
            "Type of Event": row["Type of Event"],
            "VFH / EE": row["VFH/EE"],
            "Venue": row["Venue"],
            "Event Start Date": row["Event Start Date"],
            "Event End Date": row["Event End Date"],
            "Contact Person": row["Contact Person"],
            "Contact Number": row["Contact Number"],
            "Handled By": row["Handled By"],
            "Status": "Confirmed",
            "Month": row["Month"],
          };
          upsertEvent(norm, name);
        } else if (name === "Tentative Events" || name === "Regrets") {
          // These sheets lack an Enquiry ID column; synthesise a stable code.
          const eventName = str(row["Event Name"]);
          const venue = str(row["Venue"]);
          const start = dateStr(row["Event Start Date"]);
          if (!eventName) {
            rejected.push(`${name}: row ${idx} missing Event Name`);
            return;
          }
          const prefix = name === "Regrets" ? "RGT" : "TEN";
          const synthCode = `${prefix}_${slug(eventName).slice(0, 20)}_${slug(venue ?? "novenue").slice(0, 10)}_${idx}`;
          const norm: SheetRow = {
            ...row,
            "Enquiry ID": synthCode,
            "VFH / EE": row["VFH / EE"] ?? row["VFH/EE"],
            "Status": name === "Regrets" ? "Regret" : "Tentative",
          };
          void start;
          upsertEvent(norm, name);
        } else {
          upsertEvent(row, name);
        }
        sheetCount++;
      } catch (err) {
        rejected.push(`${name}: ${(err as Error).message}`);
      }
    });
    // Flush per sheet to keep memory bounded.
    const flushed = batch.flush(env);
    console.log(`    • ${name}: ${sheetCount} rows (${flushed.statements} statements in ${flushed.chunks} chunks).`);
  }

  if (rejected.length > 0) {
    console.log(`    ⚠ ${rejected.length} rows rejected:`);
    for (const r of rejected.slice(0, 10)) console.log(`      - ${r}`);
    if (rejected.length > 10) console.log(`      … and ${rejected.length - 10} more.`);
  }

  return eventCount;
}
