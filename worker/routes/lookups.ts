/**
 * Lookup (dropdown_options) CRUD routes — admin-managed master lists.
 *   GET    /lookups/:list_key            — list options for a key (active+inactive)
 *   POST   /lookups/:list_key            — add a value
 *   PUT    /lookups/:list_key/:id        — edit (rename / activate-deactivate)
 *   DELETE /lookups/:list_key/:id        — soft-delete (is_active = 0)
 *
 * Reuses the existing dropdown_options table. The public read endpoint
 * (active options grouped by key) remains in app.ts.
 */
import { Hono } from "hono";
import { z } from "zod";
import type { AuthEnv } from "../middleware/auth";
import { requirePermission, requireUser, actorFrom } from "../middleware/auth";
import { audit } from "../lib/audit";
import { makeId } from "../lib/id";

export const lookupRoutes = new Hono<AuthEnv>();

// Lists that admins may manage via this endpoint.
const MANAGED_LISTS = new Set(["caterer", "decorator"]);

lookupRoutes.get("/:list_key", requireUser, async (c) => {
  const listKey = c.req.param("list_key");
  const { results } = await c.env.DB.prepare(
    `SELECT id, value, sort_order, is_active, metadata, created_at
     FROM dropdown_options WHERE list_key = ? ORDER BY sort_order, value`
  ).bind(listKey).all();
  return c.json({ options: results });
});

const CreateBody = z.object({
  value: z.string().min(1).max(200),
  sort_order: z.number().int().nonnegative().optional(),
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

  // Compute next sort_order if not provided.
  let sortOrder = parsed.data.sort_order;
  if (sortOrder == null) {
    const row = await db.prepare(
      `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM dropdown_options WHERE list_key = ?`
    ).bind(listKey).first<{ next: number }>();
    sortOrder = row?.next ?? 1;
  }

  try {
    await db.prepare(
      `INSERT INTO dropdown_options (id, list_key, value, sort_order, is_active, metadata, created_at)
       VALUES (?, ?, ?, ?, 1, NULL, ?)`
    ).bind(id, listKey, value, sortOrder, now).run();
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

  await db.prepare(
    `UPDATE dropdown_options
       SET value = COALESCE(?, value),
           sort_order = COALESCE(?, sort_order),
           is_active = COALESCE(?, is_active)
     WHERE id = ? AND list_key = ?`
  ).bind(
    d.value?.trim() ?? null,
    d.sort_order ?? null,
    d.is_active == null ? null : d.is_active ? 1 : 0,
    id, listKey
  ).run();

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
