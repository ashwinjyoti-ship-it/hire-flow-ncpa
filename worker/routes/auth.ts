/**
 * Auth API routes:
 *   POST /auth/login           — email + password (returns mfaRequired if TOTP enrolled)
 *   POST /auth/mfa             — TOTP or recovery-code challenge
 *   POST /auth/logout          — revoke session
 *   GET  /auth/me              — current user
 *   POST /auth/mfa/setup       — begin TOTP enrolment (returns secret + uri)
 *   POST /auth/mfa/confirm     — confirm enrolment with a valid token
 *   POST /auth/mfa/disable     — disable MFA (requires password)
 *   POST /auth/recovery/regenerate — generate new recovery codes (requires password)
 *
 * All authenticated routes set/receive the httpOnly session cookie.
 */
import { Hono } from "hono";
import { z } from "zod";
import type { AuthEnv } from "../middleware/auth";
import { actorFrom, ipHint, requireUser } from "../middleware/auth";
import { hashPassword, verifyPassword, generateTotpSecret, verifyTotp, totpUri, generateRecoveryCodes, hashRecoveryCode, verifyRecoveryCode } from "../lib/crypto";
import { createSession, revokeSession, readSessionCookie, sessionCookieHeader, clearSessionCookieHeader, SESSION_MAX_AGE_DAYS } from "../lib/sessions";
import { recordFailedLogin, recordSuccessfulLogin, isLocked } from "../lib/rate-limit";
import { audit } from "../lib/audit";
import { makeId } from "../lib/id";

export const authRoutes = new Hono<AuthEnv>();

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const MfaSchema = z.object({
  sessionId: z.string().min(1),
  code: z.string().min(1),
  /** If true, `code` is a recovery code instead of a TOTP token. */
  useRecovery: z.boolean().optional(),
});

// POST /login
authRoutes.post("/login", async (c) => {
  const parsed = LoginSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: "Invalid email or password" }, 400);
  }
  const { email, password } = parsed.data;
  const db = c.env.DB;

  const user = await db
    .prepare("SELECT id, email, name, role, password_hash, totp_secret, is_active FROM users WHERE email = ?")
    .bind(email.toLowerCase())
    .first<{ id: string; email: string; name: string; role: string; password_hash: string; totp_secret: string | null; is_active: number }>();

  if (!user || user.is_active !== 1) {
    // Don't reveal whether the email exists.
    return c.json({ error: "Invalid email or password" }, 401);
  }

  if (await isLocked(db, user.id)) {
    return c.json({ error: "Account temporarily locked. Try again later." }, 429);
  }

  if (!verifyPassword(password, user.password_hash)) {
    await recordFailedLogin(db, user.id);
    await audit({
      db, actor: { id: user.id, email: user.email },
      action: "auth.login_failed", targetType: "user", targetId: user.id, ipHint: ipHint(c.req.raw),
    });
    return c.json({ error: "Invalid email or password" }, 401);
  }

  // Password correct. If MFA enrolled, issue a pending session and require TOTP.
  const session = await createSession(db, user.id);
  if (user.totp_secret) {
    // Return a short-lived challenge; the session is not yet "fully authenticated".
    // We mark it pending by returning mfaRequired. The cookie is set so /mfa can complete.
    c.header("Set-Cookie", sessionCookieHeader(session.cookieValue, 10 * 60, c.req.url.startsWith("https")));
    return c.json({
      mfaRequired: true,
      sessionId: session.cookieValue,
    });
  }

  // No MFA — fully authenticated.
  await recordSuccessfulLogin(db, user.id);
  c.header("Set-Cookie", sessionCookieHeader(session.cookieValue, SESSION_MAX_AGE_DAYS * 86400, c.req.url.startsWith("https")));
  await audit({
    db, actor: { id: user.id, email: user.email },
    action: "auth.login", targetType: "user", targetId: user.id, ipHint: ipHint(c.req.raw),
  });
  return c.json({
    user: { id: user.id, email: user.email, name: user.name, role: user.role, organisation: null },
    csrfToken: session.csrfToken,
  });
});

