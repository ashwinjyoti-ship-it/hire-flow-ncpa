/**
 * Morning Brief & Evening Debrief — the twice-daily operational briefs.
 *
 * The Morning Brief is forward-looking and attention-ordered: what needs the
 * manager's decision, what happens at the venues today, what each team member
 * is due to do, and where the risks are. The Evening Debrief is retrospective:
 * plan-vs-done scoreboard, who did what, what slipped, what came in, and a
 * preview of tomorrow.
 *
 * Both are immutable snapshots stored in `daily_reports` (report_type
 * 'morning' | 'evening') alongside the legacy full-day snapshot ('daily').
 * All dates are Asia/Kolkata; UTC timestamps are shifted by +330 minutes.
 */
import { IST_OFFSET_MINUTES, istToday, type ReportTask, type ScheduledEntry } from "./daily-report";

export type BriefType = "morning" | "evening";

/** Tunable thresholds; stored as JSON under app_settings key 'brief_settings'. */
export interface BriefSettings {
  morning_time: string; // HH:MM IST
  evening_time: string; // HH:MM IST
  stale_enquiry_days: number;
  readiness_window_days: number;
  readiness_threshold: number; // 0..1
  conflict_window_days: number;
  overdue_list_cap: number;
  email_enabled: boolean;
}

export const DEFAULT_BRIEF_SETTINGS: BriefSettings = {
  morning_time: "07:30",
  evening_time: "18:30",
  stale_enquiry_days: 3,
  readiness_window_days: 7,
  readiness_threshold: 0.7,
  conflict_window_days: 30,
  overdue_list_cap: 10,
  email_enabled: true,
};

export const SETTING_BRIEF_SETTINGS = "brief_settings";

export async function getBriefSettings(db: D1Database): Promise<BriefSettings> {
  const row = await db.prepare("SELECT value FROM app_settings WHERE key = ?")
    .bind(SETTING_BRIEF_SETTINGS).first<{ value: string | null }>();
  if (!row?.value) return { ...DEFAULT_BRIEF_SETTINGS };
  try {
    return { ...DEFAULT_BRIEF_SETTINGS, ...(JSON.parse(row.value) as Partial<BriefSettings>) };
  } catch {
    return { ...DEFAULT_BRIEF_SETTINGS };
  }
}

// ---------------------------------------------------------------- Shared bits

type EventRef = {
  event_id: string;
  event_title: string;
  organisation_name: string | null;
};

export type ConflictEntry = {
  venue: string;
  activity_date: string;
  level: "conflict" | "potential";
  a: { event_id: string; event_title: string; status: string };
  b: { event_id: string; event_title: string; status: string };
};

export type AssigneeTasks = { assignee: string | null; tasks: ReportTask[] };

function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const IST = `+${IST_OFFSET_MINUTES} minutes`;

const BRIEF_TASK_SELECT = `
  SELECT t.id, t.title, t.task_type, t.status, t.priority, t.due_date, t.event_id,
         e.title AS event_title, u.name AS assignee_name
  FROM tasks t
  LEFT JOIN events e ON e.id = t.event_id
  LEFT JOIN users u ON u.id = t.assignee_id`;

const SCHEDULE_SELECT = `
  SELECT vb.venue, se.activity_type, se.start_time, se.end_time,
         e.id AS event_id, e.title AS event_title, e.status AS event_status,
         o.name AS organisation_name
  FROM schedule_entries se
  JOIN venue_bookings vb ON vb.id = se.venue_booking_id
  JOIN events e ON e.id = se.event_id
  LEFT JOIN organisations o ON o.id = e.organisation_id
  WHERE se.activity_date = ? AND e.is_archived = 0 AND e.status NOT IN ('cancelled','regret')
  ORDER BY vb.venue, COALESCE(se.start_time, '99'), se.sort_order`;

async function scheduleFor(db: D1Database, date: string): Promise<ScheduledEntry[]> {
  const { results } = await db.prepare(SCHEDULE_SELECT).bind(date).all<ScheduledEntry>();
  return results;
}

