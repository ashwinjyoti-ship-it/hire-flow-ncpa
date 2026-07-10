/**
 * Reports & Analytics.
 *  - Daily operational report: Admin / Venue Manager generate an immutable
 *    snapshot for a chosen date (default: today, Asia/Kolkata). Past snapshots
 *    re-open exactly as saved. Exports: on-screen, print stylesheet, Excel
 *    (Worker-built via SheetJS) and PDF (print-ready HTML → browser save-as-PDF).
 *  - Analytics: the five requested areas over a date range, drawn with
 *    restrained CSS bars (no charting library).
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "../components/PageHeader";
import { apiGet, apiPost } from "../lib/api";
import { formatDate, formatDateTime, formatTimeRange } from "../lib/use-lookups";
import { useAuth } from "../lib/auth";
import { can } from "../lib/can";
import { downloadWordDoc, htmlTableSection } from "../lib/export";
import type { DailyReportContent } from "../../worker/lib/daily-report";

function istToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

type ReportListItem = {
  id: string;
  report_date: string;
  generated_at: string;
  notes: string | null;
  generated_by_name: string | null;
};

type ReportDetail = {
  report: {
    id: string;
    report_date: string;
    generated_at: string;
    generated_by_name: string | null;
    notes: string | null;
    content: DailyReportContent;
  };
};

export function ReportsPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<"daily" | "analytics">("daily");
  const canGenerate = can(user?.role ?? "viewer", "report.generate");

  return (
    <div>
      <PageHeader title="Reports & Analytics" subtitle="Daily operational reports and venue analytics" />
      <div className="mb-4 flex flex-wrap gap-1 print-hidden">
        {([["daily", "Daily Report"], ["analytics", "Analytics"]] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={
              "rounded-full px-4 py-1.5 text-sm font-medium etched " +
              (tab === key ? "bg-sage-btn text-sage-text carved-btn-sage" : "text-ink-secondary hover:bg-marble-shadow/40")
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
    mutationFn: () => apiPost<{ id: string }>("/reports/daily", { date, notes: notes.trim() || null }),
    onSuccess: (res) => {
      setNotes("");
      setSelectedId(res.id);
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
            <label className="block">
              <span className="text-xs font-semibold text-ink-secondary etched">Report date (IST)</span>
              <input
                type="date"
                lang="en-US"
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
              className="carved-btn-sage mt-3 w-full rounded-full bg-sage-btn px-5 py-2 text-sm font-semibold text-sage-text etched disabled:opacity-60"
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
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(r.id)}
                    className={
                      "w-full rounded-xl px-3 py-2 text-left text-sm transition-colors " +
                      (selectedId === r.id ? "bg-sage-btn text-sage-text carved-btn-sage etched" : "text-ink-secondary hover:bg-marble-shadow/40")
                    }
                  >
                    <span className="font-medium">{formatDate(r.report_date)}</span>
                    <span className="block text-[11px] opacity-80">
                      {formatDateTime(r.generated_at)}
                      {r.generated_by_name ? ` · ${r.generated_by_name}` : ""}
                    </span>
                  </button>
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
                <h2 className="text-lg font-semibold text-ink-primary etched-deep">Daily Operational Report — {formatDate(report.report_date)}</h2>
                <p className="text-xs text-ink-muted etched">
                  Generated {formatDateTime(report.generated_at)}
                  {report.generated_by_name ? ` by ${report.generated_by_name}` : ""}
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
                  onClick={() => downloadWordDoc(`daily-report-${report.report_date}`, `Daily Operational Report — ${formatDate(report.report_date)}`, dailyReportWordBody(report.content))}
                  className="carved-btn rounded-full bg-neutral-btn px-4 py-2 text-sm font-medium text-ink-secondary etched"
                >
                  Word
                </button>
              </div>
            </div>
            <ReportSections content={report.content} />
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
          <input type="date" lang="en-US" value={from} onChange={(ev) => setFrom(ev.target.value)} className="carved mt-1 rounded-xl bg-marble-shadow/40 px-3 py-2 text-sm text-ink-primary focus:outline-none" />
        </label>
        <label className="block print-hidden">
          <span className="text-xs font-semibold text-ink-secondary etched">To</span>
          <input type="date" lang="en-US" value={to} onChange={(ev) => setTo(ev.target.value)} className="carved mt-1 rounded-xl bg-marble-shadow/40 px-3 py-2 text-sm text-ink-primary focus:outline-none" />
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
              <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-muted etched">Average checklist completion</h4>
              <Bar label="Operations" value={performance.data.checklist_completion.operations} max={1} detail={`${Math.round(performance.data.checklist_completion.operations * 100)}%`} />
              <Bar label="Accounts" value={performance.data.checklist_completion.accounts} max={1} detail={`${Math.round(performance.data.checklist_completion.accounts * 100)}%`} />
              <Bar label="Overall" value={performance.data.checklist_completion.overall} max={1} detail={`${Math.round(performance.data.checklist_completion.overall * 100)}%`} />
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
