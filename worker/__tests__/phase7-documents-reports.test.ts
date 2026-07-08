/**
 * Phase 7 coverage: R2 document handling, daily operational report snapshots,
 * and analytics routes (permissions + behaviour against a fake D1/R2).
 */
import { describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { SESSION_COOKIE } from "../lib/sessions";
import {
  ALLOWED_MIME_TYPES,
  MAX_DOCUMENT_BYTES,
  documentObjectKey,
  sanitizeFileName,
  validateUpload,
} from "../lib/documents";
import { buildDailyReportContent, istToday } from "../lib/daily-report";

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

type StoredObject = { key: string; contentType?: string; bytes: ArrayBuffer };

function fakeFiles(store: StoredObject[]) {
  return {
    async put(key: string, bytes: ArrayBuffer, opts?: { httpMetadata?: { contentType?: string } }) {
      store.push({ key, bytes, contentType: opts?.httpMetadata?.contentType });
    },
    async get(key: string) {
      const found = store.find((o) => o.key === key);
      if (!found) return null;
      return { body: found.bytes, httpMetadata: { contentType: found.contentType } };
    },
  } as unknown as R2Bucket;
}

function appWith(db: D1Database, files?: R2Bucket) {
  const env = { DB: db, FILES: files ?? fakeFiles([]) } as never;
  return { app: buildApp(env), env };
}

const cookie = { Cookie: `${SESSION_COOKIE}=sess_test` };

describe("document helpers", () => {
  it("sanitises filenames (paths, unsafe characters, length)", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("C:\\Users\\x\\report final (v2).pdf")).toBe("report_final_v2_.pdf");
    expect(sanitizeFileName("costing — JBT & OAP.xlsx")).toBe("costing_JBT_OAP.xlsx");
    expect(sanitizeFileName(".hidden")).toBe("hidden");
    expect(sanitizeFileName("///")).toBe("file");
    const long = `${"a".repeat(200)}.pdf`;
    const sanitised = sanitizeFileName(long);
    expect(sanitised.length).toBeLessThanOrEqual(120);
    expect(sanitised.endsWith(".pdf")).toBe(true);
  });

  it("builds the canonical object key format", () => {
    expect(documentObjectKey("ev_1", "doc_2", "Confirmation Letter.pdf")).toBe(
      "documents/ev_1/doc_2/Confirmation_Letter.pdf"
    );
  });

  it("validates size and MIME type", () => {
    expect(validateUpload({ size: 100, type: "application/pdf", name: "a.pdf" })).toBeNull();
    expect(validateUpload({ size: 0, type: "application/pdf", name: "a.pdf" })).toMatch(/empty/);
    expect(validateUpload({ size: MAX_DOCUMENT_BYTES + 1, type: "application/pdf", name: "a.pdf" })).toMatch(/25 MB/);
    expect(validateUpload({ size: 100, type: "application/x-msdownload", name: "a.exe" })).toMatch(/not allowed/);
    expect(ALLOWED_MIME_TYPES.has("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe(true);
  });
});

describe("document routes", () => {
  function documentsDb(role: string, extra: (sql: string) => QueryHandler = () => ({})) {
    return fakeDb((sql) => {
      if (sql.includes("FROM sessions")) return { first: () => sessionRow(role) };
      const handled = extra(sql);
      if (handled.first || handled.all || handled.run) return handled;
      return {};
    });
  }

  it("uploads a document to R2 with the sanitised key and stores metadata", async () => {
    const inserts: string[] = [];
    const store: StoredObject[] = [];
    const db = documentsDb("coordinator", (sql) => {
      if (sql.includes("FROM events WHERE id = ?")) return { first: () => ({ id: "ev_1" }) };
      if (sql.includes("INSERT INTO documents")) return { run: () => { inserts.push(sql); return { success: true }; } };
      return {};
    });
    const files = fakeFiles(store);
    const { app, env } = appWith(db, files);

    const form = new FormData();
    form.append("file", new File(["hello"], "Costing Sheet (final).pdf", { type: "application/pdf" }));
    form.append("category", "costing");
    const res = await app.request("/events/ev_1/documents", { method: "POST", body: form, headers: cookie }, env);

    expect(res.status).toBe(201);
    const body = await res.json() as { id: string; file_name: string };
    expect(body.file_name).toBe("Costing_Sheet_final_.pdf");
    expect(store).toHaveLength(1);
    expect(store[0]!.key).toBe(`documents/ev_1/${body.id}/Costing_Sheet_final_.pdf`);
    expect(store[0]!.contentType).toBe("application/pdf");
    expect(inserts).toHaveLength(1);
  });

  it("rejects uploads from viewers", async () => {
    const { app, env } = appWith(documentsDb("viewer"));
    const form = new FormData();
    form.append("file", new File(["x"], "a.pdf", { type: "application/pdf" }));
    const res = await app.request("/events/ev_1/documents", { method: "POST", body: form, headers: cookie }, env);
    expect(res.status).toBe(403);
  });

  it("rejects disallowed MIME types and bad categories", async () => {
    const db = documentsDb("coordinator", (sql) =>
      sql.includes("FROM events WHERE id = ?") ? { first: () => ({ id: "ev_1" }) } : {}
    );
    const { app, env } = appWith(db);

    const badType = new FormData();
    badType.append("file", new File(["MZ"], "tool.exe", { type: "application/x-msdownload" }));
    const res1 = await app.request("/events/ev_1/documents", { method: "POST", body: badType, headers: cookie }, env);
    expect(res1.status).toBe(400);

    const badCategory = new FormData();
    badCategory.append("file", new File(["x"], "a.pdf", { type: "application/pdf" }));
    badCategory.append("category", "malware");
    const res2 = await app.request("/events/ev_1/documents", { method: "POST", body: badCategory, headers: cookie }, env);
    expect(res2.status).toBe(400);
  });

  it("downloads through the Worker with an attachment disposition", async () => {
    const store: StoredObject[] = [{ key: "documents/ev_1/doc_1/report.pdf", bytes: new TextEncoder().encode("pdf!").buffer as ArrayBuffer, contentType: "application/pdf" }];
    const db = documentsDb("viewer", (sql) =>
      sql.includes("FROM documents WHERE id = ?")
        ? {
            first: () => ({
              id: "doc_1", event_id: "ev_1", file_name: "report.pdf",
              r2_key: "documents/ev_1/doc_1/report.pdf", mime_type: "application/pdf",
              file_size: 4, is_archived: 0,
            }),
          }
        : {}
    );
    const { app, env } = appWith(db, fakeFiles(store));

    const res = await app.request("/documents/doc_1/download", { headers: cookie }, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="report.pdf"');
    expect(await res.text()).toBe("pdf!");
  });

  it("archives (never hard-deletes) with venue manager permission", async () => {
    const updates: string[] = [];
    const db = documentsDb("venue_manager", (sql) => {
      if (sql.includes("FROM documents WHERE id = ?")) {
        return { first: () => ({ id: "doc_1", event_id: "ev_1", file_name: "a.pdf", is_archived: 0 }) };
      }
      if (sql.startsWith("UPDATE documents SET is_archived = 1")) {
        return { run: () => { updates.push(sql); return { success: true }; } };
      }
      if (sql.includes("DELETE FROM documents")) throw new Error("hard delete attempted");
      return {};
    });
    const { app, env } = appWith(db);

    const res = await app.request("/documents/doc_1", { method: "DELETE", headers: cookie }, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, archived: true });
    expect(updates).toHaveLength(1);
  });

  it("blocks coordinators from archiving documents", async () => {
    const { app, env } = appWith(documentsDb("coordinator"));
    const res = await app.request("/documents/doc_1", { method: "DELETE", headers: cookie }, env);
    expect(res.status).toBe(403);
  });
});

describe("daily report", () => {
  it("computes today's date in Asia/Kolkata", () => {
    // 2026-07-06 20:00 UTC is already 2026-07-07 in IST (+05:30).
    expect(istToday(new Date("2026-07-06T20:00:00Z"))).toBe("2026-07-07");
    expect(istToday(new Date("2026-07-06T12:00:00Z"))).toBe("2026-07-06");
  });

  it("builds a snapshot with all five sections and totals", async () => {
    const db = fakeDb((sql) => {
      if (sql.includes("FROM schedule_entries se")) {
        return { all: () => ({ results: [{ venue: "JBT", activity_type: "show", start_time: "19:00", end_time: "22:00", event_id: "ev_1", event_title: "Gala", event_status: "confirmed", organisation_name: "Acme" }] }) };
      }
      if (sql.includes("t.task_type = 'automatic'")) {
        return { all: () => ({ results: [{ id: "t1", title: "Approval follow-up", task_type: "automatic", status: "open", priority: "high", due_date: "2026-07-07", event_id: "ev_1", event_title: "Gala", assignee_name: null }] }) };
      }
      if (sql.includes("t.task_type = 'manual'")) return { all: () => ({ results: [] }) };
      if (sql.includes("t.status = 'completed'")) {
        return { all: () => ({ results: [{ id: "t2", title: "Send rider", event_title: "Gala", completed_by_name: "VM", completion_note: null }] }) };
      }
      if (sql.includes("FROM checklist_items ci")) return { all: () => ({ results: [] }) };
      if (sql.includes("FROM event_status_history")) {
        return { all: () => ({ results: [{ event_id: "ev_1", event_title: "Gala", from_status: "approved", to_status: "confirmed", changed_by_name: "VM", reason: null }] }) };
      }
      if (sql.includes("t.due_date <= ?")) {
        return { all: () => ({ results: [{ id: "t3", title: "Chase payment", task_type: "automatic", status: "open", priority: "medium", due_date: "2026-07-05", event_id: null, event_title: null, assignee_name: null }] }) };
      }
      return {};
    });

    const content = await buildDailyReportContent(db, "2026-07-07");
    expect(content.report_date).toBe("2026-07-07");
    expect(content.scheduled).toHaveLength(1);
    expect(content.system_tasks).toHaveLength(1);
    expect(content.manual_tasks).toHaveLength(0);
    expect(content.work_achieved.tasks_completed).toHaveLength(1);
    expect(content.work_achieved.status_changes).toHaveLength(1);
    expect(content.outstanding[0]!.days_overdue).toBe(2);
    expect(content.totals).toEqual({ scheduled: 1, system_tasks: 1, manual_tasks: 0, work_achieved: 2, outstanding: 1 });
  });

  function reportsDb(role: string, extra: (sql: string) => QueryHandler = () => ({})) {
    return fakeDb((sql) => {
      if (sql.includes("FROM sessions")) return { first: () => sessionRow(role) };
      const handled = extra(sql);
      if (handled.first || handled.all || handled.run) return handled;
      return {};
    });
  }

  it("saves an immutable snapshot on POST /reports/daily", async () => {
    let inserted = 0;
    const db = reportsDb("venue_manager", (sql) =>
      sql.includes("INSERT INTO daily_reports") ? { run: () => { inserted++; return { success: true }; } } : {}
    );
    const { app, env } = appWith(db);

    const res = await app.request("/reports/daily", {
      method: "POST",
      headers: { ...cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ date: "2026-07-07" }),
    }, env);

    expect(res.status).toBe(201);
    const body = await res.json() as { id: string; report_date: string; content: { totals: unknown } };
    expect(body.report_date).toBe("2026-07-07");
    expect(body.content.totals).toBeDefined();
    expect(inserted).toBe(1);
  });

  it("blocks coordinators from generating but lets them view", async () => {
    const savedRow = {
      id: "rep_1", report_date: "2026-07-01", generated_by: "user_x",
      generated_at: "2026-07-01T13:00:00Z", notes: null, generated_by_name: "Admin",
      content: JSON.stringify({
        report_date: "2026-07-01", generated_at: "2026-07-01T13:00:00Z",
        scheduled: [], system_tasks: [], manual_tasks: [],
        work_achieved: { tasks_completed: [], checklist_completed: [], status_changes: [] },
        outstanding: [],
        totals: { scheduled: 0, system_tasks: 0, manual_tasks: 0, work_achieved: 0, outstanding: 0 },
      }),
    };
    const db = reportsDb("coordinator", (sql) =>
      sql.includes("FROM daily_reports") ? { first: () => savedRow, all: () => ({ results: [savedRow] }) } : {}
    );
    const { app, env } = appWith(db);

    const generate = await app.request("/reports/daily", { method: "POST", headers: cookie, body: "{}" }, env);
    expect(generate.status).toBe(403);

    // Past report re-opens with the stored snapshot, not recomputed data.
    const view = await app.request("/reports/daily/rep_1", { headers: cookie }, env);
    expect(view.status).toBe(200);
    const body = await view.json() as { report: { content: { report_date: string } } };
    expect(body.report.content.report_date).toBe("2026-07-01");
  });

  it("exports the snapshot as xlsx and printable html", async () => {
    const savedRow = {
      id: "rep_1", report_date: "2026-07-01", generated_by: null,
      generated_at: "2026-07-01T13:00:00Z", notes: null, generated_by_name: null,
      content: JSON.stringify({
        report_date: "2026-07-01", generated_at: "2026-07-01T13:00:00Z",
        scheduled: [{ venue: "JBT", activity_type: "show", start_time: null, end_time: null, event_id: "ev", event_title: "<Gala>", event_status: "confirmed", organisation_name: null }],
        system_tasks: [], manual_tasks: [],
        work_achieved: { tasks_completed: [], checklist_completed: [], status_changes: [] },
        outstanding: [],
        totals: { scheduled: 1, system_tasks: 0, manual_tasks: 0, work_achieved: 0, outstanding: 0 },
      }),
    };
    const db = reportsDb("viewer", (sql) =>
      sql.includes("FROM daily_reports") ? { first: () => savedRow } : {}
    );
    const { app, env } = appWith(db);

    const xlsx = await app.request("/reports/daily/rep_1/xlsx", { headers: cookie }, env);
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers.get("Content-Type")).toContain("spreadsheetml");
    expect((await xlsx.arrayBuffer()).byteLength).toBeGreaterThan(0);

    const pdf = await app.request("/reports/daily/rep_1/pdf", { headers: cookie }, env);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("Content-Type")).toContain("text/html");
    const html = await pdf.text();
    expect(html).toContain("Daily Operational Report");
    expect(html).toContain("&lt;Gala&gt;"); // HTML-escaped snapshot values
  });
});

