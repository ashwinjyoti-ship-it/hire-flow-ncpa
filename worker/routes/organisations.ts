/**
 * Organisation & contact API routes.
 *   GET    /organisations              — list (distinct by name, with search + enriched facets)
 *   GET    /organisations/:id          — detail (with contacts + event count)
 *   POST   /organisations              — create
 *   PUT    /organisations/:id          — update
 *   POST   /organisations/:id/contacts — add contact
 *   PUT    /organisations/:id/contacts/:contactId — update contact
 */
import { Hono } from "hono";
import type { AuthEnv } from "../middleware/auth";
import { requireUser, requirePermission, actorFrom } from "../middleware/auth";
import { OrganisationInput, ContactInput } from "../lib/types";
import { audit } from "../lib/audit";
import { makeId } from "../lib/id";

export const organisationRoutes = new Hono<AuthEnv>();

// GET / — list with optional prefix search (used by the form's org combobox AND the
// Organisations page). Returns one row per DISTINCT org name (case-insensitive),
// merging the 4 Excel-spelling duplicates (113 rows → 109 distinct orgs), and
// derives the enriched fields the faceted page needs from existing columns.
organisationRoutes.get("/", requireUser, async (c) => {
  const q = c.req.query("q")?.trim();
  // Aggregate per canonical name (LOWER(TRIM(name))). Pick the lexicographically
  // smallest id as the representative so the row is stable across requests.
  const sql = `SELECT
        MIN(o.id)                              AS id,
        MIN(o.name)                            AS name,
        MIN(o.org_type)                        AS org_type,
        MIN(o.is_archived)                     AS is_archived,
        MIN(o.updated_at)                      AS updated_at,
        SUM((SELECT COUNT(*) FROM events e WHERE e.organisation_id = o.id)) AS event_count,
        MIN((SELECT name FROM contacts WHERE organisation_id = o.id AND is_primary = 1 LIMIT 1)) AS primary_contact_name,
        MIN((SELECT email FROM contacts WHERE organisation_id = o.id AND is_primary = 1 LIMIT 1)) AS primary_contact_email,
        MAX((SELECT MAX(e.event_start_date) FROM events e WHERE e.organisation_id = o.id)) AS last_event_date
      FROM organisations o
      WHERE o.is_archived = 0`;
  const binds: unknown[] = [];
  let where = "";
  if (q) {
    where = ` AND LOWER(o.name) LIKE ?`;
    binds.push(`%${q.toLowerCase()}%`);
  }
  const groupOrder = ` GROUP BY LOWER(TRIM(o.name)) ORDER BY MIN(o.name) LIMIT 200`;
  const { results } = await c.env.DB.prepare(sql + where + groupOrder).bind(...binds).all();

  // `last_activity_at` should reflect past engagement, not future bookings — a
  // Dec-2026 event doesn't make an org "active this week" in July. So we take
  // the last event date only if it's on or before today; otherwise fall back to
  // the row's updated_at (seed/import touch time). Both are normalised to ISO.
  const todayIso = new Date().toISOString().slice(0, 10);
  const orgs = (results ?? []).map((r: Record<string, unknown>) => {
    const lastEvt = toIso((r.last_event_date as string | null) ?? null);
    const lastActivity =
      lastEvt && lastEvt <= todayIso
        ? lastEvt
        : toIso((r.updated_at as string | null) ?? null);
    return {
      id: r.id as string,
      name: r.name as string,
      org_type: (r.org_type as string | null) || null,
      is_archived: r.is_archived as number,
      event_count: Number(r.event_count ?? 0),
      primary_contact_name: (r.primary_contact_name as string | null) || null,
      primary_contact_email: (r.primary_contact_email as string | null) || null,
      last_event_date: lastEvt,
      last_activity_at: lastActivity,
    };
  });

  return c.json({ organisations: orgs, total: orgs.length });
});

/**
 * Normalise the date strings stored in `events.event_start_date` to ISO
 * `yyyy-mm-dd`. The seed imports dates as `DD-MMM-YYYY` (e.g. "31-Jul-2026");
 * ISO inputs pass through unchanged. Returns null for null/empty/garbage so the
 * downstream facets/banner can treat "no date" uniformly.
 */