// POST /mfa — complete the TOTP / recovery-code challenge.
authRoutes.post("/mfa", async (c) => {
  const parsed = MfaSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: "Invalid request" }, 400);
  }
  const { sessionId, code, useRecovery } = parsed.data;
  const db = c.env.DB;

  const session = await db
    .prepare(
      `SELECT s.user_id, s.expires_at, s.revoked_at, u.totp_secret, u.recovery_codes, u.email, u.name, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`
    )
    .bind(sessionId)
    .first<{ user_id: string; expires_at: string; revoked_at: string | null; totp_secret: string | null; recovery_codes: string | null; email: string; name: string; role: string }>();

  if (!session || session.revoked_at || new Date(session.expires_at).getTime() < Date.now()) {
    return c.json({ error: "Session expired" }, 401);
  }

  let verified = false;
  if (useRecovery) {
    const hashes = session.recovery_codes ? (JSON.parse(session.recovery_codes) as string[]) : [];
    const idx = verifyRecoveryCode(code, hashes);
    if (idx >= 0) {
      // Consume the used recovery code.
      hashes.splice(idx, 1);
      await db.prepare("UPDATE users SET recovery_codes = ? WHERE id = ?")
        .bind(JSON.stringify(hashes), session.user_id)
        .run();
      verified = true;
    }
  } else if (session.totp_secret) {
    verified = verifyTotp(session.totp_secret, code);
  }

  if (!verified) {
    await audit({
      db, actor: { id: session.user_id, email: session.email },
      action: "auth.mfa_failed", targetType: "user", targetId: session.user_id, ipHint: ipHint(c.req.raw),
    });
    return c.json({ error: "Invalid code" }, 401);
  }

  await recordSuccessfulLogin(db, session.user_id);
  // Promote the short-lived session to a full one.
  const expires = new Date(Date.now() + SESSION_MAX_AGE_DAYS * 86400_000).toISOString();
  await db.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").bind(expires, sessionId).run();
  c.header("Set-Cookie", sessionCookieHeader(sessionId, SESSION_MAX_AGE_DAYS * 86400, c.req.url.startsWith("https")));

  await audit({
    db, actor: { id: session.user_id, email: session.email },
    action: "auth.login", detail: { mfa: true }, targetType: "user", targetId: session.user_id, ipHint: ipHint(c.req.raw),
  });
  return c.json({
    user: { id: session.user_id, email: session.email, name: session.name, role: session.role, organisation: null },
  });
});

// POST /logout
authRoutes.post("/logout", async (c) => {
  const cookie = readSessionCookie(c.req.header("cookie"));
  if (cookie) {
    await revokeSession(c.env.DB, cookie);
  }
  c.header("Set-Cookie", clearSessionCookieHeader(c.req.url.startsWith("https")));
  return c.json({ ok: true });
});

// GET /me
authRoutes.get("/me", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ user: null });
  return c.json({ user });
});

// GET /mfa/status — whether the current user has MFA enrolled (for the Profile UI).
authRoutes.get("/mfa/status", requireUser, async (c) => {
  const user = c.get("user")!;
  const row = await c.env.DB.prepare("SELECT totp_secret, recovery_codes FROM users WHERE id = ?")
    .bind(user.id)
    .first<{ totp_secret: string | null; recovery_codes: string | null }>();
  const hashes = row?.recovery_codes ? (JSON.parse(row.recovery_codes) as string[]) : [];
  return c.json({
    enrolled: Boolean(row?.totp_secret),
    recoveryCodesRemaining: hashes.length,
  });
});

// POST /mfa/setup — begin enrolment (requires auth). Returns secret + otpauth URI.
const SetupSchema = z.object({ password: z.string().min(1) });
authRoutes.post("/mfa/setup", requireUser, async (c) => {
  const parsed = SetupSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Password required" }, 400);
  const user = c.get("user")!;
  const db = c.env.DB;

  const row = await db.prepare("SELECT password_hash FROM users WHERE id = ?").bind(user.id)
    .first<{ password_hash: string }>();
  if (!row || !verifyPassword(parsed.data.password, row.password_hash)) {
    return c.json({ error: "Password incorrect" }, 401);
  }

  const secret = generateTotpSecret();
  const uri = totpUri(secret, user.email);
  // Store the pending secret in a short-lived app_settings key until confirmed.
  await db.prepare(
    "INSERT OR REPLACE INTO app_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)"
  ).bind(`totp_pending:${user.id}`, JSON.stringify({ secret, createdAt: Date.now() }), new Date().toISOString(), user.id).run();

  return c.json({ secret, uri });
});

