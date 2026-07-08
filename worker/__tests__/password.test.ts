import { describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { SESSION_COOKIE } from "../lib/sessions";
import { hashPassword, verifyPassword, sha256Hex } from "../lib/crypto";
import type { Env } from "../env";

interface FakeUser {
  id: string;
  email: string;
  name: string;
  role: string;
  password_hash: string;
  totp_secret: string | null;
  is_active: number;
  must_change_password: number;
  password_updated_at?: string | null;
}

interface FakeSession {
  id: string;
  user_id: string;
  csrf_token: string;
  expires_at: string;
  revoked_at: string | null;
}

interface FakeResetToken {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

function makeStore() {
  return {
    users: new Map<string, FakeUser>(),
    sessions: new Map<string, FakeSession>(),
    resetTokens: [] as FakeResetToken[],
  };
}

function fakeDb(store: ReturnType<typeof makeStore>): D1Database {
  const { users, sessions, resetTokens } = store;
  const byEmail = (email: string) => [...users.values()].find((u) => u.email === email) ?? null;

  return {
    prepare(sql: string) {
      let args: unknown[] = [];
      return {
        bind(...a: unknown[]) {
          args = a;
          return this;
        },
        async first<T = unknown>(): Promise<T | null> {
          if (sql.includes("FROM sessions s JOIN users u")) {
            const s = sessions.get(args[0] as string);
            if (!s) return null;
            const u = users.get(s.user_id);
            if (!u) return null;
            return {
              id: s.id, user_id: s.user_id, csrf_token: s.csrf_token,
              expires_at: s.expires_at, revoked_at: s.revoked_at,
              email: u.email, name: u.name, role: u.role, is_active: u.is_active,
            } as T;
          }
          if (sql.includes("FROM users WHERE email = ?") && sql.includes("must_change_password")) {
            const u = byEmail(args[0] as string);
            return (u ? { ...u } : null) as T | null;
          }
          if (sql.includes("SELECT id, email, name, is_active FROM users WHERE email = ?")) {
            const u = byEmail(args[0] as string);
            return (u ? { id: u.id, email: u.email, name: u.name, is_active: u.is_active } : null) as T | null;
          }
          if (sql.includes("SELECT password_hash FROM users WHERE id = ?")) {
            const u = users.get(args[0] as string);
            return (u ? { password_hash: u.password_hash } : null) as T | null;
          }
          if (sql.includes("SELECT created_at FROM password_reset_tokens WHERE user_id")) {
            const rows = resetTokens
              .filter((t) => t.user_id === args[0])
              .sort((a, b) => b.created_at.localeCompare(a.created_at));
            return (rows[0] ? { created_at: rows[0].created_at } : null) as T | null;
          }
          if (sql.includes("SELECT id, user_id, expires_at, used_at FROM password_reset_tokens WHERE token_hash")) {
            const row = resetTokens.find((t) => t.token_hash === args[0]);
            return (row ? { ...row } : null) as T | null;
          }
          if (sql.includes("FROM app_settings")) return null;
          return null;
        },
        async all() {
          return { results: [] };
        },
        async run() {
          if (sql.startsWith("UPDATE users SET password_hash")) {
            const [hash, updatedAt, id] = args as [string, string, string];
            const u = users.get(id);
            if (u) {
              u.password_hash = hash;
              u.password_updated_at = updatedAt;
              u.must_change_password = sql.includes("must_change_password = 1") ? 1 : 0;
            }
          } else if (sql.startsWith("INSERT INTO password_reset_tokens")) {
            const [id, user_id, token_hash, expires_at, created_at] = args as [string, string, string, string, string];
            resetTokens.push({ id, user_id, token_hash, expires_at, used_at: null, created_at });
          } else if (sql.startsWith("UPDATE password_reset_tokens SET used_at")) {
            const [used_at, id] = args as [string, string];
            const row = resetTokens.find((t) => t.id === id);
            if (row) row.used_at = used_at;
          }
          return { success: true };
        },
      };
    },
  } as unknown as D1Database;
}

const TEST_ENV = { APP_URL: "https://test.example", MAIL_FROM: "test@example.com" } as Env;

function seedUser(store: ReturnType<typeof makeStore>, over: Partial<FakeUser>): FakeUser {
  const user: FakeUser = {
    id: "user_1", email: "person@example.com", name: "Person", role: "coordinator",
    password_hash: hashPassword("OldPassword123"), totp_secret: null, is_active: 1,
    must_change_password: 0, ...over,
  };
  store.users.set(user.id, user);
  return user;
}

function seedSession(store: ReturnType<typeof makeStore>, userId: string, sessionId = "sess_1"): void {
  store.sessions.set(sessionId, {
    id: sessionId, user_id: userId, csrf_token: "csrf", expires_at: new Date(Date.now() + 60_000).toISOString(),
    revoked_at: null,
  });
}

describe("Password change", () => {
  it("rejects an incorrect current password", async () => {
    const store = makeStore();
    const user = seedUser(store, {});
    seedSession(store, user.id);
    const db = fakeDb(store);
    const app = buildApp({ ...TEST_ENV, DB: db } as never);

    const res = await app.request(
      "/auth/password/change",
      { method: "POST", headers: { "Content-Type": "application/json", Cookie: `${SESSION_COOKIE}=sess_1` }, body: JSON.stringify({ currentPassword: "wrong", newPassword: "NewPassword123" }) },
      { ...TEST_ENV, DB: db } as never
    );
    expect(res.status).toBe(401);
    expect(verifyPassword("OldPassword123", user.password_hash)).toBe(true);
  });

  it("updates the password hash and clears must_change_password on success", async () => {
    const store = makeStore();
    const user = seedUser(store, { must_change_password: 1 });
    seedSession(store, user.id);
    const db = fakeDb(store);
    const app = buildApp({ ...TEST_ENV, DB: db } as never);

    const res = await app.request(
      "/auth/password/change",
      { method: "POST", headers: { "Content-Type": "application/json", Cookie: `${SESSION_COOKIE}=sess_1` }, body: JSON.stringify({ currentPassword: "OldPassword123", newPassword: "BrandNewPassword1" }) },
      { ...TEST_ENV, DB: db } as never
    );
    expect(res.status).toBe(200);
    expect(verifyPassword("BrandNewPassword1", user.password_hash)).toBe(true);
    expect(user.must_change_password).toBe(0);
  });

  it("rejects a new password shorter than the minimum length", async () => {
    const store = makeStore();
    const user = seedUser(store, {});
    seedSession(store, user.id);
    const db = fakeDb(store);
    const app = buildApp({ ...TEST_ENV, DB: db } as never);

    const res = await app.request(
      "/auth/password/change",
      { method: "POST", headers: { "Content-Type": "application/json", Cookie: `${SESSION_COOKIE}=sess_1` }, body: JSON.stringify({ currentPassword: "OldPassword123", newPassword: "short" }) },
      { ...TEST_ENV, DB: db } as never
    );
    expect(res.status).toBe(400);
  });
});

describe("Forgot / reset password", () => {
  it("always returns ok without revealing whether the email exists", async () => {
    const store = makeStore();
    const db = fakeDb(store);
    const app = buildApp({ ...TEST_ENV, DB: db } as never);

    const res = await app.request(
      "/auth/password/forgot",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "nobody@example.com" }) },
      { ...TEST_ENV, DB: db } as never
    );
    expect(res.status).toBe(200);
    expect(store.resetTokens.length).toBe(0);
  });

  it("issues a token for a known active user and throttles rapid repeats", async () => {
    const store = makeStore();
    const user = seedUser(store, {});
    const db = fakeDb(store);
    const app = buildApp({ ...TEST_ENV, DB: db } as never);

    await app.request(
      "/auth/password/forgot",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: user.email }) },
      { ...TEST_ENV, DB: db } as never
    );
    expect(store.resetTokens.length).toBe(1);

    // Immediate repeat should be throttled — no second token issued.
    await app.request(
      "/auth/password/forgot",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: user.email }) },
      { ...TEST_ENV, DB: db } as never
    );
    expect(store.resetTokens.length).toBe(1);
  });

  it("resets the password with a valid token and single-uses it", async () => {
    const store = makeStore();
    const user = seedUser(store, {});
    const db = fakeDb(store);
    const app = buildApp({ ...TEST_ENV, DB: db } as never);

    const rawToken = "known-raw-token";
    store.resetTokens.push({
      id: "prt_1", user_id: user.id, token_hash: await sha256Hex(rawToken),
      expires_at: new Date(Date.now() + 60_000).toISOString(), used_at: null,
      created_at: new Date().toISOString(),
    });

    const res = await app.request(
      "/auth/password/reset",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: rawToken, newPassword: "ResetPassword1" }) },
      { ...TEST_ENV, DB: db } as never
    );
    expect(res.status).toBe(200);
    expect(verifyPassword("ResetPassword1", user.password_hash)).toBe(true);

    // Reusing the same token must fail.
    const second = await app.request(
      "/auth/password/reset",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: rawToken, newPassword: "AnotherPassword1" }) },
      { ...TEST_ENV, DB: db } as never
    );
    expect(second.status).toBe(400);
  });

  it("rejects an expired token", async () => {
    const store = makeStore();
    const user = seedUser(store, {});
    const db = fakeDb(store);
    const app = buildApp({ ...TEST_ENV, DB: db } as never);

    const rawToken = "expired-token";
    store.resetTokens.push({
      id: "prt_2", user_id: user.id, token_hash: await sha256Hex(rawToken),
      expires_at: new Date(Date.now() - 1000).toISOString(), used_at: null,
      created_at: new Date(Date.now() - 60_000).toISOString(),
    });

    const res = await app.request(
      "/auth/password/reset",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: rawToken, newPassword: "ResetPassword1" }) },
      { ...TEST_ENV, DB: db } as never
    );
    expect(res.status).toBe(400);
  });
});

