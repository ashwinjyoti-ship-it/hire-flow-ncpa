/**
 * Morning Brief / Evening Debrief coverage: content builders, route behaviour
 * (report_type on generate/list/detail), the printable/email renderer, and the
 * scheduler job's send-time + idempotency semantics (against a fake D1).
 */
import { describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { SESSION_COOKIE } from "../lib/sessions";
import { buildEveningBrief, buildMorningBrief, DEFAULT_BRIEF_SETTINGS, mergeBriefSettings, normalizeBriefEmailRecipients, validateBriefSettings } from "../lib/brief";
import { renderBriefEmail } from "../lib/brief-html";
import { istNowHHMM, runBriefJobs } from "../lib/brief-job";

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

function sessionRow(role: string) {
  return {
    id: "sess_test",
    user_id: "user_test",
    csrf_token: "csrf",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    revoked_at: null,
    email: `${role}@example.com`,
    name: "Test User",
    role,
    is_active: 1,
  };
}

function appWith(db: D1Database) {
  const env = { DB: db, FILES: {} } as never;
  return { app: buildApp(env), env };
}

const cookie = { Cookie: `${SESSION_COOKIE}=sess_test` };

describe("brief content builders", () => {
  it("builds an empty-but-complete morning brief", async () => {
    const content = await buildMorningBrief(fakeDb(() => ({})), "2026-07-07");
    expect(content.brief_type).toBe("morning");
    expect(content.report_date).toBe("2026-07-07");
    expect(content.headline).toEqual({
      scheduled_today: 0,
      tasks_due_today: 0,
      overdue: 0,
      decisions_needed: 0,
      new_enquiries_yesterday: 0,
    });
    expect(content.team_plan).toEqual([]);
    expect(content.overdue.buckets).toHaveLength(4);
    expect(content.risk_radar.poc_incomplete).toEqual([]);
    expect(content.yesterday).toEqual({ completed: 0, new_enquiries: 0, confirmations: 0 });
  });

  it("includes incomplete POC events in the morning brief risk radar", async () => {
    const db = fakeDb((sql) => {
      if (sql.includes("FROM events e") && sql.includes("e.status IN") && sql.includes("organisation")) {
        return {
          all: () => ({
            results: [{
              event_id: "ev_poc",
              event_title: "Missing POC",
              organisation_name: "Acme",
              event_start_date: "2026-08-01",
              status: "tentative",
            }],
          }),
        };
      }
      if (sql.includes("FROM checklist_items") && sql.includes("event_id IN")) {
        return { all: () => ({ results: [{ event_id: "ev_poc", field_key: "poc_name", value: "Only" }] }) };
      }
      if (sql.includes("SELECT id, requirements FROM events WHERE id IN")) {
        return { all: () => ({ results: [{ id: "ev_poc", requirements: null }] }) };
      }
      return {};
    });
    const content = await buildMorningBrief(db, "2026-07-07");
    expect(content.risk_radar.poc_incomplete).toHaveLength(1);
    expect(content.risk_radar.poc_incomplete[0]?.event_id).toBe("ev_poc");
    expect(content.risk_radar.poc_incomplete[0]?.filled_count).toBe(1);
  });

  it("groups the team plan by assignee with unassigned first", async () => {
    const db = fakeDb((sql) => {
      if (sql.includes("t.due_date = ?") && sql.includes("t.status IN ('open','in_progress')")) {
        return {
          all: () => ({
            results: [
              { id: "t1", title: "Zoe's task", task_type: "manual", status: "open", priority: "medium", due_date: "2026-07-07", event_id: null, event_title: null, assignee_name: "Zoe" },
              { id: "t2", title: "Orphan task", task_type: "automatic", status: "open", priority: "high", due_date: "2026-07-07", event_id: null, event_title: null, assignee_name: null },
              { id: "t3", title: "Amit's task", task_type: "manual", status: "open", priority: "low", due_date: "2026-07-07", event_id: null, event_title: null, assignee_name: "Amit" },
            ],
          }),
        };
      }
      return {};
    });
    const content = await buildMorningBrief(db, "2026-07-07");
    expect(content.team_plan.map((g) => g.assignee)).toEqual([null, "Amit", "Zoe"]);
    expect(content.headline.tasks_due_today).toBe(3);
  });

  it("distinguishes timed venue conflicts from same-day scheduling reviews", async () => {
    const db = fakeDb((sql) => {
      if (sql.includes("WITH slots AS")) {
        expect(sql).toContain("a.first_start < b.last_end");
        expect(sql).toContain("LOWER(TRIM(a.event_title)) = LOWER(TRIM(b.event_title))");
        return {
          all: () => ({
            results: [
              {
                activity_date: "2026-07-10", venue: "JBT",
                a_id: "a", a_title: "Gala", a_status: "confirmed",
                b_id: "b", b_title: "Concert", b_status: "confirmed",
                timing_state: "overlap",
              },
              {
                activity_date: "2026-07-11", venue: "TET",
                a_id: "c", a_title: "Play", a_status: "confirmed",
                b_id: "d", b_title: "Talk", b_status: "confirmed",
                timing_state: "unknown",
              },
            ],
          }),
        };
      }
      return {};
    });
    const content = await buildMorningBrief(db, "2026-07-07");
    expect(content.decisions.conflicts.map((conflict) => conflict.level)).toEqual(["conflict", "potential"]);
    expect(content.attention?.map((item) => item.primary_action)).toContain("Venue time conflict · JBT");
    expect(content.attention?.map((item) => item.primary_action)).toContain("Same venue/date · review schedule · TET");
  });

  it("builds the evening scoreboard and a 7-day trend", async () => {
    const db = fakeDb((sql) => {
      if (sql.includes("SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS done,")) {
        return { first: () => ({ total: 4, done: 3, open: 1 }) };
      }
      if (sql.includes("GROUP BY due_date")) {
        return { all: () => ({ results: [{ date: "2026-07-07", due: 4, done: 3 }] }) };
      }
      return {};
    });
    const content = await buildEveningBrief(db, "2026-07-07");
    expect(content.scoreboard.due_today).toBe(4);
    expect(content.scoreboard.done_of_due).toBe(3);
    expect(content.scoreboard.still_open).toBe(1);
    expect(content.scoreboard.completion_rate).toBe(0.75);
    expect(content.trend).toHaveLength(7);
    expect(content.trend[6]).toEqual({ date: "2026-07-07", due: 4, done: 3 });
    expect(content.trend[0]).toEqual({ date: "2026-07-01", due: 0, done: 0 });
  });
});

describe("brief routes", () => {
  function briefsDb(role: string, extra: (sql: string) => QueryHandler = () => ({})) {
    return fakeDb((sql) => {
      if (sql.includes("FROM sessions")) return { first: () => sessionRow(role) };
      const handled = extra(sql);
      if (handled.first || handled.all || handled.run) return handled;
      return {};
    });
  }

  it("generates a morning brief with report_type on POST /reports/daily", async () => {
    let inserted = 0;
    const db = briefsDb("venue_manager", (sql) =>
      sql.includes("INSERT INTO daily_reports") ? { run: () => { inserted++; return { success: true }; } } : {}
    );
    const { app, env } = appWith(db);

    const res = await app.request("/reports/daily", {
      method: "POST",
      headers: { ...cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ date: "2026-07-07", type: "morning" }),
    }, env);

    expect(res.status).toBe(201);
    const body = await res.json() as { report_type: string; content: { brief_type: string; headline: unknown } };
    expect(body.report_type).toBe("morning");
    expect(body.content.brief_type).toBe("morning");
    expect(body.content.headline).toBeDefined();
    expect(inserted).toBe(1);
  });

  it("rejects an unknown report type", async () => {
    const { app, env } = appWith(briefsDb("admin"));
    const res = await app.request("/reports/daily", {
      method: "POST",
      headers: { ...cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "weekly" }),
    }, env);
    expect(res.status).toBe(400);
  });

  it("serves a saved brief through detail, xlsx and printable html", async () => {
    const content = await buildEveningBrief(fakeDb(() => ({})), "2026-07-07");
    const savedRow = {
      id: "rep_b1", report_date: "2026-07-07", report_type: "evening", generated_by: null,
      generated_at: content.generated_at, notes: null, generated_by_name: null,
      content: JSON.stringify(content),
    };
    const db = briefsDb("viewer", (sql) =>
      sql.includes("FROM daily_reports") ? { first: () => savedRow, all: () => ({ results: [savedRow] }) } : {}
    );
    const { app, env } = appWith(db);

    const view = await app.request("/reports/daily/rep_b1", { headers: cookie }, env);
    expect(view.status).toBe(200);
    const body = await view.json() as { report: { report_type: string; content: { brief_type: string } } };
    expect(body.report.report_type).toBe("evening");
    expect(body.report.content.brief_type).toBe("evening");

    const xlsx = await app.request("/reports/daily/rep_b1/xlsx", { headers: cookie }, env);
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers.get("Content-Disposition")).toContain("evening-brief-2026-07-07.xlsx");
    expect((await xlsx.arrayBuffer()).byteLength).toBeGreaterThan(0);

    const pdf = await app.request("/reports/daily/rep_b1/pdf", { headers: cookie }, env);
    expect(pdf.status).toBe(200);
    const html = await pdf.text();
    expect(html).toContain("Evening Debrief");
    expect(html).toContain("Tomorrow preview");
  });

  it("deletes a saved report for a venue manager", async () => {
    let deleted = 0;
    const db = briefsDb("venue_manager", (sql) => {
      if (sql.startsWith("DELETE FROM daily_reports")) return { run: () => { deleted++; return { success: true }; } };
      if (sql.includes("FROM daily_reports")) {
        return { first: () => ({ id: "rep_b1", report_date: "2026-07-07", report_type: "morning" }) };
      }
      return {};
    });
    const { app, env } = appWith(db);
    const res = await app.request("/reports/daily/rep_b1", { method: "DELETE", headers: cookie }, env);
    expect(res.status).toBe(200);
    expect(deleted).toBe(1);
  });

  it("refuses report deletion for a viewer and 404s on a missing report", async () => {
    const { app: viewerApp, env: viewerEnv } = appWith(briefsDb("viewer"));
    const forbidden = await viewerApp.request("/reports/daily/rep_b1", { method: "DELETE", headers: cookie }, viewerEnv);
    expect(forbidden.status).toBe(403);

    const { app: adminApp, env: adminEnv } = appWith(briefsDb("admin"));
    const missing = await adminApp.request("/reports/daily/rep_missing", { method: "DELETE", headers: cookie }, adminEnv);
    expect(missing.status).toBe(404);
  });
});