function toIso(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  // Already ISO?
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // DD-MMM-YYYY  (e.g. 31-Jul-2026)
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(s);
  if (m) {
    const day = m[1]!.padStart(2, "0");
    const mon = MONTHS[m[2]!.toLowerCase()];
    if (mon) return `${m[3]}-${mon}-${day}`;
  }
  // Last resort: let JS parse; fall back to null.
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

// GET /:id
organisationRoutes.get("/:id", requireUser, async (c) => {
  const id = c.req.param("id");
  const org = await c.env.DB.prepare(
    `SELECT * FROM organisations WHERE id = ?`
  ).bind(id).first();
  if (!org) return c.json({ error: "Not found" }, 404);
  const { results: contacts } = await c.env.DB.prepare(
    `SELECT * FROM contacts WHERE organisation_id = ? ORDER BY is_primary DESC, name`
  ).bind(id).all();
  const { results: events } = await c.env.DB.prepare(
    `SELECT id, title, status, event_start_date, event_end_date FROM events WHERE organisation_id = ? ORDER BY event_start_date DESC LIMIT 50`
  ).bind(id).all();
  return c.json({ organisation: org, contacts, events });
});

// POST / — create
organisationRoutes.post("/", requirePermission("event.create"), async (c) => {
  const parsed = OrganisationInput.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Invalid input", detail: parsed.error.flatten() }, 400);
  const db = c.env.DB;
  const user = c.get("user")!;
  const id = makeId("org");
  const now = new Date().toISOString();
  const d = parsed.data;
  await db.prepare(
    `INSERT INTO organisations (id, name, org_type, address, gst_number, pan_number, tan_number, bank_details, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, d.name, d.org_type ?? null, d.address ?? null, d.gst_number ?? null,
    d.pan_number ?? null, d.tan_number ?? null,
    d.bank_details ? JSON.stringify(d.bank_details) : null,
    d.notes ?? null, now, now
  ).run();
  await audit({ db, actor: actorFrom(user), action: "org.created", targetType: "organisation", targetId: id, detail: { name: d.name } });
  return c.json({ id }, 201);
});

// PUT /:id — update
organisationRoutes.put("/:id", requirePermission("event.edit"), async (c) => {
  const parsed = OrganisationInput.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Invalid input" }, 400);
  const db = c.env.DB;
  const user = c.get("user")!;
  const id = c.req.param("id");
  const d = parsed.data;
  await db.prepare(
    `UPDATE organisations SET name=?, org_type=?, address=?, gst_number=?, pan_number=?, tan_number=?, bank_details=?, notes=?, updated_at=? WHERE id=?`
  ).bind(
    d.name, d.org_type ?? null, d.address ?? null, d.gst_number ?? null,
    d.pan_number ?? null, d.tan_number ?? null,
    d.bank_details ? JSON.stringify(d.bank_details) : null,
    d.notes ?? null, new Date().toISOString(), id
  ).run();
  await audit({ db, actor: actorFrom(user), action: "org.updated", targetType: "organisation", targetId: id });
  return c.json({ ok: true });
});

// POST /:id/contacts
organisationRoutes.post("/:id/contacts", requirePermission("event.edit"), async (c) => {
  const parsed = ContactInput.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Invalid input" }, 400);
  const db = c.env.DB;
  const user = c.get("user")!;
  const id = c.req.param("id");
  const cid = makeId("ct");
  const d = parsed.data;
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO contacts (id, organisation_id, name, role, email, phone, is_primary, signing_authority, courier_address, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    cid, id, d.name, d.role ?? null, d.email ?? null, d.phone ?? null,
    d.is_primary ? 1 : 0, d.signing_authority ? 1 : 0, d.courier_address ?? null, now, now
  ).run();
  await audit({ db, actor: actorFrom(user), action: "org.contact_added", targetType: "organisation", targetId: id, detail: { name: d.name } });
  return c.json({ id: cid }, 201);
});
