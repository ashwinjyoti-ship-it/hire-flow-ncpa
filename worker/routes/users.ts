/**
 * User (account) management routes — Phase 8a identity layer.
 *   GET    /users                       — list all accounts (user.manage; also
 *                                         readable by event editors for the
 *                                         Event Owner / Programme Officer dropdowns)
 *   POST   /users                       — create an account (optional owner/PO flags)
 *   PUT    /users/:id                   — edit name/email/permissions/designations
 *   POST   /users/:id/reset             — admin-forced password reset
 *   POST   /users/:id/deactivate        — soft-deactivate (user + handled_by option)
 *   POST   /users/:id/activate          — reactivate
 *
 * Design: access is per-user permissions, not roles. Whoever holds
 * `user.manage` is the gatekeeper: creating an account produces a real login
 * (no self-registration) with an explicit permission list. Each new account
 * gets a one-time temporary password and must_change_password = 1.
 *
 * Event owner and programme officer are independent designations on an account.
 * Neither implies the other. Only event owners get a matching handled_by
 * dropdown option (for calendar filters / legacy lists).
 *
 * Lock-out guard: the system refuses any edit or deactivation that would
 * leave zero active accounts holding `user.manage`.
 */
import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AuthEnv } from "../middleware/auth";
import { actorFrom, ipHint, requirePermission } from "../middleware/auth";
import { audit } from "../lib/audit";
import { makeId } from "../lib/id";
import { generateTemporaryPassword, hashPassword } from "../lib/crypto";
import { revokeAllSessions } from "../lib/sessions";
import { ALL_PERMISSIONS, LEGACY_ROLE_PERMISSIONS, can, normalisePermissions, permissionsFromRow, type Permission } from "../lib/rbac";
import { createUser } from "./auth";

export const userRoutes = new Hono<AuthEnv>();

function canListUsers(permissions: readonly string[]): boolean {
  return can(permissions, "user.manage")
    || can(permissions, "event.create")
    || can(permissions, "event.edit");
}

const PermissionList = z.array(z.enum(ALL_PERMISSIONS as [Permission, ...Permission[]]));

/**
 * Count active accounts (other than `exceptId`) that hold user.manage — used
 * to refuse changes that would lock everyone out of account management.
 * Pre-0016 rows (permissions IS NULL) count via their legacy admin role.
 */
async function otherGatekeepers(db: D1Database, exceptId: string): Promise<number> {
  const row = await db.prepare(
    `SELECT COUNT(*) AS c FROM users
     WHERE is_active = 1 AND id != ?
       AND (permissions LIKE '%"user.manage"%' OR (permissions IS NULL AND role = 'admin'))`
  ).bind(exceptId).first<{ c: number }>();
  return row?.c ?? 0;
}

/** Ensure the handled_by dropdown mirrors event-owner designation + name. */
async function syncHandledByOption(
  db: D1Database,
  opts: { name: string; previousName?: string | null; enabled: boolean; now: string },
): Promise<void> {
  const { name, previousName, enabled, now } = opts;
  const lookupName = previousName ?? name;

  if (!enabled) {
    await db.prepare(
      "UPDATE dropdown_options SET is_active = 0 WHERE list_key = 'handled_by' AND LOWER(value) = LOWER(?)"
    ).bind(lookupName).run();
    if (previousName && previousName.toLowerCase() !== name.toLowerCase()) {
      await db.prepare(
        "UPDATE dropdown_options SET is_active = 0 WHERE list_key = 'handled_by' AND LOWER(value) = LOWER(?)"
      ).bind(name).run();
    }
    return;
  }

  const existing = await db.prepare(
    "SELECT id FROM dropdown_options WHERE list_key = 'handled_by' AND LOWER(value) = LOWER(?)"
  ).bind(lookupName).first<{ id: string }>();

  if (existing) {
    await db.prepare(
      "UPDATE dropdown_options SET value = ?, is_active = 1 WHERE id = ?"
    ).bind(name, existing.id).run();
    return;
  }

  // Name changed but no row under the old name — try the new name, else insert.
  const underNew = await db.prepare(
    "SELECT id FROM dropdown_options WHERE list_key = 'handled_by' AND LOWER(value) = LOWER(?)"
  ).bind(name).first<{ id: string }>();
  if (underNew) {
    await db.prepare(
      "UPDATE dropdown_options SET is_active = 1 WHERE id = ?"
    ).bind(underNew.id).run();
    return;
  }

  const sortOrderRow = await db.prepare(
    "SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM dropdown_options WHERE list_key = 'handled_by'"
  ).first<{ next: number }>();
  const optionId = makeId("dd_handled_by");
  await db.prepare(
    `INSERT INTO dropdown_options (id, list_key, value, sort_order, is_active, metadata, created_at)
     VALUES (?, 'handled_by', ?, ?, 1, NULL, ?)`
  ).bind(optionId, name, sortOrderRow?.next ?? 1, now).run();
}

