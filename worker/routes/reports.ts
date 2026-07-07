/**
 * Daily operational report routes.
 *   POST /daily          — generate + save an immutable snapshot (report.generate)
 *   GET  /daily          — list saved reports (?date= filter)     (report.view)
 *   GET  /daily/:id      — one saved snapshot                     (report.view)
 *   GET  /daily/:id/xlsx — Excel export (SheetJS, built in-Worker) (report.view)
 *   GET  /daily/:id/pdf  — print-ready HTML document; the browser's
 *                          print-to-PDF produces the PDF (Workers have no
 *                          native PDF renderer, per the Phase 7 preference
 *                          for client-side export).                (report.view)
 *
 * Snapshots are immutable: re-generating a date inserts a new row; existing
 * rows are never updated. Past reports re-open exactly as saved.
 */
import { Hono } from "hono";
import { z } from "zod";
import { utils, write } from "xlsx";
import type { AuthEnv } from "../middleware/auth";
import { requirePermission, actorFrom, ipHint } from "../middleware/auth";
import { audit } from "../lib/audit";
import { makeId } from "../lib/id";
import { buildDailyReportContent, istToday, type DailyReportContent } from "../lib/daily-report";

export const reportRoutes = new Hono<AuthEnv>();

const GenerateInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().nullish(),
});

type ReportRow = {
  id: string;
  report_date: string;
  generated_by: string | null;
  generated_at: string;
  content: string;
  notes: string | null;
  generated_by_name?: string | null;
};