/** Group open tasks by assignee name; unassigned first, then alphabetical. */
function groupByAssignee(tasks: ReportTask[]): AssigneeTasks[] {
  const groups = new Map<string | null, ReportTask[]>();
  for (const t of tasks) {
    const key = t.assignee_name ?? null;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => {
      if (a === null) return -1;
      if (b === null) return 1;
      return a.localeCompare(b);
    })
    .map(([assignee, list]) => ({ assignee, tasks: list }));
}

/** Upcoming venue double-bookings within the window, pairwise, deduplicated. */
async function findConflicts(db: D1Database, from: string, to: string): Promise<ConflictEntry[]> {
  const { results } = await db.prepare(
    `SELECT se1.activity_date, vb1.venue,
            e1.id AS a_id, e1.title AS a_title, e1.status AS a_status,
            e2.id AS b_id, e2.title AS b_title, e2.status AS b_status
     FROM schedule_entries se1
     JOIN venue_bookings vb1 ON vb1.id = se1.venue_booking_id
     JOIN events e1 ON e1.id = se1.event_id
     JOIN schedule_entries se2 ON se2.activity_date = se1.activity_date
     JOIN venue_bookings vb2 ON vb2.id = se2.venue_booking_id AND vb2.venue = vb1.venue
     JOIN events e2 ON e2.id = se2.event_id AND e1.id < e2.id
     WHERE se1.activity_date BETWEEN ? AND ?
       AND e1.is_archived = 0 AND e1.status NOT IN ('cancelled','regret')
       AND e2.is_archived = 0 AND e2.status NOT IN ('cancelled','regret')
     GROUP BY se1.activity_date, vb1.venue, e1.id, e2.id
     ORDER BY se1.activity_date, vb1.venue
     LIMIT 20`
  ).bind(from, to).all<{
    activity_date: string; venue: string;
    a_id: string; a_title: string; a_status: string;
    b_id: string; b_title: string; b_status: string;
  }>();
  return results.map((r) => ({
    venue: r.venue,
    activity_date: r.activity_date,
    level: r.a_status === "confirmed" && r.b_status === "confirmed" ? "conflict" : "potential",
    a: { event_id: r.a_id, event_title: r.a_title, status: r.a_status },
    b: { event_id: r.b_id, event_title: r.b_title, status: r.b_status },
  }));
}

// ------------------------------------------------------------- Morning Brief

export interface MorningBriefContent {
  brief_type: "morning";
  report_date: string;
  generated_at: string;
  headline: {
    scheduled_today: number;
    tasks_due_today: number;
    overdue: number;
    decisions_needed: number;
    new_enquiries_yesterday: number;
  };
  decisions: {
    approvals_pending: Array<EventRef & { event_start_date: string | null; approval_status: string | null }>;
    conflicts: ConflictEntry[];
    unassigned_high_priority: ReportTask[];
    stale_enquiries: Array<EventRef & { enquiry_date: string | null; days_quiet: number }>;
  };
  today_schedule: ScheduledEntry[];
  team_plan: AssigneeTasks[];
  risk_radar: {
    low_readiness: Array<EventRef & { event_start_date: string | null; days_to_event: number; overall_completion: number; status: string }>;
    blocked_items: Array<{ event_id: string; event_title: string; label: string; section: string; module: string }>;
    overdue_instalments: ReportTask[];
    unsigned_confirmations: Array<EventRef & { event_start_date: string | null; confirmation_status: string | null }>;
  };
  overdue: {
    total: number;
    buckets: Array<{ label: string; count: number }>;
    oldest: Array<ReportTask & { days_overdue: number }>;
    by_assignee: Array<{ assignee: string; count: number }>;
  };
  yesterday: { completed: number; new_enquiries: number; confirmations: number };
}