// ---- GET / — list accounts (full for user.manage; limited fields for event editors) ----
userRoutes.get("/", async (c) => {
  const actor = c.get("user");
  if (!actor) return c.json({ error: "Authentication required" }, 401);
  if (!canListUsers(actor.permissions)) {
    return c.json({ error: "Insufficient permissions" }, 403);
  }
  const fullAccess = can(actor.permissions, "user.manage");
  const db = c.env.DB;
  const { results } = await db.prepare(
    fullAccess
      ? `SELECT id, email, name, role, permissions, organisation, contact_number,
                is_event_owner, is_programme_officer, is_active, must_change_password,
                totp_secret IS NOT NULL AS mfa_enrolled, created_at, updated_at
         FROM users ORDER BY is_active DESC, name`
      : `SELECT id, name, contact_number, is_event_owner, is_programme_officer, is_active
         FROM users WHERE is_active = 1 ORDER BY name`
  ).all<Record<string, unknown>>();
  const users = (results ?? []).map((u) => {
    if (!fullAccess) {
      return {
        id: u.id,
        name: u.name,
        contact_number: u.contact_number ?? null,
        is_event_owner: Number(u.is_event_owner) === 1,
        is_programme_officer: Number(u.is_programme_officer) === 1,
        is_active: u.is_active,
      };
    }
    const { role, permissions, is_event_owner, is_programme_officer, ...rest } = u as {
      role: string | null;
      permissions: string | null;
      is_event_owner: number;
      is_programme_officer: number;
    } & Record<string, unknown>;
    return {
      ...rest,
      is_event_owner: Number(is_event_owner) === 1,
      is_programme_officer: Number(is_programme_officer) === 1,
      permissions: permissionsFromRow(permissions, role),
    };
  });
  return c.json({ users });
});

// Gatekeeper-only for mutating routes. User management is a sensitive surface.
userRoutes.use("*", requirePermission("user.manage"));

// ---- POST / — create an account ----
// Creates a users row. When is_event_owner is set, also creates a handled_by
// dropdown option so they appear in calendar owner filters.
const CreateBody = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  permissions: PermissionList.default([...LEGACY_ROLE_PERMISSIONS.venue_manager!]),
  organisation: z.string().nullish(),
  contact_number: z.string().max(50).nullish(),
  is_event_owner: z.boolean().optional(),
  is_programme_officer: z.boolean().optional(),
});

