/**
 * Reports & Analytics.
 *  - Morning Brief / Evening Debrief: the twice-daily operational briefs —
 *    attention-ordered (needs-your-decision first), generated automatically by
 *    the scheduler at 07:30 / 18:30 IST and emailed to report managers,
 *    and generatable on demand here. Immutable snapshots, like all reports.
 *  - Daily operational report (legacy full-day snapshot) is still available.
 *  - Analytics: the five requested areas over a date range, drawn with
 *    restrained CSS bars (no charting library).
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "../components/PageHeader";
import { apiDelete, apiGet, apiPost } from "../lib/api";
import { formatDate, formatDateTime, formatTimeRange } from "../lib/use-lookups";
import { useAuth } from "../lib/auth";
import { can } from "../lib/can";
import { downloadWordDoc, htmlTableSection } from "../lib/export";
import type { DailyReportContent, ReportTask } from "../../worker/lib/daily-report";
import { buildMorningAttention, conflictAttentionLabel, type BriefContent, type EveningBriefContent, type MorningAttentionItem, type MorningBriefContent } from "../../worker/lib/brief";

function istToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

type ReportType = "morning" | "evening" | "daily";

const TYPE_META: Record<ReportType, { icon: string; label: string }> = {
  morning: { icon: "☀️", label: "Morning Brief" },
  evening: { icon: "🌙", label: "Evening Debrief" },
  daily: { icon: "📋", label: "Full snapshot" },
};

type ReportContent = DailyReportContent | BriefContent;

function isBrief(content: ReportContent): content is BriefContent {
  return "brief_type" in content;
}

type ReportListItem = {
  id: string;
  report_date: string;
  report_type?: ReportType;
  generated_at: string;
  notes: string | null;
  generated_by_name: string | null;
};

type ReportDetail = {
  report: {
    id: string;
    report_date: string;
    report_type?: ReportType;
    generated_at: string;
    generated_by_name: string | null;
    notes: string | null;
    content: ReportContent;
  };
};

export function ReportsPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<"daily" | "analytics">("daily");
  const canGenerate = can(user?.permissions, "report.generate");

  return (
    <div>
      <PageHeader title="Reports & Analytics" subtitle="Morning & evening briefs, daily snapshots and venue analytics" />
      <div className="mb-4 flex flex-wrap gap-1 print-hidden">
        {([["daily", "Briefs & Reports"], ["analytics", "Analytics"]] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={
              "rounded-full px-4 py-1.5 text-sm font-medium etched " +
              (tab === key ? "bg-terracotta-btn text-terracotta-text carved-btn-terracotta" : "text-ink-secondary hover:bg-marble-shadow/40")
            }
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "daily" ? <DailyReportView canGenerate={canGenerate} /> : <AnalyticsView />}
    </div>
  );
}

// ---------------------------------------------------------------- Daily report

function DailyReportView({ canGenerate }: { canGenerate: boolean }) {
  const qc = useQueryClient();
  const [date, setDate] = useState(istToday);
  const [notes, setNotes] = useState("");
  const [reportType, setReportType] = useState<ReportType>("morning");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: listData } = useQuery({
    queryKey: ["daily-reports"],
    queryFn: () => apiGet<{ reports: ReportListItem[] }>("/reports/daily"),
  });

  const { data: detail } = useQuery({
    queryKey: ["daily-report", selectedId],
    queryFn: () => apiGet<ReportDetail>(`/reports/daily/${selectedId}`),
    enabled: Boolean(selectedId),
  });

  const generate = useMutation({
    mutationFn: () => apiPost<{ id: string }>("/reports/daily", { date, notes: notes.trim() || null, type: reportType }),
    onSuccess: (res) => {
      setNotes("");
      setSelectedId(res.id);
      qc.invalidateQueries({ queryKey: ["daily-reports"] });
    },
  });

  const deleteReport = useMutation({
    mutationFn: (id: string) => apiDelete<{ ok: boolean }>(`/reports/daily/${id}`),
    onSuccess: (_res, id) => {
      if (selectedId === id) setSelectedId(null);
      qc.invalidateQueries({ queryKey: ["daily-reports"] });
    },
  });

  const report = detail?.report;

  return (
    <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
      <div className="space-y-4 print-hidden">
        {canGenerate && (
          <section className="carved-card rounded-2xl bg-marble-highlight/50 p-5">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-sage etched">Generate report</h3>
            <div className="mb-3 flex flex-wrap gap-1">
              {(Object.keys(TYPE_META) as ReportType[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setReportType(key)}
                  className={
                    "rounded-full px-3 py-1 text-xs font-medium etched " +
                    (reportType === key ? "bg-terracotta-btn text-terracotta-text carved-btn-terracotta" : "text-ink-secondary hover:bg-marble-shadow/40")
                  }
                >
                  {TYPE_META[key].icon} {TYPE_META[key].label}
                </button>
              ))}
            </div>
            <p className="mb-3 text-[11px] text-ink-muted etched">
              Briefs are also generated automatically at 07:30 (morning) and 18:30 (evening) IST and emailed to everyone who can generate reports.
            </p>
            <label className="block">
              <span className="text-xs font-semibold text-ink-secondary etched">Report date (IST)</span>
              <input
                type="date"
                lang="en-GB"
                value={date}
                onChange={(ev) => setDate(ev.target.value)}
                className="carved mt-1 w-full rounded-xl bg-marble-shadow/40 px-3 py-2 text-sm text-ink-primary focus:outline-none"
              />
            </label>
            <label className="mt-3 block">
              <span className="text-xs font-semibold text-ink-secondary etched">Notes (optional)</span>
              <input
                value={notes}
                onChange={(ev) => setNotes(ev.target.value)}
                className="carved mt-1 w-full rounded-xl bg-marble-shadow/40 px-3 py-2 text-sm text-ink-primary focus:outline-none"
                placeholder="Context for this snapshot"
              />
            </label>
            {generate.error && <p role="alert" className="mt-2 text-xs text-status-cancelled etched">{(generate.error as Error).message}</p>}
            <button
              type="button"
              disabled={!date || generate.isPending}
              onClick={() => generate.mutate()}
              className="carved-btn-terracotta mt-3 w-full rounded-full bg-terracotta-btn px-5 py-2 text-sm font-semibold text-terracotta-text etched hover:bg-terracotta-btn-hover disabled:opacity-60"
            >
              {generate.isPending ? "Generating..." : "Generate snapshot"}
            </button>
            <p className="mt-2 text-[11px] text-ink-muted etched">Snapshots are immutable — regenerating a date saves a new snapshot.</p>
          </section>
        )}

        <section className="carved-card rounded-2xl bg-marble-highlight/50 p-5">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-sage etched">Saved reports</h3>
          {(listData?.reports ?? []).length === 0 ? (
            <p className="text-sm text-ink-muted etched">No reports generated yet.</p>
          ) : (
            <ul className="max-h-96 space-y-1 overflow-y-auto scroll-slim">
              {(listData?.reports ?? []).map((r) => (
                <li key={r.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setSelectedId(r.id)}
                    className={
                      "min-w-0 flex-1 rounded-xl px-3 py-2 text-left text-sm transition-colors " +
                      (selectedId === r.id ? "bg-terracotta-btn text-terracotta-text carved-btn-terracotta etched" : "text-ink-secondary hover:bg-marble-shadow/40")
                    }
                  >
                    <span className="font-medium">
                      {TYPE_META[r.report_type ?? "daily"].icon} {formatDate(r.report_date)}
                      <span className="ml-1 text-[11px] font-normal opacity-80">{TYPE_META[r.report_type ?? "daily"].label}</span>
                    </span>
                    <span className="block text-[11px] opacity-80">
                      {formatDateTime(r.generated_at)}
                      {r.generated_by_name ? ` · ${r.generated_by_name}` : " · automatic"}
                    </span>
                  </button>
                  {canGenerate && (
                    <button
                      type="button"
                      title="Delete this saved report"
                      aria-label={`Delete ${TYPE_META[r.report_type ?? "daily"].label} of ${formatDate(r.report_date)}`}
                      disabled={deleteReport.isPending}
                      onClick={() => {
                        if (window.confirm(`Delete the ${TYPE_META[r.report_type ?? "daily"].label} of ${formatDate(r.report_date)}? This cannot be undone.`)) {
                          deleteReport.mutate(r.id);
                        }
                      }}
                      className="shrink-0 rounded-full px-2 py-1 text-sm text-ink-muted transition-colors hover:bg-status-cancelled/10 hover:text-status-cancelled disabled:opacity-50"
                    >
                      ✕
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div>
        {!report ? (
          <div className="carved-card rounded-2xl bg-marble-highlight/50 p-8 text-sm text-ink-muted etched">
            {canGenerate ? "Generate a report or select a saved snapshot to view it." : "Select a saved snapshot to view it."}
          </div>
        ) : (
          <div className="print-area space-y-4">
            <div className="carved-card flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-marble-highlight/50 p-5">
              <div>
                <h2 className="text-lg font-semibold text-ink-primary etched-deep">
                  {TYPE_META[report.report_type ?? "daily"].icon}{" "}
                  {report.report_type === "morning" ? "Morning Brief" : report.report_type === "evening" ? "Evening Debrief" : "Daily Operational Report"}
                  {" — "}{formatDate(report.report_date)}
                </h2>
                <p className="text-xs text-ink-muted etched">
                  Generated {formatDateTime(report.generated_at)}
                  {report.generated_by_name ? ` by ${report.generated_by_name}` : " automatically"}
                  {report.notes ? ` · ${report.notes}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 print-hidden">
                <button type="button" onClick={() => window.print()} className="carved-btn rounded-full bg-neutral-btn px-4 py-2 text-sm font-medium text-ink-secondary etched">
                  Print
                </button>
                <a href={`/api/reports/daily/${report.id}/xlsx`} className="carved-btn rounded-full bg-neutral-btn px-4 py-2 text-sm font-medium text-ink-secondary etched">
                  Excel
                </a>
                <a href={`/api/reports/daily/${report.id}/pdf`} target="_blank" rel="noreferrer" className="carved-btn rounded-full bg-neutral-btn px-4 py-2 text-sm font-medium text-ink-secondary etched">
                  PDF
                </a>
                <button
                  type="button"
                  onClick={() => {
                    const label = TYPE_META[report.report_type ?? "daily"].label;
                    const body = isBrief(report.content) ? briefWordBody(report.content) : dailyReportWordBody(report.content);
                    downloadWordDoc(`${report.report_type ?? "daily"}-report-${report.report_date}`, `${label} — ${formatDate(report.report_date)}`, body);
                  }}
                  className="carved-btn rounded-full bg-neutral-btn px-4 py-2 text-sm font-medium text-ink-secondary etched"
                >
                  Word
                </button>
              </div>
            </div>
            {isBrief(report.content)
              ? report.content.brief_type === "morning"
                ? <MorningBriefView content={report.content} />
                : <EveningBriefView content={report.content} />
              : <ReportSections content={report.content} />}
          </div>
        )}
      </div>
    </div>
  );
}

/** Serialise the snapshot into Word-export table sections. */
function dailyReportWordBody(content: DailyReportContent): string {
  const taskRows = (tasks: DailyReportContent["system_tasks"]) =>
    tasks.map((t) => [t.title, t.status, t.priority, t.due_date, t.event_title, t.assignee_name]);
  return [
    htmlTableSection("Scheduled", ["Venue", "Activity", "Start", "End", "Event", "Organisation", "Status"],
      content.scheduled.map((r) => [r.venue, r.activity_type, r.start_time, r.end_time, r.event_title, r.organisation_name, r.event_status])),
    htmlTableSection("System Tasks", ["Task", "Status", "Priority", "Due", "Event", "Assignee"], taskRows(content.system_tasks)),
    htmlTableSection("Manual Tasks", ["Task", "Status", "Priority", "Due", "Event", "Assignee"], taskRows(content.manual_tasks)),
    htmlTableSection("Work Achieved", ["Type", "Item", "Event", "By", "Detail"], [
      ...content.work_achieved.tasks_completed.map((t) => ["Task completed", t.title, t.event_title, t.completed_by_name, t.completion_note]),
      ...content.work_achieved.checklist_completed.map((ci) => ["Checklist completed", ci.label, ci.event_title, ci.completed_by_name, `${ci.module} · ${ci.section}`]),
      ...content.work_achieved.status_changes.map((sc) => ["Status change", `${sc.from_status ?? "—"} → ${sc.to_status}`, sc.event_title, sc.changed_by_name, sc.reason]),
    ]),
    htmlTableSection("Outstanding", ["Task", "Status", "Priority", "Due", "Days Overdue", "Event", "Assignee"],
      content.outstanding.map((t) => [t.title, t.status, t.priority, t.due_date, t.days_overdue, t.event_title, t.assignee_name])),
  ].join("");
}