describe("Admin-forced password reset", () => {
  it("lets an Admin issue a temporary password for another user", async () => {
    const store = makeStore();
    const admin = seedUser(store, { id: "user_admin", email: "admin@example.com", role: "admin" });
    const target = seedUser(store, { id: "user_target", email: "target@example.com" });
    seedSession(store, admin.id, "sess_admin");
    const db = fakeDb(store);
    const app = buildApp({ ...TEST_ENV, DB: db } as never);

    const res = await app.request(
      "/auth/password/admin-reset",
      { method: "POST", headers: { "Content-Type": "application/json", Cookie: `${SESSION_COOKIE}=sess_admin` }, body: JSON.stringify({ email: target.email }) },
      { ...TEST_ENV, DB: db } as never
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { temporaryPassword: string };
    expect(verifyPassword(body.temporaryPassword, target.password_hash)).toBe(true);
    expect(target.must_change_password).toBe(1);
  });

  it("forbids a non-admin from resetting another user's password", async () => {
    const store = makeStore();
    const coordinator = seedUser(store, { id: "user_coord", email: "coord@example.com", role: "coordinator" });
    const target = seedUser(store, { id: "user_target", email: "target@example.com" });
    seedSession(store, coordinator.id, "sess_coord");
    const db = fakeDb(store);
    const app = buildApp({ ...TEST_ENV, DB: db } as never);

    const res = await app.request(
      "/auth/password/admin-reset",
      { method: "POST", headers: { "Content-Type": "application/json", Cookie: `${SESSION_COOKIE}=sess_coord` }, body: JSON.stringify({ email: target.email }) },
      { ...TEST_ENV, DB: db } as never
    );
    expect(res.status).toBe(403);
  });
});
