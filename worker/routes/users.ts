/**
 * User (account) management routes — Phase 8a identity layer.
 *   GET    /users                       — list accounts (user.manage; limited
 *                                         fields for event editors — Event Owner dropdown)
 *   POST   /users                       — create a login account
 *   PUT    /users/:id                   — edit name/email/permissions/designations
 *   POST   /users/:id/reset             — admin-forced password reset
 *   POST   /users/:id/deactivate        — soft-deactivate (user + handled_by option)
 *   POST   /users/:id/activate          — reactivate
 *
 * Design: access is per-user permissions, not roles. Event owners are logins
 * (is_event_owner). Programme officers are NOT logins — they live in the
 * program_officer dropdown list (name + contact). An event owner may also be
 * a programme officer: that requires a contact and syncs a program_officer row.
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

/**
 * Sync a linked program_officer row for an event-owner account that is also a PO.
 * Metadata carries contact_number + user_id so we only deactivate linked rows
 * (standalone PO list entries without user_id are left alone).
 */
async function syncProgrammeOfficerOption(
  db: D1Database,
  opts: {
    userId: string;
    name: string;
    previousName?: string | null;
    contact: string | null;
    enabled: boolean;
    now: string;
  },
): Promise<void> {
  const { userId, name, previousName, contact, enabled, now } = opts;
  const linked = await db.prepare(
    `SELECT id, value FROM dropdown_options
     WHERE list_key = 'program_officer' AND metadata LIKE ?`
  ).bind(`%"user_id":"${userId}"%`).first<{ id: string; value: string }>();

  if (!enabled) {
    if (linked) {
      await db.prepare(
        "UPDATE dropdown_options SET is_active = 0 WHERE id = ?"
      ).bind(linked.id).run();
    }
    return;
  }

  const metadata = JSON.stringify({ contact_number: contact, user_id: userId });

  if (linked) {
    await db.prepare(
      "UPDATE dropdown_options SET value = ?, metadata = ?, is_active = 1 WHERE id = ?"
    ).bind(name, metadata, linked.id).run();
    return;
  }

  // Prefer updating an existing standalone row with the same name (attach user_id).
  const byName = await db.prepare(
    "SELECT id FROM dropdown_options WHERE list_key = 'program_officer' AND LOWER(value) = LOWER(?)"
  ).bind(previousName ?? name).first<{ id: string }>();

  if (byName) {
    await db.prepare(
      "UPDATE dropdown_options SET value = ?, metadata = ?, is_active = 1 WHERE id = ?"
    ).bind(name, metadata, byName.id).run();
    return;
  }

  const byNewName = await db.prepare(
    "SELECT id FROM dropdown_options WHERE list_key = 'program_officer' AND LOWER(value) = LOWER(?)"
  ).bind(name).first<{ id: string }>();
  if (byNewName) {
    await db.prepare(
      "UPDATE dropdown_options SET metadata = ?, is_active = 1 WHERE id = ?"
    ).bind(metadata, byNewName.id).run();
    return;
  }

  const sortOrderRow = await db.prepare(
    "SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM dropdown_options WHERE list_key = 'program_officer'"
  ).first<{ next: number }>();
  const optionId = makeId("dd_po");
  await db.prepare(
    `INSERT INTO dropdown_options (id, list_key, value, sort_order, is_active, metadata, created_at)
     VALUES (?, 'program_officer', ?, ?, 1, ?, ?)`
  ).bind(optionId, name, sortOrderRow?.next ?? 1, metadata, now).run();
}