userRoutes.post("/", async (c) => {
  const parsed = CreateBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Invalid input", detail: parsed.error.flatten() }, 400);
  const { name, email, organisation, contact_number, is_event_owner, is_programme_officer } = parsed.data;
  const permissions = normalisePermissions(parsed.data.permissions);
  const db = c.env.DB;
  const admin = c.get("user")!;
  const now = new Date().toISOString();
  const trimmedName = name.trim();
  const asOwner = Boolean(is_event_owner);
  const asProgrammeOfficer = Boolean(is_programme_officer);

  // Reject if the email is already in use.
  const existing = await db.prepare("SELECT id FROM users WHERE email = ?").bind(email.toLowerCase()).first();
  if (existing) return c.json({ error: "A user with that email already exists" }, 409);

  // Reject a duplicate owner name when designating as event owner.
  if (asOwner) {
    const dupOption = await db.prepare(
      "SELECT id FROM dropdown_options WHERE list_key = 'handled_by' AND LOWER(value) = LOWER(?)"
    ).bind(trimmedName).first();
    if (dupOption) return c.json({ error: "An event owner with that name already exists" }, 409);
  }

  const temporaryPassword = generateTemporaryPassword();
  const userId = (await createUser(db, { email, name: trimmedName, permissions, password: temporaryPassword, organisation: organisation ?? null })).id;

  // Force a password change on first sign-in (createUser doesn't set this).
  await db.prepare(
    `UPDATE users SET must_change_password = 1, contact_number = ?,
       is_event_owner = ?, is_programme_officer = ?, updated_at = ?
     WHERE id = ?`
  ).bind(
    contact_number?.trim() || null,
    asOwner ? 1 : 0,
    asProgrammeOfficer ? 1 : 0,
    now,
    userId,
  ).run();

  if (asOwner) {
    await syncHandledByOption(db, { name: trimmedName, enabled: true, now });
  }

  await audit({
    db, actor: actorFrom(admin), action: "user.created", targetType: "user", targetId: userId,
    detail: {
      email,
      permissions,
      is_event_owner: asOwner,
      is_programme_officer: asProgrammeOfficer,
    },
    ipHint: ipHint(c.req.raw),
  });

  // The temporary password is returned ONCE for the admin to hand over out-of-band.
  return c.json({ id: userId, email, name: trimmedName, permissions, temporaryPassword }, 201);
});

// ---- PUT /:id — edit name/email/permissions/designations ----
const UpdateBody = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  permissions: PermissionList.optional(),
  organisation: z.string().nullish(),
  contact_number: z.string().max(50).nullish(),
  is_event_owner: z.boolean().optional(),
  is_programme_officer: z.boolean().optional(),
});

