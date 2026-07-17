/**
 * Lookup (dropdown_options) CRUD routes — admin-managed master lists.
 *   GET    /lookups/:list_key            — list options for a key (active+inactive)
 *   POST   /lookups/:list_key            — add a value
 *   PUT    /lookups/:list_key/:id        — edit (rename / activate-deactivate / metadata)
 *   DELETE /lookups/:list_key/:id        — soft-delete (is_active = 0)
 *
 * Reuses the existing dropdown_options table. The public read endpoint
 * (active options grouped by key) remains in app.ts.
 *
 * programme officers (list_key = program_officer) store contact_number in
 * metadata — they are not login accounts.
 */
import { Hono } from "hono";
import { z } from "zod";
import type { AuthEnv } from "../middleware/auth";
import { requirePermission, requireUser, actorFrom } from "../middleware/auth";
import { audit } from "../lib/audit";
import { makeId } from "../lib/id";

export const lookupRoutes = new Hono<AuthEnv>();

// Lists that admins may manage via this endpoint.
const MANAGED_LISTS = new Set(["handled_by", "caterer", "decorator", "program_officer"]);

const MetadataBody = z.record(z.unknown()).nullish();

lookupRoutes.get("/:list_key", requireUser, async (c) => {
  const listKey = c.req.param("list_key");
  const { results } = await c.env.DB.prepare(
    `SELECT id, value, sort_order, is_active, metadata, created_at
     FROM dropdown_options WHERE list_key = ? ORDER BY sort_order, value`
  ).bind(listKey).all();
  const options = (results ?? []).map((row) => {
    const r = row as {
      id: string;
      value: string;
      sort_order: number;
      is_active: number;
      metadata: string | null;
      created_at: string;
    };
    let metadata: Record<string, unknown> | null = null;
    if (r.metadata) {
      try { metadata = JSON.parse(r.metadata) as Record<string, unknown>; } catch { metadata = null; }
    }
    return { ...r, metadata };
  });
  return c.json({ options });
});

const CreateBody = z.object({
  value: z.string().min(1).max(200),
  sort_order: z.number().int().nonnegative().optional(),
  metadata: MetadataBody,
});

lookupRoutes.post("/:list_key", requirePermission("settings.manage"), async (c) => {
  const listKey = c.req.param("list_key");
  if (!MANAGED_LISTS.has(listKey)) {
    return c.json({ error: `List '${listKey}' is not admin-managed via this endpoint` }, 400);
  }
  const parsed = CreateBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Invalid input", detail: parsed.error.flatten() }, 400);

  const db = c.env.DB;
  const user = c.get("user")!;
  const id = makeId("opt");
  const now = new Date().toISOString();
  const value = parsed.data.value.trim();

  if (listKey === "program_officer") {
    const contact = typeof parsed.data.metadata?.contact_number === "string"
      ? parsed.data.metadata.contact_number.trim()
      : "";
    if (!contact) {
      return c.json({ error: "Programme officers need a contact number" }, 400);
    }
  }

  // Compute next sort_order if not provided.
  let sortOrder = parsed.data.sort_order;
  if (sortOrder == null) {
    const row = await db.prepare(
      `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM dropdown_options WHERE list_key = ?`
    ).bind(listKey).first<{ next: number }>();
    sortOrder = row?.next ?? 1;
  }

  const metadataJson = parsed.data.metadata == null ? null : JSON.stringify(parsed.data.metadata);

  try {
    await db.prepare(
      `INSERT INTO dropdown_options (id, list_key, value, sort_order, is_active, metadata, created_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`
    ).bind(id, listKey, value, sortOrder, metadataJson, now).run();
  } catch {
    return c.json({ error: `Value '${value}' already exists in '${listKey}'` }, 409);
  }

  await audit({ db, actor: actorFrom(user), action: "lookup.created", targetType: "dropdown_options", targetId: id, detail: { list_key: listKey, value } });
  return c.json({ id }, 201);
});

const UpdateBody = z.object({
  value: z.string().min(1).max(200).optional(),
  sort_order: z.number().int().nonnegative().optional(),
  is_active: z.boolean().optional(),
  metadata: MetadataBody,
});

lookupRoutes.put("/:list_key/:id", requirePermission("settings.manage"), async (c) => {
  const listKey = c.req.param("list_key");
  const id = c.req.param("id");
  if (!MANAGED_LISTS.has(listKey)) {
    return c.json({ error: `List '${listKey}' is not admin-managed via this endpoint` }, 400);
  }
  const parsed = UpdateBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Invalid input", detail: parsed.error.flatten() }, 400);

  const db = c.env.DB;
  const user = c.get("user")!;
  const d = parsed.data;

  if (listKey === "program_officer" && d.metadata !== undefined) {
    const contact = typeof d.metadata?.contact_number === "string"
      ? d.metadata.contact_number.trim()
      : "";
    if (d.metadata !== null && !contact) {
      return c.json({ error: "Programme officers need a contact number" }, 400);
    }
  }

  const setClauses = [
    "value = COALESCE(?, value)",
    "sort_order = COALESCE(?, sort_order)",
    "is_active = COALESCE(?, is_active)",
  ];
  const binds: unknown[] = [
    d.value?.trim() ?? null,
    d.sort_order ?? null,
    d.is_active == null ? null : d.is_active ? 1 : 0,
  ];
  if (d.metadata !== undefined) {
    setClauses.push("metadata = ?");
    binds.push(d.metadata == null ? null : JSON.stringify(d.metadata));
  }
  binds.push(id, listKey);

  await db.prepare(
    `UPDATE dropdown_options SET ${setClauses.join(", ")} WHERE id = ? AND list_key = ?`
  ).bind(...binds).run();

  await audit({ db, actor: actorFrom(user), action: "lookup.updated", targetType: "dropdown_options", targetId: id, detail: { list_key: listKey, ...d } });
  return c.json({ ok: true });
});

// Soft-delete (deactivate) — keeps historical event references valid.
lookupRoutes.delete("/:list_key/:id", requirePermission("settings.manage"), async (c) => {
  const listKey = c.req.param("list_key");
  const id = c.req.param("id");
  if (!MANAGED_LISTS.has(listKey)) {
    return c.json({ error: `List '${listKey}' is not admin-managed via this endpoint` }, 400);
  }
  const db = c.env.DB;
  const user = c.get("user")!;
  await db.prepare(
    `UPDATE dropdown_options SET is_active = 0 WHERE id = ? AND list_key = ?`
  ).bind(id, listKey).run();
  await audit({ db, actor: actorFrom(user), action: "lookup.deactivated", targetType: "dropdown_options", targetId: id, detail: { list_key: listKey } });
  return c.json({ ok: true });
});