// ---- GET / — list accounts ----
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
      : `SELECT id, name, is_event_owner, is_active
         FROM users WHERE is_active = 1 ORDER BY name`
  ).all<Record<string, unknown>>();
  const users = (results ?? []).map((u) => {
    if (!fullAccess) {
      return {
        id: u.id,
        name: u.name,
        is_event_owner: Number(u.is_event_owner) === 1,
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

userRoutes.use("*", requirePermission("user.manage"));

const CreateBody = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  permissions: PermissionList.default([...LEGACY_ROLE_PERMISSIONS.venue_manager!]),
  organisation: z.string().nullish(),
  contact_number: z.string().max(50).nullish(),
  is_event_owner: z.boolean().optional(),
  /** Also appear as a programme officer (requires contact; syncs program_officer list). */
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
  const contact = contact_number?.trim() || null;

  if (asProgrammeOfficer && !contact) {
    return c.json({ error: "A contact number is required when this person is also a programme officer." }, 400);
  }

  const existing = await db.prepare("SELECT id FROM users WHERE email = ?").bind(email.toLowerCase()).first();
  if (existing) return c.json({ error: "A user with that email already exists" }, 409);

  if (asOwner) {
    const dupOption = await db.prepare(
      "SELECT id FROM dropdown_options WHERE list_key = 'handled_by' AND LOWER(value) = LOWER(?)"
    ).bind(trimmedName).first();
    if (dupOption) return c.json({ error: "An event owner with that name already exists" }, 409);
  }

  const temporaryPassword = generateTemporaryPassword();
  const userId = (await createUser(db, { email, name: trimmedName, permissions, password: temporaryPassword, organisation: organisation ?? null })).id;

  await db.prepare(
    `UPDATE users SET must_change_password = 1, contact_number = ?,
       is_event_owner = ?, is_programme_officer = ?, updated_at = ?
     WHERE id = ?`
  ).bind(
    contact,
    asOwner ? 1 : 0,
    asProgrammeOfficer ? 1 : 0,
    now,
    userId,
  ).run();

  if (asOwner) {
    await syncHandledByOption(db, { name: trimmedName, enabled: true, now });
  }
  if (asProgrammeOfficer) {
    await syncProgrammeOfficerOption(db, {
      userId, name: trimmedName, contact, enabled: true, now,
    });
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

  return c.json({ id: userId, email, name: trimmedName, permissions, temporaryPassword }, 201);
});

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
    `SELECT name, email, role, permissions, is_active, is_event_owner, is_programme_officer, contact_number
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
      contact_number: string | null;
    }>();
  if (!current) return c.json({ error: "User not found" }, 404);

  const nextEmail = d.email ? d.email.toLowerCase() : current.email;
  const nextName = d.name ? d.name.trim() : current.name;
  const nextPermissions = d.permissions ? normalisePermissions(d.permissions) : null;
  const nextEventOwner = d.is_event_owner !== undefined ? (d.is_event_owner ? 1 : 0) : current.is_event_owner;
  const nextProgrammeOfficer = d.is_programme_officer !== undefined
    ? (d.is_programme_officer ? 1 : 0)
    : current.is_programme_officer;
  const nextContact = d.contact_number !== undefined
    ? (d.contact_number?.trim() || null)
    : current.contact_number;

  if (nextProgrammeOfficer === 1 && !nextContact) {
    return c.json({ error: "A contact number is required when this person is also a programme officer." }, 400);
  }

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

  await db.prepare(
    `UPDATE users SET
       name = ?, email = ?,
       permissions = COALESCE(?, permissions),
       organisation = COALESCE(?, organisation),
       contact_number = ?,
       is_event_owner = ?,
       is_programme_officer = ?,
       updated_at = ?
     WHERE id = ?`
  ).bind(
    nextName,
    nextEmail,
    nextPermissions ? JSON.stringify(nextPermissions) : null,
    d.organisation ?? null,
    nextContact,
    nextEventOwner,
    nextProgrammeOfficer,
    now,
    id,
  ).run();

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

  const poChanged = d.is_programme_officer !== undefined
    || d.contact_number !== undefined
    || nameChanged;
  if (poChanged || nextProgrammeOfficer === 1) {
    await syncProgrammeOfficerOption(db, {
      userId: id,
      name: nextName,
      previousName: current.name,
      contact: nextContact,
      enabled: nextProgrammeOfficer === 1 && current.is_active === 1,
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
    "SELECT id, name, role, permissions, is_event_owner, is_programme_officer, contact_number FROM users WHERE id = ?"
  ).bind(id)
    .first<{
      id: string;
      name: string;
      role: string | null;
      permissions: string | null;
      is_event_owner: number;
      is_programme_officer: number;
      contact_number: string | null;
    }>();
  if (!target) return c.json({ error: "User not found" }, 404);

  if (!active && target.id === admin.id) {
    return c.json({ error: "You cannot deactivate your own account" }, 422);
  }
  if (!active && permissionsFromRow(target.permissions, target.role).includes("user.manage")
      && (await otherGatekeepers(db, target.id)) === 0) {
    return c.json({ error: "This is the only active account that can manage team accounts — grant that permission to someone else first." }, 422);
  }

  await db.prepare("UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?").bind(active ? 1 : 0, now, target.id).run();

  if (Number(target.is_event_owner) === 1) {
    await syncHandledByOption(db, {
      name: target.name,
      enabled: active,
      now,
    });
  }
  if (Number(target.is_programme_officer) === 1) {
    await syncProgrammeOfficerOption(db, {
      userId: target.id,
      name: target.name,
      contact: target.contact_number,
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