export async function buildMorningBrief(db: D1Database, reportDate?: string): Promise<MorningBriefContent> {
  const date = reportDate ?? istToday();
  const settings = await getBriefSettings(db);
  const yesterday = addDaysIso(date, -1);

  const today_schedule = await scheduleFor(db, date);

  const { results: dueToday } = await db.prepare(
    `${BRIEF_TASK_SELECT}
     WHERE t.status IN ('open','in_progress') AND t.due_date = ?
     ORDER BY t.priority = 'high' DESC, t.created_at`
  ).bind(date).all<ReportTask>();
  const team_plan = groupByAssignee(dueToday);

  // -- Needs your decision -----------------------------------------------
  const { results: approvals_pending } = await db.prepare(
    `SELECT e.id AS event_id, e.title AS event_title, o.name AS organisation_name,
            e.event_start_date, e.approval_status
     FROM events e LEFT JOIN organisations o ON o.id = e.organisation_id
     WHERE e.is_archived = 0 AND e.event_type = 'VFH'
       AND e.approval_status IN ('pending','sent')
       AND e.status IN ('enquiry','tentative')
     ORDER BY COALESCE(e.event_start_date, '9999') LIMIT 10`
  ).all<MorningBriefContent["decisions"]["approvals_pending"][number]>();

  const conflicts = await findConflicts(db, date, addDaysIso(date, settings.conflict_window_days));

  const { results: unassigned_high_priority } = await db.prepare(
    `${BRIEF_TASK_SELECT}
     WHERE t.status IN ('open','in_progress') AND t.assignee_id IS NULL
       AND t.priority = 'high' AND t.due_date IS NOT NULL AND t.due_date <= ?
     ORDER BY t.due_date LIMIT 10`
  ).bind(date).all<ReportTask>();

  const { results: stale_enquiries } = await db.prepare(
    `SELECT e.id AS event_id, e.title AS event_title, o.name AS organisation_name,
            e.enquiry_date,
            CAST(julianday(?) - julianday(date(e.updated_at, '${IST}')) AS INTEGER) AS days_quiet
     FROM events e LEFT JOIN organisations o ON o.id = e.organisation_id
     WHERE e.is_archived = 0 AND e.status = 'enquiry'
       AND date(e.updated_at, '${IST}') <= date(?, '-' || ? || ' days')
     ORDER BY e.updated_at LIMIT 10`
  ).bind(date, date, settings.stale_enquiry_days).all<MorningBriefContent["decisions"]["stale_enquiries"][number]>();

  // -- Risk radar ----------------------------------------------------------
  const windowEnd = addDaysIso(date, settings.readiness_window_days);
  const { results: low_readiness } = await db.prepare(
    `SELECT e.id AS event_id, e.title AS event_title, o.name AS organisation_name,
            e.event_start_date, e.overall_completion, e.status,
            CAST(julianday(e.event_start_date) - julianday(?) AS INTEGER) AS days_to_event
     FROM events e LEFT JOIN organisations o ON o.id = e.organisation_id
     WHERE e.is_archived = 0 AND e.status IN ('tentative','approved','confirmed')
       AND e.event_start_date BETWEEN ? AND ?
       AND e.overall_completion < ?
     ORDER BY e.event_start_date LIMIT 10`
  ).bind(date, date, windowEnd, settings.readiness_threshold)
    .all<MorningBriefContent["risk_radar"]["low_readiness"][number]>();

  const { results: blocked_items } = await db.prepare(
    `SELECT ci.event_id, e.title AS event_title, ci.label, ci.section, ci.module
     FROM checklist_items ci
     JOIN events e ON e.id = ci.event_id
     WHERE ci.status = 'blocked' AND e.is_archived = 0 AND e.status NOT IN ('cancelled','regret')
     ORDER BY ci.last_updated_at LIMIT 10`
  ).all<MorningBriefContent["risk_radar"]["blocked_items"][number]>();

  const { results: overdue_instalments } = await db.prepare(
    `${BRIEF_TASK_SELECT}
     WHERE t.source_rule = 'instalment' AND t.status IN ('open','in_progress')
       AND t.due_date IS NOT NULL AND t.due_date < ?
     ORDER BY t.due_date LIMIT 10`
  ).bind(date).all<ReportTask>();

  const { results: unsigned_confirmations } = await db.prepare(
    `SELECT e.id AS event_id, e.title AS event_title, o.name AS organisation_name,
            e.event_start_date, e.confirmation_status
     FROM events e LEFT JOIN organisations o ON o.id = e.organisation_id
     WHERE e.is_archived = 0 AND e.status = 'confirmed'
       AND e.event_start_date BETWEEN ? AND ?
       AND COALESCE(e.confirmation_status, 'none') != 'signed_received'
     ORDER BY e.event_start_date LIMIT 10`
  ).bind(date, addDaysIso(date, 14)).all<MorningBriefContent["risk_radar"]["unsigned_confirmations"][number]>();

  // -- Overdue, bucketed so it never overwhelms ---------------------------
  const { results: overdueRows } = await db.prepare(
    `${BRIEF_TASK_SELECT}
     WHERE t.status IN ('open','in_progress') AND t.due_date IS NOT NULL AND t.due_date < ?
     ORDER BY t.due_date`
  ).bind(date).all<ReportTask>();
  const dateMs = Date.parse(`${date}T00:00:00Z`);
  const withAge = overdueRows.map((t) => ({
    ...t,
    days_overdue: Math.max(1, Math.round((dateMs - Date.parse(`${t.due_date}T00:00:00Z`)) / 86_400_000)),
  }));
  const bucketDefs: Array<{ label: string; test: (d: number) => boolean }> = [
    { label: "1-3 days", test: (d) => d <= 3 },
    { label: "4-7 days", test: (d) => d >= 4 && d <= 7 },
    { label: "8-14 days", test: (d) => d >= 8 && d <= 14 },
    { label: "over 14 days", test: (d) => d > 14 },
  ];
  const buckets = bucketDefs.map(({ label, test }) => ({
    label,
    count: withAge.filter((t) => test(t.days_overdue)).length,
  }));
  const byAssigneeMap = new Map<string, number>();
  for (const t of withAge) {
    const key = t.assignee_name ?? "Unassigned";
    byAssigneeMap.set(key, (byAssigneeMap.get(key) ?? 0) + 1);
  }
  const oldest = [...withAge].sort((a, b) => b.days_overdue - a.days_overdue).slice(0, settings.overdue_list_cap);

  // -- Yesterday in one line ----------------------------------------------
  const yCompleted = await db.prepare(
    `SELECT COUNT(*) AS n FROM tasks t
     WHERE t.status = 'completed' AND t.completed_at IS NOT NULL
       AND date(t.completed_at, '${IST}') = ?`
  ).bind(yesterday).first<{ n: number }>();
  const yEnquiries = await db.prepare(
    `SELECT COUNT(*) AS n FROM events e
     WHERE e.is_archived = 0 AND COALESCE(e.enquiry_date, date(e.created_at, '${IST}')) = ?`
  ).bind(yesterday).first<{ n: number }>();
  const yConfirmations = await db.prepare(
    `SELECT COUNT(*) AS n FROM event_status_history h
     WHERE h.to_status = 'confirmed' AND date(h.changed_at, '${IST}') = ?`
  ).bind(yesterday).first<{ n: number }>();

  const decisions = {
    approvals_pending,
    conflicts,
    unassigned_high_priority,
    stale_enquiries,
  };
  const decisionsNeeded =
    approvals_pending.length + conflicts.length + unassigned_high_priority.length + stale_enquiries.length;

  return {
    brief_type: "morning",
    report_date: date,
    generated_at: new Date().toISOString(),
    headline: {
      scheduled_today: today_schedule.length,
      tasks_due_today: dueToday.length,
      overdue: withAge.length,
      decisions_needed: decisionsNeeded,
      new_enquiries_yesterday: yEnquiries?.n ?? 0,
    },
    decisions,
    today_schedule,
    team_plan,
    risk_radar: { low_readiness, blocked_items, overdue_instalments, unsigned_confirmations },
    overdue: {
      total: withAge.length,
      buckets,
      oldest,
      by_assignee: [...byAssigneeMap.entries()]
        .map(([assignee, count]) => ({ assignee, count }))
        .sort((a, b) => b.count - a.count),
    },
    yesterday: {
      completed: yCompleted?.n ?? 0,
      new_enquiries: yEnquiries?.n ?? 0,
      confirmations: yConfirmations?.n ?? 0,
    },
  };
}