function ReportSections({ content }: { content: DailyReportContent }) {
  return (
    <>
      <ReportSection title={`Scheduled (${content.totals.scheduled})`}>
        <ReportTable
          headers={["Venue", "Activity", "Time", "Event", "Organisation", "Status"]}
          rows={content.scheduled.map((r) => [
            r.venue,
            r.activity_type.replace(/_/g, " "),
            r.start_time ? formatTimeRange(r.start_time, r.end_time) : "—",
            <Link key="e" to={`/events/${r.event_id}`} className="underline decoration-sage/40 underline-offset-2">{r.event_title}</Link>,
            r.organisation_name ?? "—",
            r.event_status,
          ])}
        />
      </ReportSection>
      <ReportSection title={`System tasks (${content.totals.system_tasks})`}>
        <TaskTable tasks={content.system_tasks} />
      </ReportSection>
      <ReportSection title={`Manual tasks (${content.totals.manual_tasks})`}>
        <TaskTable tasks={content.manual_tasks} />
      </ReportSection>
      <ReportSection title={`Work achieved (${content.totals.work_achieved})`}>
        <ReportTable
          headers={["Type", "Item", "Event", "By", "Detail"]}
          rows={[
            ...content.work_achieved.tasks_completed.map((t) => ["Task completed", t.title, t.event_title ?? "—", t.completed_by_name ?? "—", t.completion_note ?? ""] as const),
            ...content.work_achieved.checklist_completed.map((ci) => ["Checklist completed", ci.label, ci.event_title ?? "—", ci.completed_by_name ?? "—", `${ci.module} · ${ci.section}`] as const),
            ...content.work_achieved.status_changes.map((sc) => ["Status change", `${sc.from_status ?? "—"} → ${sc.to_status}`, sc.event_title ?? "—", sc.changed_by_name ?? "—", sc.reason ?? ""] as const),
          ].map((r) => [...r])}
        />
      </ReportSection>
      <ReportSection title={`Outstanding (${content.totals.outstanding})`}>
        <ReportTable
          headers={["Task", "Status", "Priority", "Due", "Overdue", "Event", "Assignee"]}
          rows={content.outstanding.map((t) => [
            t.title,
            t.status.replace(/_/g, " "),
            t.priority,
            t.due_date ? formatDate(t.due_date) : "—",
            t.days_overdue > 0 ? `${t.days_overdue}d` : "due today",
            t.event_title ?? "—",
            t.assignee_name ?? "—",
          ])}
        />
      </ReportSection>
    </>
  );
}

function ReportSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="carved-card rounded-2xl bg-marble-highlight/50 p-5">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-sage etched">{title}</h3>
      {children}
    </section>
  );
}

function ReportTable({ headers, rows }: { headers: string[]; rows: React.ReactNode[][] }) {
  if (!rows.length) return <p className="text-sm text-ink-muted etched">Nothing recorded.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h} className="px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-muted etched">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-ink-muted/10">
              {row.map((cell, j) => (
                <td key={j} className="px-2 py-1.5 text-ink-secondary etched">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TaskTable({ tasks }: { tasks: DailyReportContent["system_tasks"] }) {
  return (
    <ReportTable
      headers={["Task", "Status", "Priority", "Due", "Event", "Assignee"]}
      rows={tasks.map((t) => [
        t.title,
        t.status.replace(/_/g, " "),
        t.priority,
        t.due_date ? formatDate(t.due_date) : "—",
        t.event_title ?? "—",
        t.assignee_name ?? "—",
      ])}
    />
  );
}

// ------------------------------------------------------- Morning / Evening briefs

function EventCell({
  id,
  title,
  tab,
  fieldKey,
}: {
  id: string | null;
  title: string | null;
  tab?: string;
  fieldKey?: string;
}) {
  if (!title) return <>—</>;
  if (!id) return <>{title}</>;
  const params = new URLSearchParams();
  if (tab) params.set("tab", tab);
  if (fieldKey) params.set("field", fieldKey);
  const query = params.toString();
  return (
    <Link to={`/events/${id}${query ? `?${query}` : ""}`} className="underline decoration-sage/40 underline-offset-2">
      {title}
    </Link>
  );
}

function SubBlock({ title, tone, children }: { title: string; tone?: "alert" | "ok"; children: React.ReactNode }) {
  return (
    <div className="mt-3 first:mt-0">
      <h4 className={"mb-1.5 text-xs font-semibold uppercase tracking-wider etched " + (tone === "alert" ? "text-status-cancelled" : "text-ink-muted")}>
        {title}
      </h4>
      {children}
    </div>
  );
}

function AllClear({ text }: { text: string }) {
  return <p className="text-sm font-medium text-status-confirmed etched">{text}</p>;
}

function AssigneeCell({ name }: { name: string | null }) {
  if (name) return <>{name}</>;
  return <span className="inline-block rounded-full bg-status-awaitingApproval/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-status-tentative">Unassigned</span>;
}

function OverdueDays({ days }: { days: number }) {
  return <span className="font-semibold text-status-cancelled">{days}d</span>;
}

function AttentionList({ items, limit }: { items: MorningAttentionItem[]; limit: number }) {
  const visible = items.slice(0, limit);
  if (!visible.length) return <AllClear text="Nothing needs your attention today." />;
  return (
    <div className="space-y-2">
      {visible.map((item) => (
        <Link
          key={item.key}
          to={item.href}
          className="flex items-start justify-between gap-3 rounded-xl bg-marble-shadow/30 px-3 py-2.5 transition-colors hover:bg-marble-shadow/50"
        >
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-ink-primary etched-deep">{item.event_title}</span>
            {(item.organisation_name || item.event_start_date) && (
              <span className="mt-0.5 block text-[11px] text-ink-muted etched">
                {[item.organisation_name, item.event_start_date ? formatDate(item.event_start_date) : null].filter(Boolean).join(" · ")}
              </span>
            )}
            <span className={"mt-1 block text-xs font-medium etched " + (item.priority <= 2 ? "text-status-cancelled" : "text-ink-secondary")}>
              {item.primary_action}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2 pt-0.5">
            {item.signals.length > 1 && (
              <span className="rounded-full bg-marble-shadow/60 px-2 py-0.5 text-[10px] font-semibold text-ink-muted">
                +{item.signals.length - 1}
              </span>
            )}
            <span className="text-sage-text" aria-hidden="true">→</span>
          </span>
        </Link>
      ))}
      {items.length > visible.length && (
        <p className="text-xs text-ink-muted etched">Showing {visible.length} of {items.length}. Full detail remains available in the report exports.</p>
      )}
    </div>
  );
}

function MorningBriefView({ content: s }: { content: MorningBriefContent }) {
  const r = s.risk_radar;
  const attention = Array.isArray(s.attention)
    ? s.attention
    : buildMorningAttention({ decisions: s.decisions, risk_radar: r });
  const watchlist = attention.filter((item) => item.is_watchlist);
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
  const overdueByEvent = new Map<string, Array<ReportTask & { days_overdue: number }>>();
  for (const task of s.overdue.oldest) {
    const key = task.event_id ?? `task:${task.id}`;
    overdueByEvent.set(key, [...(overdueByEvent.get(key) ?? []), task]);
  }
  const overduePreview = [...overdueByEvent.values()].slice(0, 3);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="At the venues" value={String(s.headline.scheduled_today)} />
        <Stat label="Tasks due today" value={String(s.headline.tasks_due_today)} />
        <Stat label="Overdue" value={String(s.headline.overdue)} />
        <Stat label="Need attention" value={String(attention.length)} />
        <Stat label="New enquiries yday" value={String(s.headline.new_enquiries_yesterday)} />
      </div>

      <ReportSection title={`Do now (${attention.length})`}>
        <AttentionList items={attention} limit={5} />
      </ReportSection>

      <ReportSection title={`Today at the venues (${s.today_schedule.length})`}>
        {s.today_schedule.length === 0 ? <p className="text-sm text-ink-muted etched">No venue activity scheduled today.</p> : (
          <>
            <ReportTable
              headers={["Venue", "Time", "Event", "Status"]}
              rows={s.today_schedule.slice(0, 6).map((event) => [
                event.venue,
                event.start_time ? formatTimeRange(event.start_time, event.end_time) : "—",
                <EventCell key="event" id={event.event_id} title={event.event_title} />,
                event.event_status,
              ])}
            />
            {s.today_schedule.length > 6 && <p className="mt-2 text-xs text-ink-muted etched">+{s.today_schedule.length - 6} more venue activities in the export.</p>}
          </>
        )}
      </ReportSection>

      <ReportSection title={`Team plan (${s.headline.tasks_due_today})`}>
        {s.team_plan.length === 0 ? <p className="text-sm text-ink-muted etched">No tasks due today.</p> : (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {s.team_plan.slice(0, 6).map((group) => {
              const lead = group.tasks[0]!;
              return (
                <Link key={group.assignee ?? "__unassigned"} to={lead.event_id ? `/events/${lead.event_id}` : "/tasks"} className="rounded-xl bg-marble-shadow/30 p-3 hover:bg-marble-shadow/50">
                  <span className="block text-sm font-semibold text-ink-primary etched-deep">{group.assignee ?? "Unassigned"}</span>
                  <span className="mt-1 block text-xs text-ink-secondary etched">{group.tasks.length} due · {lead.title}</span>
                  {group.tasks.length > 1 && <span className="mt-1 block text-[11px] font-medium text-sage-text">+{group.tasks.length - 1} more</span>}
                </Link>
              );
            })}
          </div>
        )}
      </ReportSection>

      <ReportSection title={`Watchlist (${totals.affected_events} events)`}>
        {totals.affected_events === 0 ? <AllClear text="No events on the watchlist." /> : (
          <>
            <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {[
                ["Low readiness", totals.low_readiness],
                ["Blocked", totals.blocked_items],
                ["Payments", totals.overdue_instalments],
                ["Unsigned", totals.unsigned_confirmations],
                ["Events with POC gaps", totals.poc_incomplete],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-xl bg-marble-shadow/30 px-3 py-2">
                  <span className="block text-lg font-semibold text-ink-primary etched-deep">{value}</span>
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-ink-muted etched">{label}</span>
                </div>
              ))}
            </div>
            <AttentionList items={watchlist} limit={3} />
          </>
        )}
      </ReportSection>

      <ReportSection title={`Overdue (${s.overdue.total})`}>
        {s.overdue.total === 0 ? <AllClear text="Nothing is overdue." /> : (
          <>
            <div className="mb-3 flex flex-wrap gap-2">
              {s.overdue.buckets.map((bucket) => (
                <span key={bucket.label} className="rounded-full bg-marble-shadow/50 px-3 py-1 text-xs text-ink-secondary etched">{bucket.label}: <b>{bucket.count}</b></span>
              ))}
            </div>
            <ReportTable
              headers={["Event", "Oldest action", "Due", "Owner", "Age"]}
              rows={overduePreview.map((tasks) => {
                const lead = tasks[0]!;
                return [
                  <EventCell key="event" id={lead.event_id} title={lead.event_title ?? lead.title} />,
                  <span key="action">{lead.title}{tasks.length > 1 ? ` · +${tasks.length - 1} more` : ""}</span>,
                  lead.due_date ? formatDate(lead.due_date) : "—",
                  <AssigneeCell key="owner" name={lead.assignee_name} />,
                  <OverdueDays key="age" days={lead.days_overdue} />,
                ];
              })}
            />
            {s.overdue.total > overduePreview.length && <p className="mt-2 text-xs text-ink-muted etched">Showing the three oldest event groups. Full overdue detail remains in exports.</p>}
          </>
        )}
      </ReportSection>

      <ReportSection title="Yesterday in one line">
        <p className="text-sm text-ink-secondary etched">
          Yesterday: {s.yesterday.completed} tasks completed · {s.yesterday.new_enquiries} new enquiries · {s.yesterday.confirmations} confirmations won.
        </p>
      </ReportSection>
    </>
  );
}
function EveningBriefView({ content: s }: { content: EveningBriefContent }) {
  const sc = s.scoreboard;
  const pct = Math.round(sc.completion_rate * 100);
  const verdict = sc.due_today === 0
    ? "No tasks were due today."
    : `${sc.done_of_due} of ${sc.due_today} tasks due today were completed (${pct}%)${sc.still_open ? ` — ${sc.still_open} slipped.` : " — a clean sweep."}`;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Due today" value={String(sc.due_today)} />
        <Stat label="Done of due" value={`${sc.done_of_due} (${pct}%)`} />
        <Stat label="Slipped" value={String(sc.still_open)} />
        <Stat label="Done in total" value={String(sc.done_today_total)} />
        <Stat label="Checklist done/due" value={`${sc.checklist_done}/${sc.checklist_due}`} />
      </div>

      <ReportSection title="Plan vs done">
        <p className="text-sm font-medium text-ink-primary etched-deep">{verdict}</p>
      </ReportSection>

      <ReportSection title="What got done">
        {s.done_by_person.length === 0 ? <p className="text-sm text-ink-muted etched">Nothing was completed today.</p> : (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {s.done_by_person.slice(0, 6).map((p) => {
              const highlights = [...p.tasks.map((task) => task.title), ...p.checklist.map((item) => item.label)];
              return (
                <div key={p.person} className="rounded-xl bg-marble-shadow/30 p-3">
                  <p className="text-sm font-semibold text-ink-primary etched-deep">{p.person} · {highlights.length} completed</p>
                  <p className="mt-1 text-xs text-ink-secondary etched">{highlights.slice(0, 2).join(" · ")}{highlights.length > 2 ? ` · +${highlights.length - 2} more` : ""}</p>
                </div>
              );
            })}
          </div>
        )}
      </ReportSection>

      <ReportSection title="Slipped today">
        {s.slipped.length === 0
          ? <AllClear text="Nothing slipped — everything due today is done." />
          : <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {s.slipped.slice(0, 6).map((group) => (
                <div key={group.assignee ?? "__unassigned"} className="rounded-xl bg-marble-shadow/30 p-3">
                  <p className="text-sm font-semibold text-ink-primary etched-deep">{group.assignee ?? "Unassigned"} · {group.tasks.length} slipped</p>
                  <p className="mt-1 text-xs text-ink-secondary etched">{group.tasks[0]?.title}{group.tasks.length > 1 ? ` · +${group.tasks.length - 1} more` : ""}</p>
                </div>
              ))}
            </div>}
      </ReportSection>

      <ReportSection title="New today">
        <SubBlock title={`Enquiries received (${s.new_today.enquiries.length})`}>
          {s.new_today.enquiries.length === 0 ? <p className="text-sm text-ink-muted etched">No new enquiries today.</p> : (
            <ReportTable
              headers={["Enquiry", "Organisation", "Source"]}
              rows={s.new_today.enquiries.slice(0, 5).map((e) => [
                <EventCell key="e" id={e.event_id} title={e.event_title} />, e.organisation_name ?? "—", e.enquiry_source ?? "—",
              ])}
            />
          )}
        </SubBlock>
        <SubBlock title={`Status movements (${s.new_today.status_changes.length}${s.new_today.confirmations ? ` — ${s.new_today.confirmations} confirmed 🎉` : ""})`}>
          {s.new_today.status_changes.length === 0 ? <p className="text-sm text-ink-muted etched">No status changes today.</p> : (
            <ReportTable
              headers={["Event", "Change", "By", "Reason"]}
              rows={s.new_today.status_changes.slice(0, 5).map((c) => [
                <EventCell key="e" id={c.event_id} title={c.event_title} />,
                `${c.from_status ?? "—"} → ${c.to_status}`, c.changed_by_name ?? "—", c.reason ?? "",
              ])}
            />
          )}
        </SubBlock>
      </ReportSection>

      <ReportSection title="Tomorrow preview">
        <p className="mb-2 text-sm text-ink-secondary etched">{s.tomorrow.tasks_due} tasks due tomorrow.</p>
        {s.tomorrow.schedule.length === 0 ? <p className="text-sm text-ink-muted etched">No venue activity scheduled tomorrow.</p> : (
          <ReportTable
            headers={["Venue", "Activity", "Time", "Event", "Organisation"]}
            rows={s.tomorrow.schedule.slice(0, 6).map((e) => [
              e.venue, e.activity_type.replace(/_/g, " "),
              e.start_time ? formatTimeRange(e.start_time, e.end_time) : "—",
              <EventCell key="e" id={e.event_id} title={e.event_title} />, e.organisation_name ?? "—",
            ])}
          />
        )}
      </ReportSection>

      <ReportSection title="7-day completion trend">
        <div className="flex flex-wrap gap-4">
          {s.trend.map((t) => {
            const p = t.due ? Math.round((t.done / t.due) * 100) : null;
            const day = new Date(`${t.date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
            return (
              <div key={t.date} className="text-center">
                <div className={"text-base font-semibold etched-deep " + (p === null ? "text-ink-muted" : p >= 80 ? "text-status-confirmed" : p >= 50 ? "text-status-tentative" : "text-status-cancelled")}>
                  {p === null ? "—" : `${p}%`}
                </div>
                <div className="text-[11px] uppercase tracking-wider text-ink-muted etched">{day}</div>
                <div className="text-[11px] text-ink-muted etched">{t.done}/{t.due}</div>
              </div>
            );
          })}
        </div>
      </ReportSection>
    </>
  );
}

/** Serialise a brief into Word-export table sections. */
function briefWordBody(content: BriefContent): string {
  const taskRows = (tasks: ReportTask[]) =>
    tasks.map((t) => [t.title, t.priority, t.due_date, t.event_title, t.assignee_name ?? "Unassigned"]);
  if (content.brief_type === "morning") {
    const s = content;
    return [
      htmlTableSection("Headline", ["Metric", "Value"], [
        ["At the venues", s.headline.scheduled_today],
        ["Tasks due today", s.headline.tasks_due_today],
        ["Overdue", s.headline.overdue],
        ["Need your decision", s.headline.decisions_needed],
        ["New enquiries yesterday", s.headline.new_enquiries_yesterday],
      ]),
      htmlTableSection("Needs Your Decision", ["Type", "Item", "Detail", "Date"], [
        ...s.decisions.approvals_pending.map((a) => ["VFH approval pending", a.event_title, a.organisation_name ?? "", a.event_start_date ?? ""]),
        ...s.decisions.conflicts.map((cf) => [conflictAttentionLabel(cf), `${cf.a.event_title} / ${cf.b.event_title}`, cf.venue, cf.activity_date]),
        ...s.decisions.unassigned_high_priority.map((t) => ["Unassigned high priority", t.title, t.event_title ?? "", t.due_date ?? ""]),
        ...s.decisions.stale_enquiries.map((e) => ["Stale enquiry", e.event_title, `${e.organisation_name ?? ""} — quiet ${e.days_quiet}d`, e.enquiry_date ?? ""]),
      ]),
      htmlTableSection("Today at the Venues", ["Venue", "Activity", "Start", "End", "Event", "Organisation"],
        s.today_schedule.map((e) => [e.venue, e.activity_type, e.start_time, e.end_time, e.event_title, e.organisation_name])),
      htmlTableSection("Team Plan", ["Task", "Priority", "Due", "Event", "Assignee"], taskRows(s.team_plan.flatMap((g) => g.tasks))),
      htmlTableSection("Watchlist", ["Risk", "Item", "Detail"], [
        ...s.risk_radar.low_readiness.map((e) => ["Low readiness", e.event_title, `${e.event_form_readiness ?? Math.round((e.overall_completion ?? 0) * 100)}% ready, starts in ${e.days_to_event}d`]),
        ...s.risk_radar.blocked_items.map((b) => ["Blocked checklist item", b.label, b.event_title]),
        ...s.risk_radar.overdue_instalments.map((t) => ["Overdue payment follow-up", t.title, t.event_title ?? ""]),
        ...s.risk_radar.unsigned_confirmations.map((e) => ["Unsigned confirmation", e.event_title, e.confirmation_status ?? "none"]),
        ...s.risk_radar.poc_incomplete.map((e) => [
          "POC incomplete",
          e.event_title,
          `${e.filled_count}/${e.total_count} — ${e.missing_labels.join(", ")}`,
        ]),
      ]),
      htmlTableSection("Overdue (oldest)", ["Task", "Priority", "Due", "Event", "Assignee", "Days Overdue"],
        s.overdue.oldest.map((t) => [t.title, t.priority, t.due_date, t.event_title, t.assignee_name ?? "Unassigned", t.days_overdue])),
    ].join("");
  }
  const s = content;
  return [
    htmlTableSection("Scoreboard", ["Metric", "Value"], [
      ["Tasks due today", s.scoreboard.due_today],
      ["Completed of due", s.scoreboard.done_of_due],
      ["Slipped", s.scoreboard.still_open],
      ["Completion rate", `${Math.round(s.scoreboard.completion_rate * 100)}%`],
      ["Completed in total", s.scoreboard.done_today_total],
      ["Checklist done / due", `${s.scoreboard.checklist_done} / ${s.scoreboard.checklist_due}`],
    ]),
    htmlTableSection("What Got Done", ["By", "Type", "Item", "Event"], s.done_by_person.flatMap((p) => [
      ...p.tasks.map((t) => [p.person, "Task", t.title, t.event_title ?? ""]),
      ...p.checklist.map((ci) => [p.person, "Checklist", ci.label, ci.event_title ?? ""]),
    ])),
    htmlTableSection("Slipped Today", ["Task", "Priority", "Due", "Event", "Assignee"], taskRows(s.slipped.flatMap((g) => g.tasks))),
    htmlTableSection("New Today", ["Type", "Item", "Detail"], [
      ...s.new_today.enquiries.map((e) => ["Enquiry", e.event_title, `${e.organisation_name ?? ""} · ${e.enquiry_source ?? ""}`]),
      ...s.new_today.status_changes.map((c) => ["Status change", c.event_title ?? "", `${c.from_status ?? "—"} → ${c.to_status}`]),
    ]),
    htmlTableSection("Tomorrow Preview", ["Venue", "Activity", "Start", "End", "Event"],
      s.tomorrow.schedule.map((e) => [e.venue, e.activity_type, e.start_time, e.end_time, e.event_title])),
    htmlTableSection("7-Day Trend", ["Date", "Due", "Done", "Completion"],
      s.trend.map((t) => [t.date, t.due, t.done, t.due ? `${Math.round((t.done / t.due) * 100)}%` : "—"])),
  ].join("");
}

// ------------------------------------------------------------------ Analytics

type VenueUtilisation = {
  from: string; to: string; days: number;
  venues: Array<{ venue: string; booked_days: number; entries: number; utilisation: number; by_activity: Record<string, number> }>;
};
type InquiryConversion = {
  total_inquiries: number;
  by_status: Record<string, number>;
  confirmed: number;
  declined: number;
  open_pipeline: number;
  conversion_rate: number;
  by_source: Array<{ source: string; total: number; confirmed: number }>;
};
type PaymentTracking = {
  by_payment_status: Array<{ payment_status: string; count: number }>;
  full_payment_received: number;
  tracked_events: number;
  open_instalment_tasks: number;
};
type OperationalPerformance = {
  tasks_total: number;
  tasks_completed: number;
  task_completion_rate: number;
  tasks_by_type: Record<string, Record<string, number>>;
  overdue_tasks: number;
  checklist_completion: { operations: number; accounts: number; overall: number; active_events: number };
  form_readiness: number;
};
type ClientProfile = {
  by_event_type: Array<{ event_type: string; count: number }>;
  by_org_type: Array<{ org_type: string; count: number }>;
  top_organisations: Array<{ id: string; name: string; events: number; confirmed: number }>;
  repeat_clients: number;
  total_events: number;
};

function AnalyticsView() {
  const today = istToday();
  const [from, setFrom] = useState(() => {
    const d = new Date(Date.parse(`${today}T00:00:00Z`) - 89 * 86_400_000);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(today);
  const range = useMemo(() => `?from=${from}&to=${to}`, [from, to]);

  const utilisation = useQuery({
    queryKey: ["analytics", "venue-utilisation", range],
    queryFn: () => apiGet<VenueUtilisation>(`/analytics/venue-utilisation${range}`),
  });
  const conversion = useQuery({
    queryKey: ["analytics", "inquiry-conversion", range],
    queryFn: () => apiGet<InquiryConversion>(`/analytics/inquiry-conversion${range}`),
  });
  const payments = useQuery({
    queryKey: ["analytics", "payment-tracking", range],
    queryFn: () => apiGet<PaymentTracking>(`/analytics/payment-tracking${range}`),
  });
  const performance = useQuery({
    queryKey: ["analytics", "operational-performance", range],
    queryFn: () => apiGet<OperationalPerformance>(`/analytics/operational-performance${range}`),
  });
  const profile = useQuery({
    queryKey: ["analytics", "client-profile", range],
    queryFn: () => apiGet<ClientProfile>(`/analytics/client-profile${range}`),
  });

  function exportWord() {
    const body = analyticsWordBody({
      utilisation: utilisation.data,
      conversion: conversion.data,
      payments: payments.data,
      performance: performance.data,
      profile: profile.data,
    });
    downloadWordDoc(`analytics-${from}-to-${to}`, `Venue Analytics — ${formatDate(from)} to ${formatDate(to)}`, body);
  }

  return (
    <div className="print-area space-y-4">
      <section className="carved-card flex flex-wrap items-end gap-3 rounded-2xl bg-marble-highlight/50 p-5">
        <label className="block print-hidden">
          <span className="text-xs font-semibold text-ink-secondary etched">From</span>
          <input type="date" lang="en-GB" value={from} onChange={(ev) => setFrom(ev.target.value)} className="carved mt-1 rounded-xl bg-marble-shadow/40 px-3 py-2 text-sm text-ink-primary focus:outline-none" />
        </label>
        <label className="block print-hidden">
          <span className="text-xs font-semibold text-ink-secondary etched">To</span>
          <input type="date" lang="en-GB" value={to} onChange={(ev) => setTo(ev.target.value)} className="carved mt-1 rounded-xl bg-marble-shadow/40 px-3 py-2 text-sm text-ink-primary focus:outline-none" />
        </label>
        <p className="pb-2 text-xs text-ink-muted etched">
          Venue analytics · {formatDate(from)} to {formatDate(to)} — all five sections follow this range.
        </p>
        <div className="ml-auto flex gap-2 pb-1 print-hidden">
          <button type="button" onClick={() => window.print()} className="carved-btn rounded-full bg-neutral-btn px-4 py-2 text-sm font-medium text-ink-secondary etched">
            Print / PDF
          </button>
          <button type="button" onClick={exportWord} className="carved-btn rounded-full bg-neutral-btn px-4 py-2 text-sm font-medium text-ink-secondary etched">
            Word
          </button>
        </div>
      </section>

      <AnalyticsSection title="Venue utilisation" isLoading={utilisation.isLoading}>
        {utilisation.data && (
          utilisation.data.venues.length === 0 ? <Empty /> : (
            <div className="space-y-3">
              {utilisation.data.venues.map((v) => (
                <div key={v.venue}>
                  <Bar
                    label={v.venue}
                    value={v.booked_days}
                    max={utilisation.data.days}
                    detail={`${v.booked_days} of ${utilisation.data.days} days (${Math.round(v.utilisation * 100)}%) · ${v.entries} activities`}
                  />
                  <div className="mt-0.5 pl-1 text-[11px] text-ink-muted etched">
                    {Object.entries(v.by_activity).map(([a, n]) => `${a.replace(/_/g, " ")}: ${n}`).join(" · ")}
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </AnalyticsSection>

      <AnalyticsSection title="Inquiry conversion" isLoading={conversion.isLoading}>
        {conversion.data && (
          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <div className="mb-3 grid grid-cols-2 gap-3">
                <Stat label="Inquiries" value={String(conversion.data.total_inquiries)} />
                <Stat label="Conversion" value={`${Math.round(conversion.data.conversion_rate * 100)}%`} />
                <Stat label="Confirmed" value={String(conversion.data.confirmed)} />
                <Stat label="Declined" value={String(conversion.data.declined)} />
              </div>
              <div className="space-y-2">
                {Object.entries(conversion.data.by_status).map(([status, count]) => (
                  <Bar key={status} label={status} value={count} max={conversion.data.total_inquiries || 1} detail={String(count)} />
                ))}
              </div>
            </div>
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted etched">By source</h4>
              {conversion.data.by_source.length === 0 ? <Empty /> : (
                <div className="space-y-2">
                  {conversion.data.by_source.map((s) => (
                    <Bar key={s.source} label={s.source} value={s.total} max={conversion.data.total_inquiries || 1} detail={`${s.total} (${s.confirmed} confirmed)`} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </AnalyticsSection>

      <AnalyticsSection title="Payment tracking" isLoading={payments.isLoading}>
        {payments.data && (
          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-2">
              {payments.data.by_payment_status.length === 0 ? <Empty /> : payments.data.by_payment_status.map((p) => (
                <Bar
                  key={p.payment_status}
                  label={p.payment_status}
                  value={p.count}
                  max={payments.data.by_payment_status.reduce((s, x) => s + x.count, 0) || 1}
                  detail={String(p.count)}
                />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 content-start">
              <Stat label="Full payment received" value={`${payments.data.full_payment_received} / ${payments.data.tracked_events}`} />
              <Stat label="Open instalment tasks" value={String(payments.data.open_instalment_tasks)} />
            </div>
          </div>
        )}
      </AnalyticsSection>

      <AnalyticsSection title="Operational performance" isLoading={performance.isLoading}>
        {performance.data && (
          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <div className="mb-3 grid grid-cols-2 gap-3">
                <Stat label="Tasks in range" value={String(performance.data.tasks_total)} />
                <Stat label="Completed" value={`${performance.data.tasks_completed} (${Math.round(performance.data.task_completion_rate * 100)}%)`} />
                <Stat label="Overdue now" value={String(performance.data.overdue_tasks)} />
                <Stat label="Active events" value={String(performance.data.checklist_completion.active_events)} />
              </div>
              {Object.entries(performance.data.tasks_by_type).map(([type, statuses]) => (
                <div key={type} className="mt-2 text-xs text-ink-muted etched">
                  <span className="font-semibold capitalize text-ink-secondary">{type}:</span>{" "}
                  {Object.entries(statuses).map(([s, n]) => `${s.replace(/_/g, " ")} ${n}`).join(" · ")}
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-muted etched">Action progress vs form readiness</h4>
              <Bar label="Operations actions" value={performance.data.checklist_completion.operations} max={1} detail={`${Math.round(performance.data.checklist_completion.operations * 100)}%`} />
              <Bar label="Event-form readiness" value={performance.data.form_readiness} max={1} detail={`${Math.round(performance.data.form_readiness * 100)}%`} />
              <Bar label="Accounts" value={performance.data.checklist_completion.accounts} max={1} detail={`${Math.round(performance.data.checklist_completion.accounts * 100)}%`} />
            </div>
          </div>
        )}
      </AnalyticsSection>

      <AnalyticsSection title="Client & event profile" isLoading={profile.isLoading}>
        {profile.data && (
          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <div className="mb-3 grid grid-cols-2 gap-3">
                <Stat label="Events in range" value={String(profile.data.total_events)} />
                <Stat label="Repeat clients" value={String(profile.data.repeat_clients)} />
              </div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted etched">By event type</h4>
              <div className="space-y-2">
                {profile.data.by_event_type.map((t) => (
                  <Bar key={t.event_type} label={t.event_type} value={t.count} max={profile.data.total_events || 1} detail={String(t.count)} />
                ))}
              </div>
              <h4 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wider text-ink-muted etched">By organisation type</h4>
              <div className="space-y-2">
                {profile.data.by_org_type.map((t) => (
                  <Bar key={t.org_type} label={t.org_type} value={t.count} max={profile.data.total_events || 1} detail={String(t.count)} />
                ))}
              </div>
            </div>
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted etched">Top organisations</h4>
              {profile.data.top_organisations.length === 0 ? <Empty /> : (
                <div className="space-y-2">
                  {profile.data.top_organisations.map((o) => (
                    <Bar
                      key={o.id}
                      label={o.name}
                      value={o.events}
                      max={profile.data.top_organisations[0]?.events || 1}
                      detail={`${o.events} events (${o.confirmed} confirmed)`}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </AnalyticsSection>
    </div>
  );
}

/** Serialise the loaded analytics datasets into Word-export table sections. */
function analyticsWordBody(data: {
  utilisation?: VenueUtilisation;
  conversion?: InquiryConversion;
  payments?: PaymentTracking;
  performance?: OperationalPerformance;
  profile?: ClientProfile;
}): string {
  const parts: string[] = [];
  if (data.utilisation) {
    parts.push(htmlTableSection("Venue Utilisation", ["Venue", "Booked Days", "Days in Range", "Utilisation", "Activities"],
      data.utilisation.venues.map((v) => [
        v.venue, v.booked_days, data.utilisation!.days, `${Math.round(v.utilisation * 100)}%`,
        Object.entries(v.by_activity).map(([a, n]) => `${a}: ${n}`).join(", "),
      ])));
  }
  if (data.conversion) {
    parts.push(htmlTableSection("Inquiry Conversion", ["Metric", "Value"], [
      ["Total inquiries", data.conversion.total_inquiries],
      ["Confirmed", data.conversion.confirmed],
      ["Declined", data.conversion.declined],
      ["Open pipeline", data.conversion.open_pipeline],
      ["Conversion rate", `${Math.round(data.conversion.conversion_rate * 100)}%`],
      ...Object.entries(data.conversion.by_status).map(([s, n]) => [`Status: ${s}`, n] as [string, number]),
    ]));
    parts.push(htmlTableSection("Inquiries by Source", ["Source", "Total", "Confirmed"],
      data.conversion.by_source.map((s) => [s.source, s.total, s.confirmed])));
  }
  if (data.payments) {
    parts.push(htmlTableSection("Payment Tracking", ["Payment Status", "Events"], [
      ...data.payments.by_payment_status.map((p) => [p.payment_status, p.count] as [string, number]),
      ["Full payment received", `${data.payments.full_payment_received} / ${data.payments.tracked_events}`],
      ["Open instalment tasks", data.payments.open_instalment_tasks],
    ]));
  }
  if (data.performance) {
    parts.push(htmlTableSection("Operational Performance", ["Metric", "Value"], [
      ["Tasks in range", data.performance.tasks_total],
      ["Tasks completed", `${data.performance.tasks_completed} (${Math.round(data.performance.task_completion_rate * 100)}%)`],
      ["Overdue tasks", data.performance.overdue_tasks],
      ["Active events", data.performance.checklist_completion.active_events],
      ["Avg operations checklist", `${Math.round(data.performance.checklist_completion.operations * 100)}%`],
      ["Avg accounts checklist", `${Math.round(data.performance.checklist_completion.accounts * 100)}%`],
      ["Avg overall checklist", `${Math.round(data.performance.checklist_completion.overall * 100)}%`],
    ]));
  }
  if (data.profile) {
    parts.push(htmlTableSection("Client & Event Profile", ["Metric", "Value"], [
      ["Events in range", data.profile.total_events],
      ["Repeat clients", data.profile.repeat_clients],
      ...data.profile.by_event_type.map((t) => [`Event type: ${t.event_type}`, t.count] as [string, number]),
      ...data.profile.by_org_type.map((t) => [`Organisation type: ${t.org_type}`, t.count] as [string, number]),
    ]));
    parts.push(htmlTableSection("Top Organisations", ["Organisation", "Events", "Confirmed"],
      data.profile.top_organisations.map((o) => [o.name, o.events, o.confirmed])));
  }
  return parts.join("");
}

function AnalyticsSection({ title, isLoading, children }: { title: string; isLoading: boolean; children: React.ReactNode }) {
  return (
    <section className="carved-card rounded-2xl bg-marble-highlight/50 p-5">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-sage etched">{title}</h3>
      {isLoading ? <p className="text-sm text-ink-muted etched">Loading...</p> : children}
    </section>
  );
}

function Empty() {
  return <p className="text-sm text-ink-muted etched">No data in this range.</p>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-marble-shadow/20 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wider text-ink-muted etched">{label}</div>
      <div className="text-lg font-semibold text-ink-primary etched-deep">{value}</div>
    </div>
  );
}

/** Restrained CSS bar (no charting library). */
function Bar({ label, value, max, detail }: { label: string; value: number; max: number; detail?: string }) {
  const pct = Math.max(0, Math.min(100, max > 0 ? (value / max) * 100 : 0));
  return (
    <div>
      <div className="mb-0.5 flex items-baseline justify-between gap-2 text-xs">
        <span className="truncate font-medium capitalize text-ink-secondary etched">{label.replace(/_/g, " ")}</span>
        {detail && <span className="shrink-0 text-ink-muted etched">{detail}</span>}
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-marble-shadow/60">
        <div className="h-full rounded-full bg-sage-btn" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
