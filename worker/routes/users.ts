/**
 * User (account) management routes — Phase 8a identity layer.
 *   GET    /users                       — list all accounts (admin only)
 *   POST   /users                       — create an owner account (+ handled_by option)
 *   PUT    /users/:id                   — edit name/email/role (syncs handled_by option)
 *   POST   /users/:id/reset             — admin-forced password reset
 *   POST   /users/:id/deactivate        — soft-deactivate (user + handled_by option)
 *   POST   /users/:id/activate          — reactivate
 *
 * Design: the admin is the sole gatekeeper. Creating an event owner produces a
 * real login (no self-registration). Each new account gets a one-time
 * temporary password and must_change_password = 1 so the owner sets their own
 * on first sign-in. The admin can also edit their own account here, which is
 * what enables handing the admin role over to the client.
 */
import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AuthEnv } from "../middleware/auth";
import { actorFrom, ipHint, requirePermission } from "../middleware/auth";
import { audit } from "../lib/audit";
import { makeId } from "../lib/id";
import { generateTemporaryPassword, hashPassword } from "../lib/crypto";
import { revokeAllSessions } from "../lib/sessions";
import { createUser } from "./auth";

export const userRoutes = new Hono<AuthEnv>();

// Admin-only across the board. User management is a sensitive surface.
userRoutes.use("*", requirePermission("user.manage"));

const ROLES = ["admin", "venue_manager", "coordinator", "viewer"] as const;

// ---- GET / — list all accounts ----
userRoutes.get("/", async (c) => {
  const db = c.env.DB;
  const { results } = await db.prepare(
    `SELECT id, email, name, role, organisation, is_active, must_change_password,
            totp_secret IS NOT NULL AS mfa_enrolled, created_at, updated_at
     FROM users ORDER BY is_active DESC, name`
  ).all();
  return c.json({ users: results ?? [] });
});

// ---- POST / — create an owner account ----
// Creates a users row AND a matching handled_by dropdown option atomically, so
// the owner both has a login and appears in the Event Owner dropdown.
const CreateBody = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  role: z.enum(ROLES).default("venue_manager"),
  organisation: z.string().nullish(),
});

userRoutes.post("/", async (c) => {
  const parsed = CreateBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Invalid input", detail: parsed.error.flatten() }, 400);
  const { name, email, role, organisation } = parsed.data;
  const db = c.env.DB;
  const admin = c.get("user")!;
  const now = new Date().toISOString();

  // Reject if the email is already in use.
  const existing = await db.prepare("SELECT id FROM users WHERE email = ?").bind(email.toLowerCase()).first();
  if (existing) return c.json({ error: "A user with that email already exists" }, 409);

  // Reject a duplicate owner name (handled_by values are the identity label).
  const dupOption = await db.prepare(
    "SELECT id FROM dropdown_options WHERE list_key = 'handled_by' AND LOWER(value) = LOWER(?)"
  ).bind(name.trim()).first();
  if (dupOption) return c.json({ error: "An event owner with that name already exists" }, 409);

  const temporaryPassword = generateTemporaryPassword();
  const userId = (await createUser(db, { email, name: name.trim(), role, password: temporaryPassword, organisation: organisation ?? null })).id;

  // Force a password change on first sign-in (createUser doesn't set this).
  await db.prepare("UPDATE users SET must_change_password = 1, updated_at = ? WHERE id = ?").bind(now, userId).run();

  // Create the matching dropdown option so the owner appears in the Event Owner dropdown.
  const optionId = makeId("dd_handled_by");
  const sortOrderRow = await db.prepare(
    "SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM dropdown_options WHERE list_key = 'handled_by'"
  ).first<{ next: number }>();
  await db.prepare(
    `INSERT INTO dropdown_options (id, list_key, value, sort_order, is_active, metadata, created_at)
     VALUES (?, 'handled_by', ?, ?, 1, NULL, ?)`
  ).bind(optionId, name.trim(), sortOrderRow?.next ?? 1, now).run();

  await audit({
    db, actor: actorFrom(admin), action: "user.created", targetType: "user", targetId: userId,
    detail: { email, role, handled_by_option_id: optionId }, ipHint: ipHint(c.req.raw),
  });

  // The temporary password is returned ONCE for the admin to hand over out-of-band.
  return c.json({ id: userId, email, name: name.trim(), role, temporaryPassword }, 201);
});

// ---- PUT /:id — edit name/email/role ----
// Renaming syncs the handled_by option so the dropdown stays consistent. The
// admin may edit their own account here (including handing the admin role to
// the client by editing another user into admin).
const UpdateBody = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  role: z.enum(ROLES).optional(),
  organisation: z.string().nullish(),
});

