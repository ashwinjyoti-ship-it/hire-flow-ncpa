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

  it("includes event date, venue, and owner context on task rows", async () => {
    const db = fakeDb((sql) => {
      if (sql.includes("FROM sessions")) return { first: sessionRow };
      if (sql.includes("FROM tasks t")) {
        expect(sql).toContain("e.event_start_date AS event_start_date");
        expect(sql).toContain("e.event_end_date AS event_end_date");
        expect(sql).toContain("e.event_owner AS event_owner");
        expect(sql).toContain("event_venues");
        return {
          all: () => ({
            results: [
              {
                id: "task_test",
                title: "Follow up approval",
                event_id: "ev_test",
                event_title: "Annual Day",
                event_status: "tentative",
                event_start_date: "2026-07-12",
                event_end_date: "2026-07-12",
                event_owner: "Aditi Rao",
                event_venues: "JBT",
              },
            ],
          }),
        };
      }
      return {};
    });

    const app = buildApp({ DB: db } as never);
    const res = await app.request(
      "/tasks",
      {
        headers: { Cookie: `${SESSION_COOKIE}=sess_test` },
      },
      { DB: db } as never
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      tasks: [
        {
          event_start_date: "2026-07-12",
          event_venues: "JBT",
          event_owner: "Aditi Rao",
        },
      ],
    });
  });

  it("serves lifecycle calendar milestones separately from venue schedule entries", async () => {
    const db = fakeDb((sql) => {
      if (sql.includes("FROM sessions")) return { first: sessionRow };
      if (sql.includes("WITH lifecycle AS")) {
        expect(sql).toContain("e.enquiry_date AS milestone_date");
        expect(sql).toContain("event_status_history");
        expect(sql).toContain("tasks t");
        expect(sql).toContain("e.event_start_date AS milestone_date");
        return {
          all: () => ({
            results: [
              {
                id: "enquiry_ev_test",
                milestone_type: "enquiry",
                milestone_date: "2026-06-03",
                event_id: "ev_test",
                title: "Annual Day",
                status: "tentative",
                event_type: "VFH",
                organisation_name: "Test Org",
                event_owner: "Aditi Rao",
                venues: "JBT",
                task_title: null,
              },
              {
                id: "show_ev_test",
                milestone_type: "show",
                milestone_date: "2026-09-12",
                event_id: "ev_test",
                title: "Annual Day",
                status: "tentative",
                event_type: "VFH",
                organisation_name: "Test Org",
                event_owner: "Aditi Rao",
                venues: "JBT",
                task_title: null,
              },
            ],
          }),
        };
      }
      return {};
    });

    const app = buildApp({ DB: db } as never);
    const res = await app.request(
      "/calendar/lifecycle?from=2026-06-01&to=2026-09-30",
      {
        headers: { Cookie: `${SESSION_COOKIE}=sess_test` },
      },
      { DB: db } as never
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      entries: [
        { milestone_type: "enquiry", milestone_date: "2026-06-03" },
        { milestone_type: "show", milestone_date: "2026-09-12" },
      ],
      byDate: {
        "2026-06-03": [{ milestone_type: "enquiry" }],
        "2026-09-12": [{ milestone_type: "show" }],
      },
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