// POST /daily — generate a snapshot (defaults to today in Asia/Kolkata)
reportRoutes.post("/daily", requirePermission("report.generate"), async (c) => {
  const parsed = GenerateInput.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Invalid input", detail: parsed.error.flatten() }, 400);
  const user = c.get("user")!;
  const db = c.env.DB;
  const reportDate = parsed.data.date ?? istToday();

  const content = await buildDailyReportContent(db, reportDate);
  const id = makeId("rep");
  await db.prepare(
    `INSERT INTO daily_reports (id, report_date, generated_by, generated_at, content, notes)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, reportDate, user.id, content.generated_at, JSON.stringify(content), parsed.data.notes ?? null).run();

  await audit({
    db, actor: actorFrom(user), action: "report.generated",
    targetType: "daily_report", targetId: id, detail: { reportDate },
    ipHint: ipHint(c.req.raw),
  });
  return c.json({ id, report_date: reportDate, content }, 201);
});

// GET /daily — list saved snapshots, newest first
reportRoutes.get("/daily", requirePermission("report.view"), async (c) => {
  const { date } = c.req.query();
  const where = date ? "WHERE r.report_date = ?" : "";
  const binds = date ? [date] : [];
  const { results } = await c.env.DB.prepare(
    `SELECT r.id, r.report_date, r.generated_at, r.notes, u.name AS generated_by_name
     FROM daily_reports r LEFT JOIN users u ON u.id = r.generated_by
     ${where}
     ORDER BY r.report_date DESC, r.generated_at DESC
     LIMIT 100`
  ).bind(...binds).all();
  return c.json({ reports: results });
});

async function loadReport(db: D1Database, id: string): Promise<(ReportRow & { parsed: DailyReportContent }) | null> {
  const row = await db.prepare(
    `SELECT r.*, u.name AS generated_by_name
     FROM daily_reports r LEFT JOIN users u ON u.id = r.generated_by
     WHERE r.id = ?`
  ).bind(id).first<ReportRow>();
  if (!row) return null;
  try {
    return { ...row, parsed: JSON.parse(row.content) as DailyReportContent };
  } catch {
    return null;
  }
}

// GET /daily/:id — the immutable snapshot as saved
reportRoutes.get("/daily/:id", requirePermission("report.view"), async (c) => {
  const report = await loadReport(c.env.DB, c.req.param("id"));
  if (!report) return c.json({ error: "Report not found" }, 404);
  return c.json({
    report: {
      id: report.id,
      report_date: report.report_date,
      generated_at: report.generated_at,
      generated_by_name: report.generated_by_name ?? null,
      notes: report.notes,
      content: report.parsed,
    },
  });
});

// GET /daily/:id/xlsx — Excel export of the snapshot
reportRoutes.get("/daily/:id/xlsx", requirePermission("report.view"), async (c) => {
  const report = await loadReport(c.env.DB, c.req.param("id"));
  if (!report) return c.json({ error: "Report not found" }, 404);
  const s = report.parsed;

  const wb = utils.book_new();
  utils.book_append_sheet(wb, utils.json_to_sheet(s.scheduled.map((r) => ({
    Venue: r.venue,
    Activity: r.activity_type,
    Start: r.start_time ?? "",
    End: r.end_time ?? "",
    Event: r.event_title,
    Organisation: r.organisation_name ?? "",
    Status: r.event_status,
  }))), "Scheduled");
  const taskRows = (tasks: DailyReportContent["system_tasks"]) => tasks.map((t) => ({
    Task: t.title,
    Status: t.status,
    Priority: t.priority,
    Due: t.due_date ?? "",
    Event: t.event_title ?? "",
    Assignee: t.assignee_name ?? "",
  }));
  utils.book_append_sheet(wb, utils.json_to_sheet(taskRows(s.system_tasks)), "System Tasks");
  utils.book_append_sheet(wb, utils.json_to_sheet(taskRows(s.manual_tasks)), "Manual Tasks");
  utils.book_append_sheet(wb, utils.json_to_sheet([
    ...s.work_achieved.tasks_completed.map((t) => ({
      Type: "Task completed", Item: t.title, Event: t.event_title ?? "", By: t.completed_by_name ?? "", Detail: t.completion_note ?? "",
    })),
    ...s.work_achieved.checklist_completed.map((ci) => ({
      Type: "Checklist completed", Item: ci.label, Event: ci.event_title ?? "", By: ci.completed_by_name ?? "", Detail: `${ci.module} · ${ci.section}`,
    })),
    ...s.work_achieved.status_changes.map((sc) => ({
      Type: "Status change", Item: `${sc.from_status ?? "—"} → ${sc.to_status}`, Event: sc.event_title ?? "", By: sc.changed_by_name ?? "", Detail: sc.reason ?? "",
    })),
  ]), "Work Achieved");
  utils.book_append_sheet(wb, utils.json_to_sheet(s.outstanding.map((t) => ({
    Task: t.title,
    Status: t.status,
    Priority: t.priority,
    Due: t.due_date ?? "",
    "Days Overdue": t.days_overdue,
    Event: t.event_title ?? "",
    Assignee: t.assignee_name ?? "",
  }))), "Outstanding");

  const bytes = write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="daily-report-${report.report_date}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
});

// GET /daily/:id/pdf — print-ready HTML (save as PDF via the browser dialog)
reportRoutes.get("/daily/:id/pdf", requirePermission("report.view"), async (c) => {
  const report = await loadReport(c.env.DB, c.req.param("id"));
  if (!report) return c.json({ error: "Report not found" }, 404);
  return c.html(renderPrintableReport(report.parsed, report.generated_by_name ?? null, report.notes));
});

function esc(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function tableSection(title: string, headers: string[], rows: string[][]): string {
  const body = rows.length
    ? rows.map((r) => `<tr>${r.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${headers.length}" class="empty">Nothing recorded</td></tr>`;
  return `<section>
    <h2>${esc(title)}</h2>
    <table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table>
  </section>`;
}

function renderPrintableReport(s: DailyReportContent, generatedByName: string | null, notes: string | null): string {
  const taskRows = (tasks: DailyReportContent["system_tasks"]) =>
    tasks.map((t) => [esc(t.title), esc(t.status), esc(t.priority), esc(t.due_date), esc(t.event_title), esc(t.assignee_name)]);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Daily Operational Report — ${esc(s.report_date)}</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; color: #2f2c27; margin: 32px; }
  h1 { font-size: 22px; margin-bottom: 2px; }
  .meta { color: #6b675f; font-size: 12px; margin-bottom: 20px; }
  h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.08em; border-bottom: 1px solid #cfcabf; padding-bottom: 4px; margin: 22px 0 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; color: #6b675f; font-weight: 600; padding: 4px 8px; border-bottom: 1px solid #e0dcd2; }
  td { padding: 4px 8px; border-bottom: 1px solid #eeebe4; vertical-align: top; }
  td.empty { color: #9a958a; font-style: italic; }
  .toolbar { margin-bottom: 16px; }
  .toolbar button { font: inherit; padding: 6px 16px; }
  @media print { .toolbar { display: none; } body { margin: 8px; } }
</style>
</head>
<body>
<div class="toolbar"><button onclick="window.print()">Print / Save as PDF</button></div>
<h1>Daily Operational Report — ${esc(s.report_date)}</h1>
<div class="meta">Generated ${esc(s.generated_at)}${generatedByName ? ` by ${esc(generatedByName)}` : ""}${notes ? ` · ${esc(notes)}` : ""}</div>
${tableSection("Scheduled", ["Venue", "Activity", "Start", "End", "Event", "Organisation", "Status"],
    s.scheduled.map((r) => [esc(r.venue), esc(r.activity_type), esc(r.start_time), esc(r.end_time), esc(r.event_title), esc(r.organisation_name), esc(r.event_status)]))}
${tableSection("System Tasks", ["Task", "Status", "Priority", "Due", "Event", "Assignee"], taskRows(s.system_tasks))}
${tableSection("Manual Tasks", ["Task", "Status", "Priority", "Due", "Event", "Assignee"], taskRows(s.manual_tasks))}
${tableSection("Work Achieved", ["Type", "Item", "Event", "By", "Detail"], [
    ...s.work_achieved.tasks_completed.map((t) => ["Task completed", esc(t.title), esc(t.event_title), esc(t.completed_by_name), esc(t.completion_note)]),
    ...s.work_achieved.checklist_completed.map((ci) => ["Checklist completed", esc(ci.label), esc(ci.event_title), esc(ci.completed_by_name), esc(`${ci.module} · ${ci.section}`)]),
    ...s.work_achieved.status_changes.map((sc) => ["Status change", esc(`${sc.from_status ?? "—"} → ${sc.to_status}`), esc(sc.event_title), esc(sc.changed_by_name), esc(sc.reason)]),
  ])}
${tableSection("Outstanding", ["Task", "Status", "Priority", "Due", "Days Overdue", "Event", "Assignee"],
    s.outstanding.map((t) => [esc(t.title), esc(t.status), esc(t.priority), esc(t.due_date), String(t.days_overdue), esc(t.event_title), esc(t.assignee_name)]))}
</body>
</html>`;
}