userRoutes.put("/:id", async (c) => {
  const parsed = UpdateBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Invalid input", detail: parsed.error.flatten() }, 400);
  const id = c.req.param("id");
  const db = c.env.DB;
  const admin = c.get("user")!;
  const now = new Date().toISOString();
  const d = parsed.data;

  const current = await db.prepare(
    `SELECT name, email, role, permissions, is_active, is_event_owner, is_programme_officer
     FROM users WHERE id = ?`
  ).bind(id)
    .first<{
      name: string;
      email: string;
      role: string | null;
      permissions: string | null;
      is_active: number;
      is_event_owner: number;
      is_programme_officer: number;
    }>();
  if (!current) return c.json({ error: "User not found" }, 404);

  const nextEmail = d.email ? d.email.toLowerCase() : current.email;
  const nextName = d.name ? d.name.trim() : current.name;
  const nextPermissions = d.permissions ? normalisePermissions(d.permissions) : null;
  const nextEventOwner = d.is_event_owner !== undefined ? (d.is_event_owner ? 1 : 0) : current.is_event_owner;
  const nextProgrammeOfficer = d.is_programme_officer !== undefined
    ? (d.is_programme_officer ? 1 : 0)
    : current.is_programme_officer;

  // Lock-out guard: never let the last active user.manage holder lose it.
  if (nextPermissions && !nextPermissions.includes("user.manage") && current.is_active === 1) {
    const held = permissionsFromRow(current.permissions, current.role).includes("user.manage");
    if (held && (await otherGatekeepers(db, id)) === 0) {
      return c.json({ error: "At least one active account must keep the Manage team accounts permission." }, 422);
    }
  }

  if (d.email) {
    const clash = await db.prepare("SELECT id FROM users WHERE email = ? AND id != ?").bind(nextEmail, id).first();
    if (clash) return c.json({ error: "That email is already in use" }, 409);
  }

  if (nextEventOwner === 1 && nextName.toLowerCase() !== current.name.toLowerCase()) {
    const dupOption = await db.prepare(
      "SELECT id FROM dropdown_options WHERE list_key = 'handled_by' AND LOWER(value) = LOWER(?) AND LOWER(value) != LOWER(?)"
    ).bind(nextName, current.name).first();
    if (dupOption) return c.json({ error: "An event owner with that name already exists" }, 409);
  }

  const nextContact = d.contact_number !== undefined ? (d.contact_number?.trim() || null) : undefined;

  const setClauses = [
    "name = ?",
    "email = ?",
    "permissions = COALESCE(?, permissions)",
    "organisation = COALESCE(?, organisation)",
    "is_event_owner = ?",
    "is_programme_officer = ?",
    "updated_at = ?",
  ];
  const binds: unknown[] = [
    nextName,
    nextEmail,
    nextPermissions ? JSON.stringify(nextPermissions) : null,
    d.organisation ?? null,
    nextEventOwner,
    nextProgrammeOfficer,
    now,
  ];
  if (nextContact !== undefined) {
    setClauses.push("contact_number = ?");
    binds.push(nextContact);
  }
  binds.push(id);
  await db.prepare(`UPDATE users SET ${setClauses.join(", ")} WHERE id = ?`).bind(...binds).run();

  const ownerDesignationChanged = d.is_event_owner !== undefined && nextEventOwner !== current.is_event_owner;
  const nameChanged = Boolean(d.name) && nextName.toLowerCase() !== current.name.toLowerCase();
  if (ownerDesignationChanged || nameChanged || nextEventOwner === 1) {
    await syncHandledByOption(db, {
      name: nextName,
      previousName: current.name,
      enabled: nextEventOwner === 1 && current.is_active === 1,
      now,
    });
  }

  await audit({
    db, actor: actorFrom(admin), action: "user.updated", targetType: "user", targetId: id,
    detail: {
      name: nextName,
      email: nextEmail,
      permissions: nextPermissions ?? undefined,
      is_event_owner: nextEventOwner === 1,
      is_programme_officer: nextProgrammeOfficer === 1,
    },
    ipHint: ipHint(c.req.raw),
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

  const target = await db.prepare(
    "SELECT id, name, role, permissions, is_event_owner FROM users WHERE id = ?"
  ).bind(id)
    .first<{ id: string; name: string; role: string | null; permissions: string | null; is_event_owner: number }>();
  if (!target) return c.json({ error: "User not found" }, 404);

  // Refuse to let the admin deactivate themselves (would lock the workspace out).
  if (!active && target.id === admin.id) {
    return c.json({ error: "You cannot deactivate your own account" }, 422);
  }
  // Lock-out guard: never deactivate the last active user.manage holder.
  if (!active && permissionsFromRow(target.permissions, target.role).includes("user.manage")
      && (await otherGatekeepers(db, target.id)) === 0) {
    return c.json({ error: "This is the only active account that can manage team accounts — grant that permission to someone else first." }, 422);
  }

  await db.prepare("UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?").bind(active ? 1 : 0, now, target.id).run();

  // Only event owners participate in the handled_by list.
  if (Number(target.is_event_owner) === 1) {
    await syncHandledByOption(db, {
      name: target.name,
      enabled: active,
      now,
    });
  }

  if (!active) await revokeAllSessions(db, target.id);

  await audit({
    db, actor: actorFrom(admin), action: active ? "user.activated" : "user.deactivated",
    targetType: "user", targetId: target.id, ipHint: ipHint(c.req.raw),
  });
  return c.json({ ok: true });
}
