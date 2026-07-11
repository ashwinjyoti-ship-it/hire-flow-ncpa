import { describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { SESSION_COOKIE } from "../lib/sessions";

type QueryHandler = {
  first?: () => unknown;
  all?: () => unknown;
  run?: () => unknown;
};

function fakeDb(handlerFor: (sql: string) => QueryHandler): D1Database {
  return {
    prepare(sql: string) {
      const handler = handlerFor(sql);
      return {
        bind() {
          return this;
        },
        async first() {
          return handler.first?.() ?? null;
        },
        async all() {
          return handler.all?.() ?? { results: [] };
        },
        async run() {
          return handler.run?.() ?? { success: true };
        },
      };
    },
  } as unknown as D1Database;
}

// Admin session — has user.manage via the admin role.
function adminSession() {
  return {
    id: "sess_admin",
    user_id: "user_admin",
    csrf_token: "csrf",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    revoked_at: null,
    email: "admin@example.com",
    name: "Admin",
    role: "admin",
    is_active: 1,
  };
}

// Viewer session — lacks user.manage, so all /users routes should 403.
function viewerSession() {
  return {
    ...adminSession(),
    id: "sess_viewer",
    user_id: "user_viewer",
    email: "viewer@example.com",
    name: "Viewer",
    role: "viewer",
  };
}

describe("User management (Phase 8a)", () => {
  it("creates a user + handled_by option and returns a one-time temporary password", async () => {
    const inserts: { table: string; binds: unknown[] }[] = [];
    const db = fakeDb((sql) => {
      const up = sql.toUpperCase();
      if (sql.includes("FROM sessions")) return { first: adminSession };
      if (up.startsWith("SELECT ID FROM USERS WHERE EMAIL")) return { first: () => null };
      if (up.includes("FROM DROPDOWN_OPTIONS") && up.includes("LOWER(VALUE)")) return { first: () => null };
      if (up.includes("FROM DROPDOWN_OPTIONS") && up.includes("MAX(SORT_ORDER)")) return { first: () => ({ next: 5 }) };
      if (up.startsWith("INSERT INTO USERS")) return { run: () => { inserts.push({ table: "users", binds: [] }); return { success: true }; } };
      if (up.startsWith("UPDATE USERS SET MUST_CHANGE_PASSWORD")) return { run: () => ({ success: true }) };
      if (up.startsWith("INSERT INTO DROPDOWN_OPTIONS")) return { run: () => { inserts.push({ table: "dropdown_options", binds: [] }); return { success: true }; } };
      if (up.startsWith("INSERT INTO AUDIT_LOGS")) return { run: () => ({ success: true }) };
      return {};
    });

    const app = buildApp({ DB: db } as never);
    const res = await app.request(
      "/users",
      {
        method: "POST",
        headers: { Cookie: `${SESSION_COOKIE}=sess_admin`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Priya Nair", email: "priya@example.com", role: "venue_manager" }),
      },
      { DB: db } as never
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; temporaryPassword: string };
    expect(body.id).toBeTruthy();
    expect(body.temporaryPassword).toBeTruthy();
    expect(body.temporaryPassword.length).toBeGreaterThanOrEqual(12);
    // Both a user and a dropdown option were inserted.
    expect(inserts.some((i) => i.table === "users")).toBe(true);
    expect(inserts.some((i) => i.table === "dropdown_options")).toBe(true);
  });

  it("rejects a duplicate email with 409 and creates nothing", async () => {
    let userInsert = false;
    const db = fakeDb((sql) => {
      const up = sql.toUpperCase();
      if (sql.includes("FROM sessions")) return { first: adminSession };
      if (up.startsWith("SELECT ID FROM USERS WHERE EMAIL")) return { first: () => ({ id: "existing" }) };
      if (up.startsWith("INSERT INTO USERS")) return { run: () => { userInsert = true; return { success: true }; } };
      return {};
    });

    const app = buildApp({ DB: db } as never);
    const res = await app.request(
      "/users",
      {
        method: "POST",
        headers: { Cookie: `${SESSION_COOKIE}=sess_admin`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Dup", email: "taken@example.com" }),
      },
      { DB: db } as never
    );

    expect(res.status).toBe(409);
    expect(userInsert).toBe(false);
  });

  it("deactivates both the user and the matching handled_by option", async () => {
    const runs: string[] = [];
    const db = fakeDb((sql) => {
      const up = sql.toUpperCase();
      if (sql.includes("FROM sessions")) return { first: adminSession };
      if (up.includes("SELECT ID, NAME, ROLE, PERMISSIONS FROM USERS")) {
        return { first: () => ({ id: "user_owner_farha", name: "Farha", role: null, permissions: '["event.view","checklist.update"]' }) };
      }
      if (up.startsWith("UPDATE USERS SET IS_ACTIVE")) return { run: () => { runs.push("users"); return { success: true }; } };
      if (up.startsWith("UPDATE DROPDOWN_OPTIONS SET IS_ACTIVE")) return { run: () => { runs.push("dropdown_options"); return { success: true }; } };
      if (up.includes("REVOK") || up.includes("SESSIONS")) return { run: () => ({ success: true }) };
      if (up.startsWith("INSERT INTO AUDIT_LOGS")) return { run: () => ({ success: true }) };
      return {};
    });

    const app = buildApp({ DB: db } as never);
    const res = await app.request(
      "/users/user_owner_farha/deactivate",
      { method: "POST", headers: { Cookie: `${SESSION_COOKIE}=sess_admin` } },
      { DB: db } as never
    );

    expect(res.status).toBe(200);
    expect(runs).toContain("users");
    expect(runs).toContain("dropdown_options");
  });

  it("refuses to let an admin deactivate their own account", async () => {
    const db = fakeDb((sql) => {
      if (sql.includes("FROM sessions")) return { first: adminSession };
      if (sql.toUpperCase().includes("SELECT ID, NAME, ROLE, PERMISSIONS FROM USERS")) {
        return { first: () => ({ id: "user_admin", name: "Admin", role: "admin", permissions: null }) };
      }
      return {};
    });

    const app = buildApp({ DB: db } as never);
    const res = await app.request(
      "/users/user_admin/deactivate",
      { method: "POST", headers: { Cookie: `${SESSION_COOKIE}=sess_admin` } },
      { DB: db } as never
    );

    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/own account/i);
  });

  it("refuses to deactivate the last active account-manager", async () => {
    const db = fakeDb((sql) => {
      const up = sql.toUpperCase();
      if (sql.includes("FROM sessions")) return { first: adminSession };
      if (up.includes("SELECT ID, NAME, ROLE, PERMISSIONS FROM USERS")) {
        return { first: () => ({ id: "user_other_admin", name: "Other Admin", role: null, permissions: '["user.manage","event.view"]' }) };
      }
      if (up.includes("COUNT(*)")) return { first: () => ({ c: 0 }) };
      return {};
    });

    const app = buildApp({ DB: db } as never);
    const res = await app.request(
      "/users/user_other_admin/deactivate",
      { method: "POST", headers: { Cookie: `${SESSION_COOKIE}=sess_admin` } },
      { DB: db } as never
    );

    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/manage team accounts/i);
  });

  it("refuses to strip user.manage from the last active holder", async () => {
    const db = fakeDb((sql) => {
      const up = sql.toUpperCase();
      if (sql.includes("FROM sessions")) return { first: adminSession };
      if (up.includes("SELECT NAME, EMAIL, ROLE, PERMISSIONS, IS_ACTIVE FROM USERS")) {
        return { first: () => ({ name: "Admin", email: "admin@example.com", role: null, permissions: '["user.manage","event.view"]', is_active: 1 }) };
      }
      if (up.includes("COUNT(*)")) return { first: () => ({ c: 0 }) };
      return {};
    });

    const app = buildApp({ DB: db } as never);
    const res = await app.request(
      "/users/user_admin",
      {
        method: "PUT",
        headers: { Cookie: `${SESSION_COOKIE}=sess_admin`, "Content-Type": "application/json" },
        body: JSON.stringify({ permissions: ["event.view", "report.view"] }),
      },
      { DB: db } as never
    );

    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/at least one active account/i);
  });

  it("updates a user's permission list when another manager remains", async () => {
    let savedPermissions: string | null = null;
    const db = fakeDb((sql) => {
      const up = sql.toUpperCase();
      if (sql.includes("FROM sessions")) return { first: adminSession };
      if (up.includes("SELECT NAME, EMAIL, ROLE, PERMISSIONS, IS_ACTIVE FROM USERS")) {
        return { first: () => ({ name: "Priya", email: "priya@example.com", role: null, permissions: '["user.manage"]', is_active: 1 }) };
      }
      if (up.includes("COUNT(*)")) return { first: () => ({ c: 1 }) };
      if (up.startsWith("UPDATE USERS SET NAME")) {
        return { run: () => { savedPermissions = '["event.view","report.view"]'; return { success: true }; } };
      }
      if (up.startsWith("INSERT INTO AUDIT_LOGS")) return { run: () => ({ success: true }) };
      return {};
    });

    const app = buildApp({ DB: db } as never);
    const res = await app.request(
      "/users/user_priya",
      {
        method: "PUT",
        headers: { Cookie: `${SESSION_COOKIE}=sess_admin`, "Content-Type": "application/json" },
        body: JSON.stringify({ permissions: ["event.view", "report.view"] }),
      },
      { DB: db } as never
    );

    expect(res.status).toBe(200);
    expect(savedPermissions).toBeTruthy();
  });

  it("blocks non-admins (403) from every /users route", async () => {
    const db = fakeDb((sql) => {
      if (sql.includes("FROM sessions")) return { first: viewerSession };
      return {};
    });

    const app = buildApp({ DB: db } as never);
    const res = await app.request(
      "/users",
      { headers: { Cookie: `${SESSION_COOKIE}=sess_viewer` } },
      { DB: db } as never
    );

    expect(res.status).toBe(403);
  });

  it("resets a password, flags must_change_password, and revokes sessions", async () => {
    let mustChangeSet = false;
    let sessionsRevoked = false;
    const db = fakeDb((sql) => {
      const up = sql.toUpperCase();
      if (sql.includes("FROM sessions")) return { first: adminSession };
      if (up.includes("SELECT ID, EMAIL, NAME, IS_ACTIVE FROM USERS")) {
        return { first: () => ({ id: "user_x", email: "x@e.com", name: "X", is_active: 1 }) };
      }
      if (up.startsWith("UPDATE USERS SET PASSWORD_HASH")) return { run: () => { mustChangeSet = true; return { success: true }; } };
      if (up.includes("REVOK") || up.includes("SESSIONS SET REVOKED")) return { run: () => { sessionsRevoked = true; return { success: true }; } };
      if (up.startsWith("INSERT INTO AUDIT_LOGS")) return { run: () => ({ success: true }) };
      return {};
    });

    const app = buildApp({ DB: db } as never);
    const res = await app.request(
      "/users/user_x/reset",
      { method: "POST", headers: { Cookie: `${SESSION_COOKIE}=sess_admin` } },
      { DB: db } as never
    );

    expect(res.status).toBe(200);
    expect(mustChangeSet).toBe(true);
    expect(sessionsRevoked).toBe(true);
    const body = (await res.json()) as { temporaryPassword: string };
    expect(body.temporaryPassword).toBeTruthy();
  });
});