const ConfirmSchema = z.object({ code: z.string().min(6).max(6) });
authRoutes.post("/mfa/confirm", requireUser, async (c) => {
  const parsed = ConfirmSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Invalid code" }, 400);
  const user = c.get("user")!;
  const db = c.env.DB;

  const pending = await db.prepare("SELECT value FROM app_settings WHERE key = ?")
    .bind(`totp_pending:${user.id}`).first<{ value: string }>();
  if (!pending) return c.json({ error: "No pending enrolment" }, 400);
  const { secret } = JSON.parse(pending.value) as { secret: string };

  if (!verifyTotp(secret, parsed.data.code)) {
    return c.json({ error: "Invalid code" }, 401);
  }

  // Generate recovery codes (plaintext returned ONCE; hashes stored).
  const recoveryCodes = generateRecoveryCodes(10);
  const hashed = recoveryCodes.map(hashRecoveryCode);

  await db.prepare(
    "UPDATE users SET totp_secret = ?, totp_enrolled_at = ?, recovery_codes = ? WHERE id = ?"
  ).bind(secret, new Date().toISOString(), JSON.stringify(hashed), user.id).run();
  await db.prepare("DELETE FROM app_settings WHERE key = ?").bind(`totp_pending:${user.id}`).run();

  await audit({
    db, actor: actorFrom(user), action: "auth.mfa_enabled", targetType: "user", targetId: user.id,
  });
  return c.json({ recoveryCodes });
});

const DisableSchema = z.object({ password: z.string().min(1), reason: z.string().min(1) });
authRoutes.post("/mfa/disable", requireUser, async (c) => {
  const parsed = DisableSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Password and reason required" }, 400);
  const user = c.get("user")!;
  const db = c.env.DB;

  const row = await db.prepare("SELECT password_hash FROM users WHERE id = ?").bind(user.id)
    .first<{ password_hash: string }>();
  if (!row || !verifyPassword(parsed.data.password, row.password_hash)) {
    return c.json({ error: "Password incorrect" }, 401);
  }

  await db.prepare(
    "UPDATE users SET totp_secret = NULL, totp_enrolled_at = NULL, recovery_codes = NULL WHERE id = ?"
  ).bind(user.id).run();
  await audit({
    db, actor: actorFrom(user), action: "auth.mfa_disabled",
    targetType: "user", targetId: user.id, detail: { reason: parsed.data.reason },
  });
  return c.json({ ok: true });
});

const RegenSchema = z.object({ password: z.string().min(1) });
authRoutes.post("/recovery/regenerate", requireUser, async (c) => {
  const parsed = RegenSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Password required" }, 400);
  const user = c.get("user")!;
  const db = c.env.DB;

  const row = await db.prepare("SELECT password_hash FROM users WHERE id = ?").bind(user.id)
    .first<{ password_hash: string }>();
  if (!row || !verifyPassword(parsed.data.password, row.password_hash)) {
    return c.json({ error: "Password incorrect" }, 401);
  }

  const recoveryCodes = generateRecoveryCodes(10);
  const hashed = recoveryCodes.map(hashRecoveryCode);
  await db.prepare("UPDATE users SET recovery_codes = ? WHERE id = ?")
    .bind(JSON.stringify(hashed), user.id).run();
  await audit({
    db, actor: actorFrom(user), action: "auth.recovery_regenerated", targetType: "user", targetId: user.id,
  });
  return c.json({ recoveryCodes });
});

/** Internal helper exported for bootstrap: create a user with a hashed password. */
export async function createUser(
  db: D1Database,
  input: { email: string; name: string; role: string; password: string; organisation?: string | null }
): Promise<{ id: string }> {
  const id = makeId("user");
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO users (id, email, name, role, organisation, password_hash, password_algo, password_updated_at, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'scrypt', ?, 1, ?, ?)`
  ).bind(
    id, input.email.toLowerCase(), input.name, input.role, input.organisation ?? null,
    hashPassword(input.password), now, now, now
  ).run();
  return { id };
}
