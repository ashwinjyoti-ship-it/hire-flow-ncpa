/**
 * Server-side session management. Sessions are opaque tokens stored in D1,
 * served via httpOnly + Secure + SameSite=Lax cookies. CSRF token paired per session.
 */
import type { UserRole } from "../env";
import { makeId, randomToken, timingSafeEqual } from "./id";

export const SESSION_COOKIE = "ncpa_session";
export const SESSION_MAX_AGE_DAYS = 7;

interface SessionRow {
  id: string;
  user_id: string;
  csrf_token: string;
  expires_at: string;
}

/** Create a new session for a user; returns the cookie value + CSRF token. */
export async function createSession(
  db: D1Database,
  userId: string
): Promise<{ cookieValue: string; csrfToken: string; expiresAt: string }> {
  const sessionId = makeId("sess");
  const csrfToken = randomToken(24);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_DAYS * 86400_000);
  await db
    .prepare(
      "INSERT INTO sessions (id, user_id, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)"
    )
    .bind(sessionId, userId, csrfToken, now.toISOString(), expiresAt.toISOString())
    .run();
  return { cookieValue: sessionId, csrfToken, expiresAt: expiresAt.toISOString() };
}

/** Resolve a session from a raw cookie value; returns the user record. */
export async function resolveSession(
  db: D1Database,
  sessionId: string
): Promise<{ userId: string; role: UserRole; email: string; name: string; csrfToken: string } | null> {
  const row = await db
    .prepare(
      `SELECT s.id, s.user_id, s.csrf_token, s.expires_at, s.revoked_at,
              u.email, u.name, u.role, u.is_active
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ?`
    )
    .bind(sessionId)
    .first<SessionRow & { email: string; name: string; role: UserRole; is_active: number; revoked_at: string | null }>();
  if (!row) return null;
  if (row.revoked_at) return null;
  if (row.is_active !== 1) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return {
    userId: row.user_id,
    role: row.role,
    email: row.email,
    name: row.name,
    csrfToken: row.csrf_token,
  };
}

/** Revoke a session (logout). */
export async function revokeSession(db: D1Database, sessionId: string): Promise<void> {
  await db
    .prepare("UPDATE sessions SET revoked_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), sessionId)
    .run();
}

/**
 * Revoke all of a user's active sessions (password change/reset hygiene).
 * Pass `exceptSessionId` to keep the session making the request alive.
 */
export async function revokeAllSessions(
  db: D1Database,
  userId: string,
  exceptSessionId?: string
): Promise<void> {
  const now = new Date().toISOString();
  if (exceptSessionId) {
    await db
      .prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id != ? AND revoked_at IS NULL")
      .bind(now, userId, exceptSessionId)
      .run();
  } else {
    await db
      .prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL")
      .bind(now, userId)
      .run();
  }
}

/** Parse the session cookie from a Cookie header. */
export function readSessionCookie(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [k, v] = part.trim().split("=");
    if (k === SESSION_COOKIE && v) return v;
  }
  return null;
}

/** Build the Set-Cookie header for a session. */
export function sessionCookieHeader(
  value: string,
  maxAgeSeconds: number,
  secure = true
): string {
  const flags = [
    `${SESSION_COOKIE}=${value}`,
    "Path=/",
    `Max-Age=${maxAgeSeconds}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (secure) flags.push("Secure");
  return flags.join("; ");
}

/** Build an expiry (clear) cookie header. */
export function clearSessionCookieHeader(secure = true): string {
  const flags = [`${SESSION_COOKIE}=`, "Path=/", "Max-Age=0", "HttpOnly", "SameSite=Lax"];
  if (secure) flags.push("Secure");
  return flags.join("; ");
}

/** Verify a CSRF token against the session's token (constant-time). */
export function verifyCsrf(expected: string, provided: string): boolean {
  return timingSafeEqual(expected, provided);
}
