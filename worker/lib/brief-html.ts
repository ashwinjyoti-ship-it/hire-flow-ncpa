/**
 * HTML renderer for the Morning Brief / Evening Debrief. One renderer serves
 * both the email digest and the print-ready view (GET /reports/daily/:id/pdf),
 * so the manager sees the same document in her inbox and in the app. Email
 * clients need conservative markup: tables, inline styles, no scripts.
 */
import { STATUS_LABELS, type EventStatus } from "./state-machine";
import type { ReportTask } from "./daily-report";
import { buildMorningAttention, conflictAttentionLabel, type AssigneeTasks, type BriefContent, type EveningBriefContent, type MorningAttentionItem, type MorningBriefContent } from "./brief";
import { buildPrintablePageHtml } from "../../shared/printable-html";

function esc(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function statusLabel(status: string | null | undefined): string {
  if (!status) return "";
  return STATUS_LABELS[status as EventStatus] ?? status.replace(/_/g, " ");
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function fmtTime(start: string | null, end: string | null): string {
  if (!start) return "—";
  return end ? `${start}–${end}` : start;
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  })} · ${d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  })} IST`;
}

const S = {
  h2: "font-size:13px;text-transform:uppercase;letter-spacing:0.08em;color:#5d6b52;border-bottom:1px solid #cfcabf;padding-bottom:4px;margin:24px 0 8px;font-family:Georgia,serif;",
  table: "width:100%;border-collapse:collapse;font-size:12px;font-family:Georgia,serif;",
  th: "text-align:left;color:#6b675f;font-weight:600;padding:4px 8px;border-bottom:1px solid #e0dcd2;",
  td: "padding:4px 8px;border-bottom:1px solid #eeebe4;vertical-align:top;color:#2f2c27;",
  empty: "padding:6px 8px;color:#9a958a;font-style:italic;",
  good: "color:#4a6741;",
  bad: "color:#a4442e;",
  link: "color:#2f2c27;text-decoration:underline;text-decoration-color:#a8b39c;",
};

function eventLink(
  baseUrl: string,
  id: string | null | undefined,
  title: string | null | undefined,
  tab?: string,
  fieldKey?: string,
): string {
  const t = esc(title ?? "—");
  if (!id) return t;
  const params = new URLSearchParams();
  if (tab) params.set("tab", tab);
  if (fieldKey) params.set("field", fieldKey);
  const query = params.toString();
  const href = `${baseUrl}/events/${id}${query ? `?${query}` : ""}`;
  return `<a href="${esc(href)}" style="${S.link}">${t}</a>`;
}

function appPathLink(baseUrl: string, path: string, label: string): string {
  return `<a href="${esc(absoluteHref(baseUrl, path))}" style="${S.link}">${esc(label)}</a>`;
}

function section(title: string, inner: string): string {
  return `<h2 style="${S.h2}">${esc(title)}</h2>${inner}`;
}

function table(headers: string[], rows: string[][], emptyText = "Nothing recorded"): string {
  const body = rows.length
    ? rows.map((r) => `<tr>${r.map((c) => `<td style="${S.td}">${c}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${headers.length}" style="${S.empty}">${esc(emptyText)}</td></tr>`;
  return `<table style="${S.table}" cellspacing="0" cellpadding="0"><thead><tr>${headers
    .map((h) => `<th style="${S.th}">${esc(h)}</th>`)
    .join("")}</tr></thead><tbody>${body}</tbody></table>`;
}

function headlineStrip(cells: Array<{ label: string; value: string; tone?: "good" | "bad" }>): string {
  const tds = cells
    .map(
      (c) => `<td style="padding:8px 14px 8px 0;">
        <div style="font-size:20px;font-weight:700;font-family:Georgia,serif;${c.tone === "bad" ? S.bad : c.tone === "good" ? S.good : "color:#2f2c27;"}">${esc(c.value)}</div>
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:#6b675f;">${esc(c.label)}</div>
      </td>`
    )
    .join("");
  return `<table cellspacing="0" cellpadding="0" style="font-family:Georgia,serif;"><tr>${tds}</tr></table>`;
}

function priorityBadge(priority: string): string {
  const style = priority === "high"
    ? "background:#f6e3df;color:#a4442e;"
    : priority === "medium"
      ? "background:#f9ecdd;color:#b06a2a;"
      : "background:#f0eee8;color:#6b675f;";
  return `<span style="display:inline-block;border-radius:9px;padding:1px 8px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;${style}">${esc(priority)}</span>`;
}

function assigneeCell(name: string | null): string {
  if (name) return esc(name);
  return `<span style="display:inline-block;border-radius:9px;padding:1px 8px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;background:#faf0d9;color:#b06a2a;">Unassigned</span>`;
}

function taskRows(baseUrl: string, tasks: ReportTask[], extra?: (t: ReportTask) => string[]): string[][] {
  return tasks.map((t) => [
    esc(t.title),
    priorityBadge(t.priority),
    fmtDate(t.due_date),
    eventLink(baseUrl, t.event_id, t.event_title),
    assigneeCell(t.assignee_name),
    ...(extra ? extra(t) : []),
  ]);
}

function teamPlanSection(baseUrl: string, groups: AssigneeTasks[], emptyText: string): string {
  if (!groups.length) return `<p style="${S.empty}">${esc(emptyText)}</p>`;
  return groups
    .map((g) => {
      const name = g.assignee ?? "Unassigned";
      const warn = g.assignee ? "" : ` <span style="${S.bad}">— needs an owner</span>`;
      return `<p style="margin:10px 0 4px;font-size:12px;font-weight:700;font-family:Georgia,serif;color:#2f2c27;">${esc(name)} (${g.tasks.length})${warn}</p>` +
        table(["Task", "Priority", "Due", "Event", ""], g.tasks.map((t) => [
          esc(t.title), priorityBadge(t.priority), fmtDate(t.due_date), eventLink(baseUrl, t.event_id, t.event_title), esc(t.task_type),
        ]));
    })
    .join("");
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function emailNote(text: string, tone: "default" | "good" | "bad" = "default"): string {
  const color = tone === "good" ? "#4a6741" : tone === "bad" ? "#a4442e" : "#544f47";
  return `<p style="margin:0;font-size:14px;line-height:22px;color:${color};font-family:Arial,Helvetica,sans-serif;">${esc(text)}</p>`;
}

function emailSection(title: string, inner: string): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:separate;border-spacing:0;margin-top:16px;background:#fffdf9;border:1px solid #e8e1d7;border-radius:16px;">
    <tr>
      <td style="padding:18px 18px 16px;">
        <div style="margin:0 0 12px;font-size:15px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#5d6b52;font-family:Georgia,serif;">${esc(title)}</div>
        ${inner}
      </td>
    </tr>
  </table>`;
}

function emailSubsection(title: string): string {
  return `<div style="margin:16px 0 8px;font-size:14px;font-weight:700;color:#2f2c27;font-family:Arial,Helvetica,sans-serif;">${esc(title)}</div>`;
}

function emailMetricGrid(cells: Array<{ label: string; value: string; tone?: "good" | "bad" }>): string {
  const rows = chunk(cells, 2).map((pair) => {
    const cols = pair.map((c) => {
      const color = c.tone === "good" ? "#4a6741" : c.tone === "bad" ? "#a4442e" : "#2f2c27";
      return `<td style="width:50%;padding:0 8px 8px 0;vertical-align:top;">
        <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:separate;border-spacing:0;background:#f6f1e8;border:1px solid #e4dccf;border-radius:14px;">
          <tr><td style="padding:14px 14px 12px;">
            <div style="font-size:24px;line-height:28px;font-weight:700;color:${color};font-family:Georgia,serif;">${esc(c.value)}</div>
            <div style="margin-top:6px;font-size:11px;line-height:16px;letter-spacing:0.06em;text-transform:uppercase;color:#766f66;font-family:Arial,Helvetica,sans-serif;">${esc(c.label)}</div>
          </td></tr>
        </table>
      </td>`;
    }).join("");
    const filler = pair.length === 1 ? `<td style="width:50%;padding:0 8px 8px 0;vertical-align:top;"></td>` : "";
    return `<tr>${cols}${filler}</tr>`;
  }).join("");
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;"><tbody>${rows}</tbody></table>`;
}

function emailRecordList(headers: string[], rows: string[][], emptyText = "Nothing recorded"): string {
  if (!rows.length) return emailNote(emptyText);
  return rows.map((row) => {
    const fields = headers.map((header, index) => {
      const isLast = index === headers.length - 1;
      return `<tr>
        <td style="padding:${index === 0 ? "0" : "10px"} 0 ${isLast ? "0" : "0"};">
          <div style="font-size:10px;line-height:14px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#8b8478;font-family:Arial,Helvetica,sans-serif;">${esc(header)}</div>
          <div style="margin-top:3px;font-size:14px;line-height:21px;color:#2f2c27;font-family:Arial,Helvetica,sans-serif;word-break:break-word;">${row[index] || "—"}</div>
        </td>
      </tr>`;
    }).join("");
    return `<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:separate;border-spacing:0;background:#f9f6ef;border:1px solid #ece4d8;border-radius:14px;margin-top:10px;">
      <tr>
        <td style="padding:14px;">${fields}</td>
      </tr>
    </table>`;
  }).join("");
}

function absoluteHref(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

function emailCompactActions(baseUrl: string, items: MorningAttentionItem[], emptyText: string): string {
  if (!items.length) return emailNote(emptyText, "good");
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;">${items.map((item, index) => {
    const extra = item.signals.length - 1;
    const meta = [item.event_start_date ? fmtDate(item.event_start_date) : "", item.organisation_name ?? ""].filter(Boolean).join(" · ");
    return `<tr><td style="padding:${index ? "12px" : "2px"} 0 12px;border-bottom:1px solid #ece4d8;font-family:Arial,Helvetica,sans-serif;">
      <a href="${esc(absoluteHref(baseUrl, item.href))}" style="font-size:15px;line-height:21px;font-weight:700;color:#2f2c27;text-decoration:underline;text-decoration-color:#a8b39c;">${esc(item.event_title)}</a>
      ${meta ? `<div style="margin-top:2px;font-size:12px;line-height:18px;color:#766f66;">${esc(meta)}</div>` : ""}
      <div style="margin-top:4px;font-size:13px;line-height:19px;color:${item.priority <= 2 ? "#a4442e" : "#544f47"};">${esc(item.primary_action)}${extra > 0 ? ` <b>+${extra} other issue${extra === 1 ? "" : "s"}</b>` : ""} <span aria-hidden="true">→</span></div>
    </td></tr>`;
  }).join("")}</table>`;
}

function emailCountSummary(cells: Array<{ label: string; value: number }>): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin-bottom:10px;"><tr>${cells.map((cell) =>
    `<td style="padding:8px 6px;text-align:center;background:#f6f1e8;border-right:2px solid #fffdf9;font-family:Arial,Helvetica,sans-serif;"><div style="font-size:18px;font-weight:700;color:#2f2c27;">${cell.value}</div><div style="font-size:9px;line-height:13px;text-transform:uppercase;letter-spacing:.04em;color:#766f66;">${esc(cell.label)}</div></td>`
  ).join("")}</tr></table>`;
}