describe("analytics routes", () => {
  function analyticsDb(role: string, extra: (sql: string) => QueryHandler = () => ({})) {
    return fakeDb((sql) => {
      if (sql.includes("FROM sessions")) return { first: () => sessionRow(role) };
      const handled = extra(sql);
      if (handled.first || handled.all || handled.run) return handled;
      return {};
    });
  }

  it("requires authentication for every analytics area", async () => {
    const { app, env } = appWith(fakeDb(() => ({})));
    for (const area of ["venue-utilisation", "inquiry-conversion", "payment-tracking", "operational-performance", "client-profile"]) {
      const res = await app.request(`/analytics/${area}`, {}, env);
      expect(res.status).toBe(401);
    }
  });

  it("serves all five areas to viewers (report.view)", async () => {
    const { app, env } = appWith(analyticsDb("viewer"));
    for (const area of ["venue-utilisation", "inquiry-conversion", "payment-tracking", "operational-performance", "client-profile"]) {
      const res = await app.request(`/analytics/${area}?from=2026-06-01&to=2026-06-30`, { headers: cookie }, env);
      expect(res.status).toBe(200);
      const body = await res.json() as { from: string; to: string };
      expect(body.from).toBe("2026-06-01");
      expect(body.to).toBe("2026-06-30");
    }
  });

  it("computes venue utilisation over the requested range", async () => {
    const db = analyticsDb("admin", (sql) => {
      if (sql.includes("COUNT(DISTINCT se.activity_date) AS booked_days")) {
        return { all: () => ({ results: [{ venue: "JBT", booked_days: 15, entries: 22 }] }) };
      }
      if (sql.includes("GROUP BY vb.venue, se.activity_type")) {
        return { all: () => ({ results: [{ venue: "JBT", activity_type: "show", entries: 10 }, { venue: "JBT", activity_type: "setup", entries: 12 }] }) };
      }
      return {};
    });
    const { app, env } = appWith(db);

    const res = await app.request("/analytics/venue-utilisation?from=2026-06-01&to=2026-06-30", { headers: cookie }, env);
    const body = await res.json() as { days: number; venues: Array<{ venue: string; utilisation: number; by_activity: Record<string, number> }> };
    expect(body.days).toBe(30);
    expect(body.venues[0]!.utilisation).toBeCloseTo(0.5);
    expect(body.venues[0]!.by_activity).toEqual({ show: 10, setup: 12 });
  });

  it("computes the inquiry conversion funnel without inventing revenue", async () => {
    const db = analyticsDb("admin", (sql) => {
      if (sql.includes("GROUP BY e.status")) {
        return { all: () => ({ results: [
          { status: "enquiry", count: 5 },
          { status: "confirmed", count: 3 },
          { status: "regret", count: 2 },
        ] }) };
      }
      if (sql.includes("enquiry_source")) return { all: () => ({ results: [{ source: "Email", total: 10, confirmed: 3 }] }) };
      return {};
    });
    const { app, env } = appWith(db);

    const res = await app.request("/analytics/inquiry-conversion", { headers: cookie }, env);
    const body = await res.json() as Record<string, unknown>;
    expect(body.total_inquiries).toBe(10);
    expect(body.confirmed).toBe(3);
    expect(body.declined).toBe(2);
    expect(body.conversion_rate).toBeCloseTo(0.3);
    expect(body).not.toHaveProperty("revenue");
  });
});