userRoutes.put("/:id", async (c) => {
  const parsed = UpdateBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Invalid input", detail: parsed.error.flatten() }, 400);
  const id = c.req.param("id");
  const db = c.env.DB;
  const admin = c.get("user")!;
  const now = new Date().toISOString();
  const d = parsed.data;

  const current = await db.prepare("SELECT name, email FROM users WHERE id = ?").bind(id).first<{ name: string; email: string }>();
  if (!current) return c.json({ error: "User not found" }, 404);

  const nextEmail = d.email ? d.email.toLowerCase() : current.email;
  const nextName = d.name ? d.name.trim() : current.name;

  if (d.email) {
    const clash = await db.prepare("SELECT id FROM users WHERE email = ? AND id != ?").bind(nextEmail, id).first();
    if (clash) return c.json({ error: "That email is already in use" }, 409);
  }

  await db.prepare(
    `UPDATE users SET name = ?, email = ?, role = COALESCE(?, role),
       organisation = COALESCE(?, organisation), updated_at = ? WHERE id = ?`
  ).bind(nextName, nextEmail, d.role ?? null, d.organisation ?? null, now, id).run();

  // Keep the handled_by option label in sync with the user's name.
  if (d.name) {
    await db.prepare(
      "UPDATE dropdown_options SET value = ? WHERE list_key = 'handled_by' AND LOWER(value) = LOWER(?)"
    ).bind(nextName, current.name).run();
  }

  await audit({
    db, actor: actorFrom(admin), action: "user.updated", targetType: "user", targetId: id,
    detail: { name: nextName, email: nextEmail, role: d.role }, ipHint: ipHint(c.req.raw),
  });
  return c.json({ ok: true });
});

// ---- POST /:id/reset — admin-forced password reset ----
// Mirrors auth.ts /password/admin-reset, routed by through the users surface.
userRoutes.post("/:id/reset", async (c) => {
  const id = c.req.param("id");
  const db = c.env.DB;
  const admin = c.get("user")!;
  const now = new Date().toISOString();

  const target = await db.prepare("SELECT id, email, name, is_active FROM users WHERE id = ?").bind(id)
    .first<{ id: string; email: string; name: string; is_active: number }>();
  if (!target) return c.json({ error: "User not found" }, 404);

  const temporaryPassword = generateTemporaryPassword();
  await db.prepare(
    "UPDATE users SET password_hash = ?, password_updated_at = ?, must_change_password = 1, updated_at = ? WHERE id = ?"
  ).bind(hashPassword(temporaryPassword), now, now, target.id).run();
  await revokeAllSessions(db, target.id);

  await audit({
    db, actor: actorFrom(admin), action: "auth.password_admin_reset", targetType: "user", targetId: target.id,
    ipHint: ipHint(c.req.raw),
  });
  return c.json({ ok: true, email: target.email, name: target.name, temporaryPassword });
});

// ---- POST /:id/deactivate & /:id/activate ----
// Soft-toggle the user AND the matching handled_by option so deactivated owners
// stop appearing as an assignable Event Owner but keep historical events valid.
userRoutes.post("/:id/deactivate", async (c) => {
  return toggleActive(c, c.req.param("id"), false);
});
userRoutes.post("/:id/activate", async (c) => {
  return toggleActive(c, c.req.param("id"), true);
});

async function toggleActive(c: Context<AuthEnv>, id: string, active: boolean) {
  const db = c.env.DB;
  const admin = c.get("user")!;
  const now = new Date().toISOString();

  const target = await db.prepare("SELECT id, name FROM users WHERE id = ?").bind(id).first<{ id: string; name: string }>();
  if (!target) return c.json({ error: "User not found" }, 404);

  // Refuse to let the admin deactivate themselves (would lock the workspace out).
  if (!active && target.id === admin.id) {
    return c.json({ error: "You cannot deactivate your own account" }, 422);
  }

  await db.prepare("UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?").bind(active ? 1 : 0, now, target.id).run();
  await db.prepare(
    "UPDATE dropdown_options SET is_active = ? WHERE list_key = 'handled_by' AND LOWER(value) = LOWER(?)"
  ).bind(active ? 1 : 0, target.name).run();

  if (!active) await revokeAllSessions(db, target.id);

  await audit({
    db, actor: actorFrom(admin), action: active ? "user.activated" : "user.deactivated",
    targetType: "user", targetId: target.id, ipHint: ipHint(c.req.raw),
  });
  return c.json({ ok: true });
}
