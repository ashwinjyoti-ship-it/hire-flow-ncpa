/**
 * Hono middleware: auth context + permission guard.
 * Reads the session cookie, resolves the user, attaches to context variables.
 */
import { createMiddleware } from "hono/factory";
import type { Env, AuthUser } from "../env";
import { readSessionCookie, resolveSession } from "../lib/sessions";
import { can, type Permission } from "../lib/rbac";
import type { AuditActor } from "../lib/audit";

interface AuthVars {
  user: AuthUser | null;
  sessionId: string | null;
}

export type AuthEnv = {
  Bindings: Env;
  Variables: AuthVars;
};

/** Attach the authenticated user (or null) to context. Public routes use this. */
export const attachUser = createMiddleware<AuthEnv>(async (c, next) => {
  const cookie = readSessionCookie(c.req.header("cookie"));
  let user: AuthUser | null = null;
  if (cookie) {
    const session = await resolveSession(c.env.DB, cookie);
    if (session) {
      user = {
        id: session.userId,
        email: session.email,
        name: session.name,
        permissions: session.permissions,
        organisation: null,
      };
    }
  }
  c.set("user", user);
  c.set("sessionId", user ? cookie : null);
  await next();
});

/** Require an authenticated user. Returns 401 if absent. */
export const requireUser = createMiddleware<AuthEnv>(async (c, next) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }
  await next();
});

/** Require a specific permission. Use as: requirePermission("user.manage") */
export function requirePermission(permission: Permission) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ error: "Authentication required" }, 401);
    }
    if (!can(user.permissions, permission)) {
      return c.json({ error: "Insufficient permissions", permission }, 403);
    }
    await next();
  });
}

/** Helper: build an AuditActor from the current user. */
export function actorFrom(user: AuthUser | null): AuditActor {
  return { id: user?.id ?? null, email: user?.email ?? null };
}

/** Extract an IP hint (first octet only) for audit logs — never the full IP. */
export function ipHint(req: Request): string | undefined {
  const fwd = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for");
  if (!fwd) return undefined;
  return fwd.split(",")[0]?.split(".")[0] ?? undefined;
}