describe("brief email renderer", () => {
  it("renders the morning digest with escaped values and deep links", async () => {
    const db = fakeDb((sql) => {
      if (sql.includes("FROM schedule_entries se") && !sql.includes("WITH slots AS")) {
        return { all: () => ({ results: [{ venue: "JBT", activity_type: "show", start_time: "19:00", end_time: "22:00", event_id: "ev_1", event_title: "<Gala> & Co", event_status: "confirmed", organisation_name: "Acme" }] }) };
      }
      return {};
    });
    const content = await buildMorningBrief(db, "2026-07-07");
    const html = renderBriefEmail(content, "https://example.test");
    expect(html).toContain("Morning Brief");
    expect(html).toContain("Nothing needs your attention today.");
    expect(html).toContain("Watchlist");
    expect(html).toContain("&lt;Gala&gt; &amp; Co");
    expect(html).toContain("https://example.test/events/ev_1");
    expect(html).not.toContain("<Gala>");
  });
});

describe("brief settings helpers", () => {
  it("normalises recipient lists and defaults to the ops head", () => {
    expect(normalizeBriefEmailRecipients(undefined)).toEqual(["nkotwal@ncpamumbai.com"]);
    expect(normalizeBriefEmailRecipients(["  NKotwal@NCPAMumbai.com ", "ops@example.com", "ops@example.com", ""])).toEqual([
      "nkotwal@ncpamumbai.com",
      "ops@example.com",
    ]);
  });

  it("rejects enabled digests with no recipients", () => {
    expect(validateBriefSettings(mergeBriefSettings({ email_enabled: true, email_recipients: [] }))).toMatch(/recipient/i);
    expect(validateBriefSettings(mergeBriefSettings({ email_enabled: false, email_recipients: [] }))).toBeNull();
  });
});