// ------------------------------------------------------------ Evening Debrief

export interface EveningBriefContent {
  brief_type: "evening";
  report_date: string;
  generated_at: string;
  scoreboard: {
    due_today: number;
    done_of_due: number;
    still_open: number;
    completion_rate: number; // 0..1 of due-today tasks completed
    done_today_total: number; // everything completed today, due or not
    checklist_due: number;
    checklist_done: number;
  };
  done_by_person: Array<{
    person: string;
    tasks: Array<{ id: string; title: string; event_title: string | null; completion_note: string | null }>;
    checklist: Array<{ label: string; section: string; module: string; event_title: string | null }>;
  }>;
  slipped: AssigneeTasks[];
  new_today: {
    enquiries: Array<EventRef & { enquiry_source: string | null }>;
    status_changes: Array<{ event_id: string; event_title: string | null; from_status: string | null; to_status: string; changed_by_name: string | null; reason: string | null }>;
    confirmations: number;
  };
  tomorrow: { schedule: ScheduledEntry[]; tasks_due: number };
  trend: Array<{ date: string; due: number; done: number }>;
}

export async function buildEveningBrief(db: D1Database, reportDate?: string): Promise<EveningBriefContent> {
  const date = reportDate ?? istToday();
  const tomorrow = addDaysIso(date, 1);

  // -- Plan vs done scoreboard --------------------------------------------
  const dueAgg = await db.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS done,
            SUM(CASE WHEN status IN ('open','in_progress') THEN 1 ELSE 0 END) AS open
     FROM tasks WHERE due_date = ? AND status != 'cancelled'`
  ).bind(date).first<{ total: number; done: number | null; open: number | null }>();
  const doneTodayTotal = await db.prepare(
    `SELECT COUNT(*) AS n FROM tasks
     WHERE status = 'completed' AND completed_at IS NOT NULL AND date(completed_at, '${IST}') = ?`
  ).bind(date).first<{ n: number }>();
  const checklistAgg = await db.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS done
     FROM checklist_items WHERE due_date = ? AND status != 'not_applicable'`
  ).bind(date).first<{ total: number; done: number | null }>();

  const dueTotal = dueAgg?.total ?? 0;
  const doneOfDue = dueAgg?.done ?? 0;

  // -- What got done, grouped by person -------------------------------------
  const { results: tasksDone } = await db.prepare(
    `SELECT t.id, t.title, e.title AS event_title, u.name AS person, t.completion_note
     FROM tasks t
     LEFT JOIN events e ON e.id = t.event_id
     LEFT JOIN users u ON u.id = t.completed_by
     WHERE t.status = 'completed' AND t.completed_at IS NOT NULL AND date(t.completed_at, '${IST}') = ?
     ORDER BY t.completed_at`
  ).bind(date).all<{ id: string; title: string; event_title: string | null; person: string | null; completion_note: string | null }>();
  const { results: checklistDone } = await db.prepare(
    `SELECT ci.label, ci.section, ci.module, e.title AS event_title, u.name AS person
     FROM checklist_items ci
     LEFT JOIN events e ON e.id = ci.event_id
     LEFT JOIN users u ON u.id = ci.completed_by
     WHERE ci.status = 'completed' AND ci.completed_at IS NOT NULL AND date(ci.completed_at, '${IST}') = ?
     ORDER BY ci.completed_at`
  ).bind(date).all<{ label: string; section: string; module: string; event_title: string | null; person: string | null }>();

  const byPerson = new Map<string, EveningBriefContent["done_by_person"][number]>();
  const personEntry = (name: string | null) => {
    const key = name ?? "System";
    if (!byPerson.has(key)) byPerson.set(key, { person: key, tasks: [], checklist: [] });
    return byPerson.get(key)!;
  };
  for (const t of tasksDone) {
    personEntry(t.person).tasks.push({ id: t.id, title: t.title, event_title: t.event_title, completion_note: t.completion_note });
  }
  for (const ci of checklistDone) {
    personEntry(ci.person).checklist.push({ label: ci.label, section: ci.section, module: ci.module, event_title: ci.event_title });
  }
  const done_by_person = [...byPerson.values()]
    .sort((a, b) => (b.tasks.length + b.checklist.length) - (a.tasks.length + a.checklist.length));

  // -- Slipped: due today, still open ---------------------------------------
  const { results: slippedRows } = await db.prepare(
    `${BRIEF_TASK_SELECT}
     WHERE t.status IN ('open','in_progress') AND t.due_date = ?
     ORDER BY t.priority = 'high' DESC, t.created_at`
  ).bind(date).all<ReportTask>();
  const slipped = groupByAssignee(slippedRows);

  // -- New today --------------------------------------------------------------
  const { results: enquiries } = await db.prepare(
    `SELECT e.id AS event_id, e.title AS event_title, o.name AS organisation_name, e.enquiry_source
     FROM events e LEFT JOIN organisations o ON o.id = e.organisation_id
     WHERE e.is_archived = 0 AND COALESCE(e.enquiry_date, date(e.created_at, '${IST}')) = ?
     ORDER BY e.created_at LIMIT 20`
  ).bind(date).all<EveningBriefContent["new_today"]["enquiries"][number]>();
  const { results: status_changes } = await db.prepare(
    `SELECT h.event_id, e.title AS event_title, h.from_status, h.to_status,
            u.name AS changed_by_name, h.reason
     FROM event_status_history h
     LEFT JOIN events e ON e.id = h.event_id
     LEFT JOIN users u ON u.id = h.changed_by
     WHERE date(h.changed_at, '${IST}') = ?
     ORDER BY h.changed_at`
  ).bind(date).all<EveningBriefContent["new_today"]["status_changes"][number]>();
  const confirmations = status_changes.filter((s) => s.to_status === "confirmed").length;

  // -- Tomorrow preview -------------------------------------------------------
  const tomorrowSchedule = await scheduleFor(db, tomorrow);
  const tomorrowTasks = await db.prepare(
    `SELECT COUNT(*) AS n FROM tasks WHERE status IN ('open','in_progress') AND due_date = ?`
  ).bind(tomorrow).first<{ n: number }>();

  // -- 7-day plan-vs-done trend ------------------------------------------------
  const trendStart = addDaysIso(date, -6);
  const { results: trendRows } = await db.prepare(
    `SELECT due_date AS date, COUNT(*) AS due,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS done
     FROM tasks
     WHERE due_date BETWEEN ? AND ? AND status != 'cancelled'
     GROUP BY due_date`
  ).bind(trendStart, date).all<{ date: string; due: number; done: number | null }>();
  const trendMap = new Map(trendRows.map((r) => [r.date, { due: r.due, done: r.done ?? 0 }]));
  const trend: EveningBriefContent["trend"] = [];
  for (let i = 0; i < 7; i++) {
    const d = addDaysIso(trendStart, i);
    const row = trendMap.get(d);
    trend.push({ date: d, due: row?.due ?? 0, done: row?.done ?? 0 });
  }

  return {
    brief_type: "evening",
    report_date: date,
    generated_at: new Date().toISOString(),
    scoreboard: {
      due_today: dueTotal,
      done_of_due: doneOfDue,
      still_open: dueAgg?.open ?? 0,
      completion_rate: dueTotal ? doneOfDue / dueTotal : 1,
      done_today_total: doneTodayTotal?.n ?? 0,
      checklist_due: checklistAgg?.total ?? 0,
      checklist_done: checklistAgg?.done ?? 0,
    },
    done_by_person,
    slipped,
    new_today: { enquiries, status_changes, confirmations },
    tomorrow: { schedule: tomorrowSchedule, tasks_due: tomorrowTasks?.n ?? 0 },
    trend,
  };
}

export type BriefContent = MorningBriefContent | EveningBriefContent;

export async function buildBriefContent(db: D1Database, type: BriefType, reportDate?: string): Promise<BriefContent> {
  return type === "morning" ? buildMorningBrief(db, reportDate) : buildEveningBrief(db, reportDate);
}
