/**
 * Daily operational report routes.
 *   POST /daily          — generate + save an immutable snapshot (report.generate)
 *                          `type`: 'morning' | 'evening' (the twice-daily
 *                          briefs) or 'daily' (legacy full-day snapshot).
 *   GET  /daily          — list saved reports (?date= filter)     (report.view)
 *   GET  /daily/:id      — one saved snapshot                     (report.view)
 *   DELETE /daily/:id    — remove a saved snapshot from the list  (report.generate)
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
import { buildBriefContent, type BriefContent, type EveningBriefContent, type MorningBriefContent } from "../lib/brief";
import { renderBriefPrintable } from "../lib/brief-html";

export const reportRoutes = new Hono<AuthEnv>();

const GenerateInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().nullish(),
  type: z.enum(["daily", "morning", "evening"]).optional(),
});

type ReportRow = {
  id: string;
  report_date: string;
  report_type: string;
  generated_by: string | null;
  generated_at: string;
  content: string;
  notes: string | null;
  generated_by_name?: string | null;
};

type ReportContent = DailyReportContent | BriefContent;

// POST /daily — generate a snapshot (defaults to today in Asia/Kolkata)
reportRoutes.post("/daily", requirePermission("report.generate"), async (c) => {
  const parsed = GenerateInput.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Invalid input", detail: parsed.error.flatten() }, 400);
  const user = c.get("user")!;
  const db = c.env.DB;
  const reportDate = parsed.data.date ?? istToday();
  const reportType = parsed.data.type ?? "daily";

  const content: ReportContent = reportType === "daily"
    ? await buildDailyReportContent(db, reportDate)
    : await buildBriefContent(db, reportType, reportDate);
  const id = makeId("rep");
  await db.prepare(
    `INSERT INTO daily_reports (id, report_date, report_type, generated_by, generated_at, content, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, reportDate, reportType, user.id, content.generated_at, JSON.stringify(content), parsed.data.notes ?? null).run();

  await audit({
    db, actor: actorFrom(user), action: "report.generated",
    targetType: "daily_report", targetId: id, detail: { reportDate, reportType },
    ipHint: ipHint(c.req.raw),
  });
  return c.json({ id, report_date: reportDate, report_type: reportType, content }, 201);
});

// GET /daily — list saved snapshots, newest first
reportRoutes.get("/daily", requirePermission("report.view"), async (c) => {
  const { date } = c.req.query();
  const where = date ? "WHERE r.report_date = ?" : "";
  const binds = date ? [date] : [];
  const { results } = await c.env.DB.prepare(
    `SELECT r.id, r.report_date, r.report_type, r.generated_at, r.notes, u.name AS generated_by_name
     FROM daily_reports r LEFT JOIN users u ON u.id = r.generated_by
     ${where}
     ORDER BY r.report_date DESC, r.generated_at DESC
     LIMIT 100`
  ).bind(...binds).all();
  return c.json({ reports: results });
});

async function loadReport(db: D1Database, id: string): Promise<(ReportRow & { parsed: ReportContent }) | null> {
  const row = await db.prepare(
    `SELECT r.*, u.name AS generated_by_name
     FROM daily_reports r LEFT JOIN users u ON u.id = r.generated_by
     WHERE r.id = ?`
  ).bind(id).first<ReportRow>();
  if (!row) return null;
  try {
    return { ...row, parsed: JSON.parse(row.content) as ReportContent };
  } catch {
    return null;
  }
}

function isBrief(content: ReportContent): content is BriefContent {
  return "brief_type" in content;
}

// GET /daily/:id — the immutable snapshot as saved
reportRoutes.get("/daily/:id", requirePermission("report.view"), async (c) => {
  const report = await loadReport(c.env.DB, c.req.param("id"));
  if (!report) return c.json({ error: "Report not found" }, 404);
  return c.json({
    report: {
      id: report.id,
      report_date: report.report_date,
      report_type: report.report_type ?? "daily",
      generated_at: report.generated_at,
      generated_by_name: report.generated_by_name ?? null,
      notes: report.notes,
      content: report.parsed,
    },
  });
});

// DELETE /daily/:id — remove a saved snapshot. Snapshots are immutable while
// they exist, but they can be removed from the list (e.g. an accidental manual
// generation). The deletion is recorded in the audit log.
reportRoutes.delete("/daily/:id", requirePermission("report.generate"), async (c) => {
  const db = c.env.DB;
  const user = c.get("user")!;
  const id = c.req.param("id");
  const row = await db.prepare(
    "SELECT id, report_date, report_type FROM daily_reports WHERE id = ?"
  ).bind(id).first<{ id: string; report_date: string; report_type: string | null }>();
  if (!row) return c.json({ error: "Report not found" }, 404);

  await db.prepare("DELETE FROM daily_reports WHERE id = ?").bind(id).run();
  await audit({
    db, actor: actorFrom(user), action: "report.deleted",
    targetType: "daily_report", targetId: id,
    detail: { reportDate: row.report_date, reportType: row.report_type ?? "daily" },
    ipHint: ipHint(c.req.raw),
  });
  return c.json({ ok: true });
});

function briefWorkbook(content: BriefContent) {
  const wb = utils.book_new();
  const taskSheet = (tasks: Array<{ title: string; priority: string; due_date: string | null; event_title: string | null; assignee_name: string | null }>) =>
    utils.json_to_sheet(tasks.map((t) => ({
      Task: t.title, Priority: t.priority, Due: t.due_date ?? "", Event: t.event_title ?? "", Assignee: t.assignee_name ?? "Unassigned",
    })));

  if (content.brief_type === "morning") {
    const s = content as MorningBriefContent;
    utils.book_append_sheet(wb, utils.json_to_sheet([
      ...s.decisions.approvals_pending.map((a) => ({ Type: "VFH approval pending", Item: a.event_title, Detail: a.organisation_name ?? "", Date: a.event_start_date ?? "" })),
      ...s.decisions.conflicts.map((cf) => ({ Type: cf.level === "conflict" ? "Venue conflict" : "Potential conflict", Item: `${cf.a.event_title} / ${cf.b.event_title}`, Detail: cf.venue, Date: cf.activity_date })),
      ...s.decisions.unassigned_high_priority.map((t) => ({ Type: "Unassigned high priority", Item: t.title, Detail: t.event_title ?? "", Date: t.due_date ?? "" })),
      ...s.decisions.stale_enquiries.map((e) => ({ Type: "Stale enquiry", Item: e.event_title, Detail: `${e.organisation_name ?? ""} — quiet ${e.days_quiet}d`, Date: e.enquiry_date ?? "" })),
    ]), "Needs Decision");
    utils.book_append_sheet(wb, utils.json_to_sheet(s.today_schedule.map((r) => ({
      Venue: r.venue, Activity: r.activity_type, Start: r.start_time ?? "", End: r.end_time ?? "", Event: r.event_title, Organisation: r.organisation_name ?? "", Status: r.event_status,
    }))), "Today Schedule");
    utils.book_append_sheet(wb, taskSheet(s.team_plan.flatMap((g) => g.tasks)), "Team Plan");
    utils.book_append_sheet(wb, utils.json_to_sheet([
      ...s.risk_radar.low_readiness.map((e) => ({ Risk: "Low readiness", Item: e.event_title, Detail: `${Math.round(e.overall_completion * 100)}% ready, starts in ${e.days_to_event}d`, Date: e.event_start_date ?? "" })),
      ...s.risk_radar.blocked_items.map((b) => ({ Risk: "Blocked checklist item", Item: b.label, Detail: `${b.event_title} (${b.module} · ${b.section})`, Date: "" })),
      ...s.risk_radar.overdue_instalments.map((t) => ({ Risk: "Overdue payment follow-up", Item: t.title, Detail: t.event_title ?? "", Date: t.due_date ?? "" })),
      ...s.risk_radar.unsigned_confirmations.map((e) => ({ Risk: "Unsigned confirmation", Item: e.event_title, Detail: e.confirmation_status ?? "none", Date: e.event_start_date ?? "" })),
    ]), "Risk Radar");
    utils.book_append_sheet(wb, utils.json_to_sheet(s.overdue.oldest.map((t) => ({
      Task: t.title, Priority: t.priority, Due: t.due_date ?? "", "Days Overdue": t.days_overdue, Event: t.event_title ?? "", Assignee: t.assignee_name ?? "Unassigned",
    }))), "Overdue");
  } else {
    const s = content as EveningBriefContent;
    utils.book_append_sheet(wb, utils.json_to_sheet([
      { Metric: "Tasks due today", Value: s.scoreboard.due_today },
      { Metric: "Completed of due", Value: s.scoreboard.done_of_due },
      { Metric: "Slipped", Value: s.scoreboard.still_open },
      { Metric: "Completion rate", Value: `${Math.round(s.scoreboard.completion_rate * 100)}%` },
      { Metric: "Completed in total", Value: s.scoreboard.done_today_total },
      { Metric: "Checklist due / done", Value: `${s.scoreboard.checklist_due} / ${s.scoreboard.checklist_done}` },
    ]), "Scoreboard");
    utils.book_append_sheet(wb, utils.json_to_sheet(s.done_by_person.flatMap((p) => [
      ...p.tasks.map((t) => ({ By: p.person, Type: "Task", Item: t.title, Event: t.event_title ?? "", Detail: t.completion_note ?? "" })),
      ...p.checklist.map((ci) => ({ By: p.person, Type: "Checklist", Item: ci.label, Event: ci.event_title ?? "", Detail: `${ci.module} · ${ci.section}` })),
    ])), "Done");
    utils.book_append_sheet(wb, taskSheet(s.slipped.flatMap((g) => g.tasks)), "Slipped");
    utils.book_append_sheet(wb, utils.json_to_sheet([
      ...s.new_today.enquiries.map((e) => ({ Type: "Enquiry", Item: e.event_title, Detail: `${e.organisation_name ?? ""} · ${e.enquiry_source ?? ""}` })),
      ...s.new_today.status_changes.map((sc) => ({ Type: "Status change", Item: sc.event_title ?? "", Detail: `${sc.from_status ?? "—"} → ${sc.to_status}${sc.changed_by_name ? ` by ${sc.changed_by_name}` : ""}` })),
    ]), "New Today");
    utils.book_append_sheet(wb, utils.json_to_sheet(s.tomorrow.schedule.map((r) => ({
      Venue: r.venue, Activity: r.activity_type, Start: r.start_time ?? "", End: r.end_time ?? "", Event: r.event_title, Organisation: r.organisation_name ?? "",
    }))), "Tomorrow");
    utils.book_append_sheet(wb, utils.json_to_sheet(s.trend.map((t) => ({
      Date: t.date, Due: t.due, Done: t.done, "Completion %": t.due ? Math.round((t.done / t.due) * 100) : "",
    }))), "Trend");
  }
  return wb;
}

// GET /daily/:id/xlsx — Excel export of the snapshot
reportRoutes.get("/daily/:id/xlsx", requirePermission("report.view"), async (c) => {
  const report = await loadReport(c.env.DB, c.req.param("id"));
  if (!report) return c.json({ error: "Report not found" }, 404);

  if (isBrief(report.parsed)) {
    const bytes = write(briefWorkbook(report.parsed), { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    return new Response(bytes, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${report.parsed.brief_type}-brief-${report.report_date}.xlsx"`,
        "Cache-Control": "private, no-store",
      },
    });
  }
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
  if (isBrief(report.parsed)) {
    return c.html(renderBriefPrintable(report.parsed, c.env.APP_URL ?? "", report.generated_by_name ?? null, report.notes));
  }
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
