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

function sessionRow() {
  return {
    id: "sess_test",
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

describe("API regressions", () => {
  it("lists organisations against the migrated schema", async () => {
    const db = fakeDb((sql) => {
      if (sql.includes("FROM sessions")) return { first: sessionRow };
      if (sql.includes("FROM organisations o")) {
        expect(sql).not.toContain("o.email");
        expect(sql).not.toContain("o.phone");
        return {
          all: () => ({
            results: [
              {
                id: "org_test",
                name: "Test Organisation",
                org_type: "corporate",
                is_archived: 0,
                event_count: 0,
                primary_contact: null,
              },
            ],
          }),
        };
      }
      return {};
    });

    const app = buildApp({ DB: db } as never);
    const res = await app.request(
      "/organisations",
      {
        headers: { Cookie: `${SESSION_COOKIE}=sess_test` },
      },
      { DB: db } as never
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      organisations: [{ id: "org_test", name: "Test Organisation" }],
    });
  });

  it("blocks confirming a VFH event before approval and signed confirmation are complete", async () => {
    let updatedStatus: string | null = null;
    const db = fakeDb((sql) => {
      if (sql.includes("FROM sessions")) return { first: sessionRow };
      if (sql.includes("FROM events WHERE id")) {
        return {
          first: () => ({
            status: "enquiry",
            event_type: "VFH",
            approval_status: "pending",
            confirmation_status: "none",
          }),
        };
      }
      if (sql.startsWith("UPDATE events SET status")) {
        return {
          run: () => {
            updatedStatus = "confirmed";
            return { success: true };
          },
        };
      }
      return {};
    });

    const app = buildApp({ DB: db } as never);
    const res = await app.request(
      "/events/ev_test/status",
      {
        method: "POST",
        headers: {
          Cookie: `${SESSION_COOKIE}=sess_test`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ to_status: "confirmed" }),
      },
      { DB: db } as never
    );

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining("Confirmation requires"),
    });
    expect(updatedStatus).toBeNull();
  });

  it("blocks marking a VFH event approved until approval is received", async () => {
    let updatedStatus: string | null = null;
    const db = fakeDb((sql) => {
      if (sql.includes("FROM sessions")) return { first: sessionRow };
      if (sql.includes("FROM events WHERE id")) {
        return {
          first: () => ({
            status: "tentative",
            event_type: "VFH",
            approval_status: "sent",
            confirmation_status: "none",
          }),
        };
      }
      if (sql.startsWith("UPDATE events SET status")) {
        return {
          run: () => {
            updatedStatus = "approved";
            return { success: true };
          },
        };
      }
      return {};
    });

    const app = buildApp({ DB: db } as never);
    const res = await app.request(
      "/events/ev_test/status",
      {
        method: "POST",
        headers: {
          Cookie: `${SESSION_COOKIE}=sess_test`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ to_status: "approved" }),
      },
      { DB: db } as never
    );

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining("approval must be received"),
    });
    expect(updatedStatus).toBeNull();
  });
});
