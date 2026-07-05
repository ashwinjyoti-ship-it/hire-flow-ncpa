/**
 * Organisation & contact API routes.
 *   GET    /organisations              — list (with search)
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

// GET / — list with optional prefix search (used by the form's org combobox)
organisationRoutes.get("/", requireUser, async (c) => {
  const q = c.req.query("q")?.trim();
  let sql = `SELECT o.id, o.name, o.org_type, o.is_archived,
             (SELECT COUNT(*) FROM events e WHERE e.organisation_id = o.id) AS event_count,
             (SELECT name FROM contacts WHERE organisation_id = o.id AND is_primary = 1 LIMIT 1) AS primary_contact
             FROM organisations o WHERE o.is_archived = 0`;
  const binds: unknown[] = [];
  if (q) {
    sql += ` AND LOWER(o.name) LIKE ?`;
    binds.push(`%${q.toLowerCase()}%`);
  }
  sql += ` ORDER BY o.name LIMIT 200`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json({ organisations: results });
});

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