describe("brief scheduler job", () => {
  it("computes IST clock time", () => {
    expect(istNowHHMM(new Date("2026-07-07T02:30:00Z"))).toBe("08:00");
    expect(istNowHHMM(new Date("2026-07-07T01:00:00Z"))).toBe("06:30");
  });

  it("generates only the briefs whose send time has passed", async () => {
    const inserts: string[] = [];
    const db = fakeDb((sql) => {
      if (sql.includes("INSERT INTO daily_reports")) {
        return { run: () => { inserts.push(sql); return { success: true }; } };
      }
      return {};
    });
    // 02:30 UTC = 08:00 IST — past the 07:30 morning send, before 18:30.
    const res = await runBriefJobs({ DB: db, MAIL_FROM: "x@y.z" }, new Date("2026-07-07T02:30:00Z"));
    expect(res.generated).toEqual(["morning"]);
    expect(inserts).toHaveLength(1);

    // 14:00 UTC = 19:30 IST — both send times have passed.
    const res2 = await runBriefJobs({ DB: db, MAIL_FROM: "x@y.z" }, new Date("2026-07-07T14:00:00Z"));
    expect(res2.generated).toEqual(["morning", "evening"]);
  });

  it("skips generation when an automatic brief already exists (idempotent)", async () => {
    const db = fakeDb((sql) => {
      if (sql.includes("generated_by IS NULL")) return { first: () => ({ found: 1 }) };
      return {};
    });
    const res = await runBriefJobs({ DB: db, MAIL_FROM: "x@y.z" }, new Date("2026-07-07T14:00:00Z"));
    expect(res.generated).toEqual([]);
  });

  it("does nothing before the morning send time", async () => {
    const res = await runBriefJobs({ DB: fakeDb(() => ({})), MAIL_FROM: "x@y.z" }, new Date("2026-07-07T01:00:00Z"));
    expect(res.generated).toEqual([]);
  });

  it("has sane default settings", () => {
    expect(DEFAULT_BRIEF_SETTINGS.morning_time).toBe("07:30");
    expect(DEFAULT_BRIEF_SETTINGS.evening_time).toBe("18:30");
    expect(DEFAULT_BRIEF_SETTINGS.email_enabled).toBe(true);
    expect(DEFAULT_BRIEF_SETTINGS.email_recipients).toEqual(["nkotwal@ncpamumbai.com"]);
  });

  it("emails configured recipients instead of every report.generate user", async () => {
    const sent: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("api.resend.com")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { to?: string };
        if (body.to) sent.push(body.to);
        return new Response(JSON.stringify({ id: "msg_1" }), { status: 200 });
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    try {
      const inserts: string[] = [];
      const db = {
        prepare(sql: string) {
          let binds: unknown[] = [];
          return {
            bind(...values: unknown[]) {
              binds = values;
              return this;
            },
            async first() {
              if (sql.includes("FROM app_settings") && binds[0] === "brief_settings") {
                return {
                  value: JSON.stringify({
                    email_enabled: true,
                    email_recipients: ["nkotwal@ncpamumbai.com", "ops@example.com"],
                  }),
                };
              }
              // Resend key / mail_from come from env when settings rows are absent.
              if (sql.includes("FROM app_settings")) return null;
              if (sql.includes("generated_by IS NULL")) return null;
              return null;
            },
            async all() {
              return { results: [] };
            },
            async run() {
              if (sql.includes("INSERT INTO daily_reports")) inserts.push(sql);
              return { success: true };
            },
          };
        },
      } as unknown as D1Database;

      const res = await runBriefJobs(
        { DB: db, MAIL_FROM: "NCPA <noreply@example.com>", RESEND_API_KEY: "re_test_key_123456" },
        new Date("2026-07-07T02:30:00Z")
      );
      expect(res.generated).toEqual(["morning"]);
      expect(inserts).toHaveLength(1);
      expect(sent).toEqual(["nkotwal@ncpamumbai.com", "ops@example.com"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