function emailMore(baseUrl: string, shown: number, total: number, label: string): string {
  if (total <= shown) return "";
  return `<p style="margin:10px 0 0;font-size:12px;color:#766f66;font-family:Arial,Helvetica,sans-serif;">Showing ${shown} of ${total}. <a href="${esc(absoluteHref(baseUrl, "/reports"))}" style="color:#4a6741;font-weight:700;">View all ${esc(label)} →</a></p>`;
}

function emailTrend(rows: EveningBriefContent["trend"]): string {
  if (!rows.length) return emailNote("No completion trend available yet.");
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;">${rows.map((row) => {
    const pct = row.due ? Math.round((row.done / row.due) * 100) : null;
    const color = pct === null ? "#9a958a" : pct >= 80 ? "#4a6741" : pct >= 50 ? "#8a6d1f" : "#a4442e";
    const day = new Date(`${row.date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
    return `<tr><td style="padding:7px 0;border-bottom:1px solid #ece4d8;font-size:12px;color:#544f47;">${esc(day)}</td><td style="padding:7px 8px;border-bottom:1px solid #ece4d8;text-align:right;font-size:12px;color:#766f66;">${row.done}/${row.due}</td><td style="padding:7px 0;border-bottom:1px solid #ece4d8;text-align:right;font-size:13px;font-weight:700;color:${color};">${pct == null ? "—" : `${pct}%`}</td></tr>`;
  }).join("")}</table>`;
}

function renderMorningEmail(s: MorningBriefContent, baseUrl: string): string {
  const attention = Array.isArray(s.attention)
    ? s.attention
    : buildMorningAttention({ decisions: s.decisions, risk_radar: s.risk_radar });
  const watchlist = attention.filter((item) => item.is_watchlist);
  const r = s.risk_radar;
  const affectedEvents = new Set([
    ...s.decisions.conflicts.flatMap((conflict) => [conflict.a.event_id, conflict.b.event_id]),
    ...r.low_readiness.map((item) => item.event_id),
    ...r.blocked_items.map((item) => item.event_id),
    ...r.overdue_instalments.flatMap((item) => item.event_id ? [item.event_id] : []),
    ...r.unsigned_confirmations.map((item) => item.event_id),
    ...r.poc_incomplete.map((item) => item.event_id),
  ]).size;
  const totals = r.totals ?? {
    low_readiness: r.low_readiness.length,
    blocked_items: r.blocked_items.length,
    overdue_instalments: r.overdue_instalments.length,
    unsigned_confirmations: r.unsigned_confirmations.length,
    poc_incomplete: r.poc_incomplete.length,
    affected_events: affectedEvents,
  };

  const schedulePreview: MorningAttentionItem[] = s.today_schedule.slice(0, 6).map((event) => ({
    key: `schedule:${event.event_id}:${event.venue}:${event.start_time ?? ""}`,
    event_id: event.event_id,
    event_title: event.event_title,
    organisation_name: event.organisation_name,
    event_start_date: s.report_date,
    primary_action: `${event.venue} · ${event.activity_type.replace(/_/g, " ")} · ${fmtTime(event.start_time, event.end_time)}`,
    signals: [],
    href: `/events/${event.event_id}`,
    priority: 9,
    is_watchlist: false,
  }));
  const teamPreview: MorningAttentionItem[] = s.team_plan.slice(0, 6).map((group) => {
    const lead = group.tasks[0]!;
    return {
      key: `team:${group.assignee ?? "unassigned"}`,
      event_id: lead.event_id,
      event_title: group.assignee ?? "Unassigned",
      organisation_name: null,
      event_start_date: lead.due_date,
      primary_action: `${group.tasks.length} due · ${lead.title}`,
      signals: group.tasks.map((task) => task.title),
      href: lead.event_id ? `/events/${lead.event_id}` : "/tasks",
      priority: group.assignee ? 9 : 3,
      is_watchlist: false,
    };
  });
  const overdueGroups = new Map<string, Array<ReportTask & { days_overdue: number }>>();
  for (const task of s.overdue.oldest) {
    const key = task.event_id ?? `task:${task.id}`;
    overdueGroups.set(key, [...(overdueGroups.get(key) ?? []), task]);
  }
  const overduePreview: MorningAttentionItem[] = [...overdueGroups.entries()].slice(0, 3).map(([key, tasks]) => {
    const lead = tasks[0]!;
    return {
      key,
      event_id: lead.event_id,
      event_title: lead.event_title ?? lead.title,
      organisation_name: lead.assignee_name ? `Owner: ${lead.assignee_name}` : "Unassigned",
      event_start_date: lead.due_date,
      primary_action: `${lead.days_overdue}d overdue · ${lead.title}`,
      signals: tasks.map((task) => task.title),
      href: lead.event_id ? `/events/${lead.event_id}` : "/tasks",
      priority: 1,
      is_watchlist: true,
    };
  });

  const attentionPreview = attention.slice(0, 5);
  const watchlistPreview = watchlist.slice(0, 3);

  return [
    emailMetricGrid([
      { label: "At the venues", value: String(s.headline.scheduled_today) },
      { label: "Tasks due today", value: String(s.headline.tasks_due_today) },
      { label: "Overdue", value: String(s.headline.overdue), tone: s.headline.overdue ? "bad" : "good" },
      { label: "Events needing attention", value: String(attention.length), tone: attention.length ? "bad" : "good" },
      { label: "New enquiries yesterday", value: String(s.headline.new_enquiries_yesterday) },
    ]),
    emailSection("Do now", [
      emailCompactActions(baseUrl, attentionPreview, "Nothing needs your attention today."),
      emailMore(baseUrl, attentionPreview.length, attention.length, "attention items"),
    ].join("")),
    emailSection("Today at the venues", [
      emailCompactActions(baseUrl, schedulePreview, "No venue activity scheduled today."),
      emailMore(baseUrl, schedulePreview.length, s.today_schedule.length, "venue activity"),
    ].join("")),
    emailSection("Team plan", [
      emailCompactActions(baseUrl, teamPreview, "No tasks due today."),
      emailMore(baseUrl, teamPreview.length, s.team_plan.length, "team assignments"),
    ].join("")),
    emailSection("Watchlist", totals.affected_events
      ? [
          emailCountSummary([
            { label: "Affected events", value: totals.affected_events },
            { label: "Low readiness", value: totals.low_readiness },
            { label: "Events with POC gaps", value: totals.poc_incomplete },
            { label: "Unsigned", value: totals.unsigned_confirmations },
          ]),
          emailCompactActions(baseUrl, watchlistPreview, ""),
          emailMore(baseUrl, watchlistPreview.length, watchlist.length, "watchlist events"),
        ].join("")
      : emailNote("No events on the watchlist.", "good")),
    emailSection("Overdue", s.overdue.total
      ? [
          emailCountSummary(s.overdue.buckets.map((bucket) => ({ label: bucket.label, value: bucket.count }))),
          emailCompactActions(baseUrl, overduePreview, ""),
          emailMore(baseUrl, overduePreview.length, s.overdue.total, "overdue work"),
        ].join("")
      : emailNote("Nothing is overdue.", "good")),
    emailSection("Yesterday in one line", emailNote(
      `Yesterday: ${s.yesterday.completed} tasks completed · ${s.yesterday.new_enquiries} new enquiries · ${s.yesterday.confirmations} confirmations won.`,
    )),
  ].join("");
}
function renderEveningEmail(s: EveningBriefContent, baseUrl: string): string {
  const sc = s.scoreboard;
  const pct = Math.round(sc.completion_rate * 100);
  const verdict = sc.due_today === 0
    ? "No tasks were due today."
    : `${sc.done_of_due} of ${sc.due_today} tasks due today were completed (${pct}%)${sc.still_open ? ` — ${sc.still_open} slipped.` : " — a clean sweep."}`;
  const donePreview = s.done_by_person.slice(0, 6);
  const slippedCount = s.slipped.reduce((sum, group) => sum + group.tasks.length, 0);
  const slippedPreview = s.slipped.slice(0, 5);
  const enquiryPreview = s.new_today.enquiries.slice(0, 5);
  const statusPreview = s.new_today.status_changes.slice(0, 5);
  const tomorrowPreview = s.tomorrow.schedule.slice(0, 6);

  return [
    emailMetricGrid([
      { label: "Due today", value: String(sc.due_today) },
      { label: "Done of due", value: `${sc.done_of_due} (${pct}%)`, tone: sc.due_today && pct >= 80 ? "good" : sc.still_open ? "bad" : "good" },
      { label: "Slipped", value: String(sc.still_open), tone: sc.still_open ? "bad" : "good" },
      { label: "Done in total", value: String(sc.done_today_total) },
      { label: "Checklist due / done", value: `${sc.checklist_done}/${sc.checklist_due}` },
    ]),
    emailSection("Plan vs done", emailNote(verdict, sc.still_open ? "bad" : "good")),
    emailSection("What got done", donePreview.length
      ? [
          emailRecordList(
            ["Team member", "Completed", "Highlights"],
            donePreview.map((person) => {
              const highlights = [
                ...person.tasks.map((task) => task.title),
                ...person.checklist.map((item) => item.label),
              ];
              return [esc(person.person), String(highlights.length), esc(highlights.slice(0, 2).join(" · ") || "Completed work") + (highlights.length > 2 ? ` · +${highlights.length - 2} more` : "")];
            }),
          ),
          emailMore(baseUrl, donePreview.length, s.done_by_person.length, "team completions"),
        ].join("")
      : emailNote("Nothing was completed today.")),
    emailSection("Slipped today", slippedPreview.length
      ? [
          emailRecordList(
            ["Owner", "Open", "Next action"],
            slippedPreview.map((group) => [
              esc(group.assignee ?? "Unassigned"),
              String(group.tasks.length),
              esc(group.tasks[0]?.title ?? "Review overdue work") + (group.tasks.length > 1 ? ` · +${group.tasks.length - 1} more` : ""),
            ]),
          ),
          emailMore(baseUrl, slippedPreview.reduce((sum, group) => sum + group.tasks.length, 0), slippedCount, "slipped tasks"),
        ].join("")
      : emailNote("Nothing slipped — everything due today is done.", "good")),
    emailSection("New today", [
      emailSubsection(`Enquiries received (${s.new_today.enquiries.length})`),
      emailRecordList(
        ["Enquiry", "Organisation"],
        enquiryPreview.map((event) => [eventLink(baseUrl, event.event_id, event.event_title), esc(event.organisation_name ?? "—")]),
        "No new enquiries today.",
      ),
      emailMore(baseUrl, enquiryPreview.length, s.new_today.enquiries.length, "new enquiries"),
      emailSubsection(`Status movements (${s.new_today.status_changes.length}${s.new_today.confirmations ? ` · ${s.new_today.confirmations} confirmed` : ""})`),
      emailRecordList(
        ["Event", "Change"],
        statusPreview.map((change) => [
          eventLink(baseUrl, change.event_id, change.event_title),
          `${esc(statusLabel(change.from_status))} → <b>${esc(statusLabel(change.to_status))}</b>`,
        ]),
        "No status changes today.",
      ),
      emailMore(baseUrl, statusPreview.length, s.new_today.status_changes.length, "status movements"),
    ].join("")),
    emailSection("Tomorrow preview", [
      emailNote(`${s.tomorrow.tasks_due} tasks due tomorrow.`),
      emailRecordList(
        ["Event", "Venue · time"],
        tomorrowPreview.map((event) => [
          eventLink(baseUrl, event.event_id, event.event_title),
          esc(`${event.venue} · ${fmtTime(event.start_time, event.end_time)}`),
        ]),
        "No venue activity scheduled tomorrow.",
      ),
      emailMore(baseUrl, tomorrowPreview.length, s.tomorrow.schedule.length, "tomorrow's schedule"),
    ].join("")),
    emailSection("7-day completion trend", emailTrend(s.trend)),
  ].join("");
}
// ------------------------------------------------------------- Morning Brief

function renderMorning(s: MorningBriefContent, baseUrl: string): string {
  const d = s.decisions;
  const decisionsInner =
    d.approvals_pending.length + d.conflicts.length + d.unassigned_high_priority.length + d.stale_enquiries.length === 0
      ? `<p style="${S.good};font-size:13px;font-family:Georgia,serif;">Nothing needs your decision today.</p>`
      : [
          d.approvals_pending.length
            ? `<p style="margin:8px 0 4px;font-size:12px;font-weight:700;">VFH approvals pending (${d.approvals_pending.length})</p>` +
              table(["Event", "Organisation", "Event date", "Approval"], d.approvals_pending.map((a) => [
                eventLink(baseUrl, a.event_id, a.event_title), esc(a.organisation_name ?? "—"), fmtDate(a.event_start_date), esc(a.approval_status ?? "—"),
              ]))
            : "",
          d.conflicts.length
            ? `<p style="margin:8px 0 4px;font-size:12px;font-weight:700;">Venue scheduling reviews (${d.conflicts.length})</p>` +
              table(["Date", "Venue", "Level", "Events"], d.conflicts.map((c) => [
                fmtDate(c.activity_date), esc(c.venue),
                c.level === "conflict" ? `<span style="${S.bad}">Time conflict</span>` : esc(conflictAttentionLabel(c)),
                `${eventLink(baseUrl, c.a.event_id, c.a.event_title)} (${esc(statusLabel(c.a.status))}) · ${eventLink(baseUrl, c.b.event_id, c.b.event_title)} (${esc(statusLabel(c.b.status))})`,
              ]))
            : "",
          d.unassigned_high_priority.length
            ? `<p style="margin:8px 0 4px;font-size:12px;font-weight:700;">High-priority tasks with no owner (${d.unassigned_high_priority.length})</p>` +
              table(["Task", "Priority", "Due", "Event", "Assignee"], taskRows(baseUrl, d.unassigned_high_priority))
            : "",
          d.stale_enquiries.length
            ? `<p style="margin:8px 0 4px;font-size:12px;font-weight:700;">Enquiries gone quiet (${d.stale_enquiries.length})</p>` +
              table(["Enquiry", "Organisation", "Enquiry date", "Quiet for"], d.stale_enquiries.map((e) => [
                eventLink(baseUrl, e.event_id, e.event_title), esc(e.organisation_name ?? "—"), fmtDate(e.enquiry_date), `${e.days_quiet} days`,
              ]))
            : "",
        ].join("");

  const r = s.risk_radar;
  const riskInner =
    r.low_readiness.length + r.blocked_items.length + r.overdue_instalments.length + r.unsigned_confirmations.length + r.poc_incomplete.length === 0
      ? `<p style="${S.good};font-size:13px;font-family:Georgia,serif;">No risks on the radar.</p>`
      : [
          r.low_readiness.length
            ? `<p style="margin:8px 0 4px;font-size:12px;font-weight:700;">Events soon, checklist behind (${r.low_readiness.length})</p>` +
              table(["Event", "Starts", "In", "Ready", "Status"], r.low_readiness.map((e) => [
                eventLink(baseUrl, e.event_id, e.event_title), fmtDate(e.event_start_date), `${e.days_to_event}d`,
                `<span style="${S.bad}">${e.event_form_readiness ?? Math.round((e.overall_completion ?? 0) * 100)}%</span>`, esc(statusLabel(e.status)),
              ]))
            : "",
          r.blocked_items.length
            ? `<p style="margin:8px 0 4px;font-size:12px;font-weight:700;">Blocked checklist items (${r.blocked_items.length})</p>` +
              table(["Item", "Section", "Event"], r.blocked_items.map((b) => [
                esc(b.label), esc(`${b.module} · ${b.section}`), eventLink(baseUrl, b.event_id, b.event_title),
              ]))
            : "",
          r.overdue_instalments.length
            ? `<p style="margin:8px 0 4px;font-size:12px;font-weight:700;">Payment follow-ups overdue (${r.overdue_instalments.length})</p>` +
              table(["Task", "Priority", "Due", "Event", "Assignee"], taskRows(baseUrl, r.overdue_instalments))
            : "",
          r.unsigned_confirmations.length
            ? `<p style="margin:8px 0 4px;font-size:12px;font-weight:700;">Confirmed events without a signed confirmation (${r.unsigned_confirmations.length})</p>` +
              table(["Event", "Organisation", "Starts", "Confirmation"], r.unsigned_confirmations.map((e) => [
                eventLink(baseUrl, e.event_id, e.event_title), esc(e.organisation_name ?? "—"), fmtDate(e.event_start_date), esc((e.confirmation_status ?? "none").replace(/_/g, " ")),
              ]))
            : "",
          r.poc_incomplete.length
            ? `<p style="margin:8px 0 4px;font-size:12px;font-weight:700;">Point of Contact incomplete — cannot confirm (${r.poc_incomplete.length})</p>` +
              table(["Event", "Organisation", "Starts", "POC", "Still needed"], r.poc_incomplete.map((e) => [
                appPathLink(baseUrl, `/events/${e.event_id}/edit?step=0&section=poc`, e.event_title),
                esc(e.organisation_name ?? "—"),
                fmtDate(e.event_start_date),
                `<span style="${S.bad}">${e.filled_count}/${e.total_count}</span>`,
                esc(e.missing_labels.join(", ")),
              ]))
            : "",
        ].join("");

  const overdueSummary = s.overdue.total
    ? table(["Task", "Priority", "Due", "Event", "Assignee", "Overdue"], taskRows(baseUrl, s.overdue.oldest, (t) => [
        `<span style="${S.bad}font-weight:700;">${(t as ReportTask & { days_overdue: number }).days_overdue}d</span>`,
      ]))
    : `<p style="${S.good};font-size:13px;font-family:Georgia,serif;">Nothing is overdue.</p>`;

  return [
    headlineStrip([
      { label: "At the venues", value: String(s.headline.scheduled_today) },
      { label: "Tasks due today", value: String(s.headline.tasks_due_today) },
      { label: "Overdue", value: String(s.headline.overdue), tone: s.headline.overdue ? "bad" : "good" },
      { label: "Need your decision", value: String(s.headline.decisions_needed), tone: s.headline.decisions_needed ? "bad" : "good" },
      { label: "New enquiries yday", value: String(s.headline.new_enquiries_yesterday) },
    ]),
    section("Needs your decision", decisionsInner),
    section("Today at the venues", table(
      ["Venue", "Activity", "Time", "Event", "Organisation", "Status"],
      s.today_schedule.map((e) => [
        esc(e.venue), esc(e.activity_type.replace(/_/g, " ")), fmtTime(e.start_time, e.end_time),
        eventLink(baseUrl, e.event_id, e.event_title), esc(e.organisation_name ?? "—"), esc(statusLabel(e.event_status)),
      ]),
      "No venue activity scheduled today."
    )),
    section("Team plan for today", teamPlanSection(baseUrl, s.team_plan, "No tasks due today.")),
    section("Watchlist", riskInner),
    section("Overdue", overdueSummary),
    section("Yesterday in one line",
      `<p style="font-size:13px;font-family:Georgia,serif;color:#2f2c27;">Yesterday: ${s.yesterday.completed} tasks completed · ${s.yesterday.new_enquiries} new enquiries · ${s.yesterday.confirmations} confirmations won.</p>`),
  ].join("");
}

// ------------------------------------------------------------ Evening Debrief

function renderEvening(s: EveningBriefContent, baseUrl: string): string {
  const sc = s.scoreboard;
  const pct = Math.round(sc.completion_rate * 100);
  const verdict = sc.due_today === 0
    ? "No tasks were due today."
    : `${sc.done_of_due} of ${sc.due_today} tasks due today were completed (${pct}%)${sc.still_open ? ` — ${sc.still_open} slipped` : " — a clean sweep"}.`;

  const doneInner = s.done_by_person.length
    ? s.done_by_person
        .map((p) => {
          const rows: string[][] = [
            ...p.tasks.map((t) => ["Task", esc(t.title), eventLink(baseUrl, null, t.event_title), esc(t.completion_note ?? "")]),
            ...p.checklist.map((c) => ["Checklist", esc(c.label), esc(c.event_title ?? "—"), esc(`${c.module} · ${c.section}`)]),
          ];
          return `<p style="margin:10px 0 4px;font-size:12px;font-weight:700;font-family:Georgia,serif;color:#2f2c27;">${esc(p.person)} (${rows.length})</p>` +
            table(["Type", "Item", "Event", "Detail"], rows);
        })
        .join("")
    : `<p style="${S.empty}">Nothing was completed today.</p>`;

  const trendCells = s.trend
    .map((t) => {
      const p = t.due ? Math.round((t.done / t.due) * 100) : null;
      const label = new Date(`${t.date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
      return `<td style="padding:4px 10px 4px 0;text-align:center;font-family:Georgia,serif;">
        <div style="font-size:13px;font-weight:700;color:${p === null ? "#9a958a" : p >= 80 ? "#4a6741" : p >= 50 ? "#8a6d1f" : "#a4442e"};">${p === null ? "—" : `${p}%`}</div>
        <div style="font-size:10px;color:#6b675f;">${esc(label)}</div>
        <div style="font-size:10px;color:#9a958a;">${t.done}/${t.due}</div>
      </td>`;
    })
    .join("");

  return [
    headlineStrip([
      { label: "Due today", value: String(sc.due_today) },
      { label: "Done of due", value: `${sc.done_of_due} (${pct}%)`, tone: sc.due_today && pct >= 80 ? "good" : sc.still_open ? "bad" : "good" },
      { label: "Slipped", value: String(sc.still_open), tone: sc.still_open ? "bad" : "good" },
      { label: "Done in total", value: String(sc.done_today_total) },
      { label: "Checklist due/done", value: `${sc.checklist_done}/${sc.checklist_due}` },
    ]),
    section("Plan vs done", `<p style="font-size:13px;font-family:Georgia,serif;color:#2f2c27;">${esc(verdict)}</p>`),
    section("What got done", doneInner),
    section("Slipped today", s.slipped.length
      ? teamPlanSection(baseUrl, s.slipped, "")
      : `<p style="${S.good};font-size:13px;font-family:Georgia,serif;">Nothing slipped — everything due today is done.</p>`),
    section("New today", [
      `<p style="margin:8px 0 4px;font-size:12px;font-weight:700;">Enquiries received (${s.new_today.enquiries.length})</p>`,
      table(["Enquiry", "Organisation", "Source"], s.new_today.enquiries.map((e) => [
        eventLink(baseUrl, e.event_id, e.event_title), esc(e.organisation_name ?? "—"), esc(e.enquiry_source ?? "—"),
      ]), "No new enquiries today."),
      `<p style="margin:12px 0 4px;font-size:12px;font-weight:700;">Status movements (${s.new_today.status_changes.length}${s.new_today.confirmations ? ` — ${s.new_today.confirmations} confirmed 🎉` : ""})</p>`,
      table(["Event", "Change", "By", "Reason"], s.new_today.status_changes.map((c) => [
        eventLink(baseUrl, c.event_id, c.event_title),
        `${esc(statusLabel(c.from_status))} → <b>${esc(statusLabel(c.to_status))}</b>`,
        esc(c.changed_by_name ?? "—"), esc(c.reason ?? ""),
      ]), "No status changes today."),
    ].join("")),
    section("Tomorrow preview", [
      `<p style="font-size:12px;font-family:Georgia,serif;color:#2f2c27;margin:4px 0 8px;">${s.tomorrow.tasks_due} tasks due tomorrow.</p>`,
      table(["Venue", "Activity", "Time", "Event", "Organisation"], s.tomorrow.schedule.map((e) => [
        esc(e.venue), esc(e.activity_type.replace(/_/g, " ")), fmtTime(e.start_time, e.end_time),
        eventLink(baseUrl, e.event_id, e.event_title), esc(e.organisation_name ?? "—"),
      ]), "No venue activity scheduled tomorrow."),
    ].join("")),
    section("7-day completion trend", `<table cellspacing="0" cellpadding="0"><tr>${trendCells}</tr></table>`),
  ].join("");
}

// -------------------------------------------------------------------- Public

export function briefTitle(content: BriefContent): string {
  return content.brief_type === "morning"
    ? `Morning Brief — ${fmtDate(content.report_date)}`
    : `Evening Debrief — ${fmtDate(content.report_date)}`;
}

/** Body-only HTML (headline + sections). Shared by email + print document. */
export function renderBriefBody(content: BriefContent, baseUrl: string): string {
  return content.brief_type === "morning" ? renderMorning(content, baseUrl) : renderEvening(content, baseUrl);
}

/** Full email document. */
export function renderBriefEmail(content: BriefContent, baseUrl: string): string {
  const title = briefTitle(content);
  const intro = content.brief_type === "morning"
    ? "A concise start-of-day view of decisions, venue activity, and operational risks."
    : "A clean end-of-day summary of completions, slippages, new activity, and tomorrow's outlook.";
  const body = content.brief_type === "morning" ? renderMorningEmail(content, baseUrl) : renderEveningEmail(content, baseUrl);
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#f4f1ea;">
  <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;background:#f4f1ea;">
    <tr>
      <td style="padding:20px 12px;">
        <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;max-width:680px;margin:0 auto;border-collapse:separate;border-spacing:0;background:#fbf9f4;border:1px solid #e0dcd2;border-radius:18px;">
          <tr>
            <td style="padding:24px 18px 10px;">
              <div style="font-size:12px;line-height:18px;letter-spacing:0.12em;text-transform:uppercase;color:#8b8478;font-family:Arial,Helvetica,sans-serif;">NCPA Venue for Hire</div>
              <h1 style="margin:8px 0 0;font-size:28px;line-height:36px;font-family:Georgia,serif;color:#2f2c27;">${content.brief_type === "morning" ? "☀️" : "🌙"} ${esc(title)}</h1>
              <p style="margin:8px 0 0;font-size:14px;line-height:22px;color:#5f5a52;font-family:Arial,Helvetica,sans-serif;">${esc(intro)}</p>
              <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin-top:16px;">
                <tr>
                  <td style="font-size:12px;line-height:18px;color:#7a7368;font-family:Arial,Helvetica,sans-serif;vertical-align:middle;">Generated ${esc(fmtDateTime(content.generated_at))}</td>
                  <td style="text-align:right;vertical-align:middle;">
                    <a href="${esc(baseUrl)}/reports" style="display:inline-block;padding:10px 14px;border-radius:999px;background:#5d6b52;color:#ffffff;text-decoration:none;font-size:12px;font-weight:700;font-family:Arial,Helvetica,sans-serif;">Open report</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 18px 20px;">
              ${body}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body></html>`;
}

/** Print-ready standalone document (GET /reports/daily/:id/pdf for briefs). */
export function renderBriefPrintable(content: BriefContent, baseUrl: string, generatedByName: string | null, notes: string | null): string {
  const title = briefTitle(content);
  const bodyHtml = `<header>
  <h1>${esc(title)}</h1>
  <p class="meta">Generated ${esc(content.generated_at)}${generatedByName ? ` by ${esc(generatedByName)}` : " automatically"}${notes ? ` · ${esc(notes)}` : ""}</p>
</header>
${renderBriefBody(content, baseUrl)}`;
  return buildPrintablePageHtml({ title, bodyHtml });
}
