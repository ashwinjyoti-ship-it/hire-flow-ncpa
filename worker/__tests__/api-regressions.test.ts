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

/**
 * Variant of fakeDb that captures the bind arguments of the *first* statement
 * matching a rule's `match` substring. Use to assert which values a route binds
 * (e.g. confirming a default filter value). Each rule optionally inspects SQL
 * via `onSql` and returns data via `first`/`all`/`run`.
 */
type BindRule = {
  match: string;
  first?: () => unknown;
  all?: () => unknown;
  run?: () => unknown;
  onSql?: (sql: string) => void;
};
function bindCapturingDb(rules: BindRule[], onBinds: (binds: unknown[]) => void): D1Database {
  return {
    prepare(sql: string) {
      const rule = rules.find((r) => sql.includes(r.match));
      if (rule) {
        rule.onSql?.(sql);
        let lastBinds: unknown[] = [];
        // Only the matched rule reports binds, so unrelated statements (e.g.
        // the session lookup) can't clobber the captured value.
        return {
          bind(...args: unknown[]) { lastBinds = args; return this; },
          async first() { onBinds(lastBinds); return rule.first?.() ?? null; },
          async all() { onBinds(lastBinds); return rule.all?.() ?? { results: [] }; },
          async run() { onBinds(lastBinds); return rule.run?.() ?? { success: true }; },
        };
      }
      return {
        bind() { return this; },
        async first() { return null; },
        async all() { return { results: [] }; },
        async run() { return { success: true }; },
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
        expect(sql).toContain("o.name AS organisation_name");
        expect(sql).toContain("ci.module AS source_module");
        expect(sql).toContain("ci.field_key AS source_field_key");
        expect(sql).toContain("LEFT JOIN checklist_items ci");
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
                organisation_name: "Test Organisation",
                source_module: "operations",
                source_field_key: "approval_received_on",
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
          organisation_name: "Test Organisation",
          source_module: "operations",
          source_field_key: "approval_received_on",
          event_venues: "JBT",
          event_owner: "Aditi Rao",
        },
      ],
    });
  });

  it("serves one current lifecycle calendar card per event, separate from tasks and venue schedule entries", async () => {
    const db = fakeDb((sql) => {
      if (sql.includes("FROM sessions")) return { first: sessionRow };
      if (sql.includes("WITH lifecycle AS")) {
        expect(sql).toContain("WHEN e.status = 'enquiry' THEN e.enquiry_date");
        expect(sql).toContain("event_status_history");
        expect(sql).not.toContain("tasks t");
        expect(sql).not.toContain("'show' AS milestone_type");
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
      ],
      byDate: {
        "2026-06-03": [{ milestone_type: "enquiry" }],
      },
    });
  });

  it("allows lifecycle cards to be fetched across all dates for the dashboard", async () => {
    const db = fakeDb((sql) => {
      if (sql.includes("FROM sessions")) return { first: sessionRow };
      if (sql.includes("WITH lifecycle AS")) {
        expect(sql).toContain("is_archived = 0");
        expect(sql).not.toContain("milestone_date >= ?");
        expect(sql).not.toContain("milestone_date <= ?");
        return { all: () => ({ results: [] }) };
      }
      return {};
    });

    const app = buildApp({ DB: db } as never);
    const res = await app.request(
      "/calendar/lifecycle",
      {
        headers: { Cookie: `${SESSION_COOKIE}=sess_test` },
      },
      { DB: db } as never
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ entries: [], byDate: {} });
  });

  it("applies text search on the show calendar", async () => {
    const db = fakeDb((sql) => {
      if (sql.includes("FROM sessions")) return { first: sessionRow };
      if (sql.includes("FROM schedule_entries se")) {
        expect(sql).toContain("LOWER(e.title) LIKE ?");
        expect(sql).toContain("LOWER(COALESCE(o.name, '')) LIKE ?");
        expect(sql).toContain("LOWER(COALESCE(e.event_code, '')) LIKE ?");
        return { all: () => ({ results: [] }) };
      }
      return {};
    });

    const app = buildApp({ DB: db } as never);
    const res = await app.request(
      "/calendar?from=2026-07-01&to=2026-07-31&q=agp",
      {
        headers: { Cookie: `${SESSION_COOKIE}=sess_test` },
      },
      { DB: db } as never
    );

    expect(res.status).toBe(200);
  });

  it("gates the show calendar to confirmed events by default", async () => {
    // Regression: an enquiry entered today with a September show date used to
    // appear on the September show calendar. The show calendar now defaults to
    // confirmed-only — a venue earns a card once approved/confirmed.
    let capturedBinds: unknown[] = [];
    const db = bindCapturingDb([
      { match: "FROM sessions", first: sessionRow },
      {
        match: "FROM schedule_entries se",
        onSql: (sql) => expect(sql).toContain("e.status = ?"),
        all: () => ({ results: [] }),
      },
    ], (b) => { capturedBinds = b; });

    const app = buildApp({ DB: db } as never);
    const res = await app.request(
      "/calendar?from=2026-09-01&to=2026-09-30",
      { headers: { Cookie: `${SESSION_COOKIE}=sess_test` } },
      { DB: db } as never
    );

    expect(res.status).toBe(200);
    expect(capturedBinds).toContain("confirmed");
  });

  it("promotes venue bookings when an event is confirmed", async () => {
    let updatedEventStatus = false;
    let promotedVenueBookings = false;
    const db = fakeDb((sql) => {
      if (sql.includes("FROM sessions")) return { first: sessionRow };
      if (sql.includes("FROM events WHERE id")) {
        return {
          first: () => ({
            status: "tentative",
            event_type: "EE",
            approval_status: "not_required",
            confirmation_status: "signed_received",
          }),
        };
      }
      if (sql.startsWith("UPDATE events SET status")) {
        return {
          run: () => {
            updatedEventStatus = true;
            return { success: true };
          },
        };
      }
      if (sql.startsWith("UPDATE venue_bookings SET booking_status = 'confirmed'")) {
        return {
          run: () => {
            promotedVenueBookings = true;
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

    expect(res.status).toBe(200);
    expect(updatedEventStatus).toBe(true);
    expect(promotedVenueBookings).toBe(true);
  });

  it("honours an explicit status choice on the show calendar over the confirmed default", async () => {
    // When a user deliberately picks a status from the filter (e.g. to inspect
    // tentative holds), that exact choice wins — the default does not override
    // their intent.
    let capturedBinds: unknown[] = [];
    const db = bindCapturingDb([
      { match: "FROM sessions", first: sessionRow },
      { match: "FROM schedule_entries se", all: () => ({ results: [] }) },
    ], (b) => { capturedBinds = b; });

    const app = buildApp({ DB: db } as never);
    const res = await app.request(
      "/calendar?from=2026-09-01&to=2026-09-30&status=tentative",
      { headers: { Cookie: `${SESSION_COOKIE}=sess_test` } },
      { DB: db } as never
    );

    expect(res.status).toBe(200);
    expect(capturedBinds).toContain("tentative");
    expect(capturedBinds).not.toContain("confirmed");
  });

  it("serves show-specific details for the show calendar drawer", async () => {
    const db = fakeDb((sql) => {
      if (sql.includes("FROM sessions")) return { first: sessionRow };
      if (sql.includes("FROM schedule_entries se")) {
        expect(sql).toContain("se.with_ac_start");
        expect(sql).toContain("se.with_ac_end");
        expect(sql).toContain("se.without_ac_start");
        expect(sql).toContain("se.without_ac_end");
        expect(sql).toContain("se.notes AS schedule_notes");
        expect(sql).toContain("vb.number_of_shows");
        expect(sql).toContain("vb.requirements");
        expect(sql).toContain("vb.notes AS venue_notes");
        expect(sql).toContain("e.event_code");
        expect(sql).toContain("e.event_owner");
        return {
          all: () => ({
            results: [
              {
                id: "se_1",
                activity_type: "show",
                activity_date: "2026-09-10",
                start_time: "19:00",
                end_time: "21:00",
                with_ac_start: "18:00",
                with_ac_end: "21:30",
                without_ac_start: "14:00",
                without_ac_end: "17:00",
                schedule_notes: "Main performance",
                event_id: "ev_1",
                event_code: "NCPA-001",
                title: "Classical Recital",
                status: "confirmed",
                event_type: "VFH",
                organisation_name: "ACE Production",
                event_owner: "Aditi Rao",
                venue: "JBT",
                booking_status: "confirmed",
                number_of_shows: 2,
                requirements: "Green room",
                venue_notes: "Piano tuned",
              },
            ],
          }),
        };
      }
      return {};
    });

    const app = buildApp({ DB: db } as never);
    const res = await app.request(
      "/calendar?from=2026-09-01&to=2026-09-30",
      { headers: { Cookie: `${SESSION_COOKIE}=sess_test` } },
      { DB: db } as never
    );
    const body = await res.json() as { entries: Array<Record<string, unknown>> };

    expect(res.status).toBe(200);
    expect(body.entries[0]).toMatchObject({
      event_code: "NCPA-001",
      event_owner: "Aditi Rao",
      with_ac_start: "18:00",
      without_ac_start: "14:00",
      number_of_shows: 2,
      requirements: "Green room",
      venue_notes: "Piano tuned",
    });
  });

  it("links events to the event owner account (event_owner_id) on create", async () => {
    // Phase 8b: the events INSERT must carry event_owner_id so tasks auto-route
    // and "My events" can filter by owner identity. We assert the SQL + bind
    // rather than the full create flow (which spans many tables).
    let eventsSql = "";
    let capturedBinds: unknown[] = [];
    const db = bindCapturingDb([
      { match: "FROM sessions", first: sessionRow },
      { match: "INSERT INTO events", onSql: (sql) => { eventsSql = sql; }, run: () => ({ success: true }) },
    ], (b) => { capturedBinds = b; });

    const app = buildApp({ DB: db } as never);
    await app.request(
      "/events",
      {
        method: "POST",
        headers: { Cookie: `${SESSION_COOKIE}=sess_test`, "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Owner-linked event",
          organisation_id: "org_1",
          event_owner: "Aditi Rao",
          event_owner_id: "demo_user_aditi",
          venue_bookings: [{ venue: "JBT" }],
        }),
      },
      { DB: db } as never
    );

    expect(eventsSql).toContain("event_owner_id");
    expect(capturedBinds).toContain("demo_user_aditi");
  });

  it("archives an event record while keeping organisation and POC details", async () => {
    const touchedSql: string[] = [];
    const db = fakeDb((sql) => {
      touchedSql.push(sql);
      if (sql.includes("FROM sessions")) return { first: sessionRow };
      if (sql.includes("SELECT id, title, organisation_id, primary_contact_id, is_archived FROM events")) {
        return {
          first: () => ({
            id: "ev_archive",
            title: "Archive Me",
            organisation_id: "org_keep",
            primary_contact_id: "contact_keep",
            is_archived: 0,
          }),
        };
      }
      if (sql.startsWith("UPDATE events SET is_archived = 1")) return { run: () => ({ success: true }) };
      if (sql.startsWith("UPDATE tasks SET status = 'cancelled'")) return { run: () => ({ success: true }) };
      if (sql.includes("INSERT INTO audit_logs")) return { run: () => ({ success: true }) };
      if (sql.includes("INSERT INTO event_activity")) return { run: () => ({ success: true }) };
      if (sql.includes("UPDATE organisations") || sql.includes("DELETE FROM organisations")) throw new Error("organisation should be kept");
      if (sql.includes("UPDATE contacts") || sql.includes("DELETE FROM contacts")) throw new Error("POC should be kept");
      return {};
    });

    const app = buildApp({ DB: db } as never);
    const res = await app.request(
      "/events/ev_archive",
      {
        method: "DELETE",
        headers: { Cookie: `${SESSION_COOKIE}=sess_test`, "Content-Type": "application/json" },
        body: JSON.stringify({ keep_org_details: true }),
      },
      { DB: db } as never
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      archived: true,
      keptOrganisationAndPoc: true,
    });
    expect(touchedSql.some((sql) => sql.startsWith("UPDATE events SET is_archived = 1"))).toBe(true);
  });

  it("filters the event list to the signed-in owner when mine=1", async () => {
    let capturedBinds: unknown[] = [];
    const db = bindCapturingDb([
      { match: "FROM sessions", first: sessionRow },
      { match: "FROM events e LEFT JOIN organisations", all: () => ({ results: [] }) },
    ], (b) => { capturedBinds = b; });

    const app = buildApp({ DB: db } as never);
    const res = await app.request(
      "/events?mine=1",
      { headers: { Cookie: `${SESSION_COOKIE}=sess_test` } },
      { DB: db } as never
    );

    expect(res.status).toBe(200);
    // sessionRow's user_id is "user_admin" — mine=1 must bind that id.
    expect(capturedBinds).toContain("user_admin");
  });

  it("allows admins to manage event owner lookup options", async () => {
    let insertedListKey: string | null = null;
    let insertedValue: string | null = null;
    const db = fakeDb((sql) => {
      if (sql.includes("FROM sessions")) return { first: sessionRow };
      if (sql.includes("MAX(sort_order)")) return { first: () => ({ next: 5 }) };
      if (sql.includes("INSERT INTO dropdown_options")) {
        return {
          run: () => {
            insertedListKey = "handled_by";
            insertedValue = "New Owner";
            return { success: true };
          },
        };
      }
      if (sql.includes("INSERT INTO audit_logs")) return { run: () => ({ success: true }) };
      return {};
    });

    const app = buildApp({ DB: db } as never);
    const res = await app.request(
      "/lookups/handled_by",
      {
        method: "POST",
        headers: {
          Cookie: `${SESSION_COOKIE}=sess_test`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ value: "New Owner" }),
      },
      { DB: db } as never
    );

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({ id: expect.stringMatching(/^opt_/) });
    expect(insertedListKey).toBe("handled_by");
    expect(insertedValue).toBe("New Owner");
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
