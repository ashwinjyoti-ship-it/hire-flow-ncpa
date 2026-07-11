/**
 * Daily operational report: builds the immutable JSON snapshot saved to
 * `daily_reports`. Reports run on Asia/Kolkata dates; timestamps stored in
 * UTC are shifted by +330 minutes when matched against the report date.
 *
 * Sections (per the Phase 7 spec):
 *   scheduled     — schedule entries (setup/rehearsal/show/…) on the date
 *   system_tasks  — automatic tasks due on the date
 *   manual_tasks  — manual tasks due on the date
 *   work_achieved — tasks completed, checklist items completed and status
 *                   changes recorded on the date
 *   outstanding   — open tasks due on or before the date (overdue included)
 */

export const IST_OFFSET_MINUTES = 330;

/** Today's date (yyyy-mm-dd) in Asia/Kolkata. */
export function istToday(now: Date = new Date()): string {
  return new Date(now.getTime() + IST_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

export interface ScheduledEntry {
  venue: string;
  activity_type: string;
  start_time: string | null;
  end_time: string | null;
  event_id: string;
  event_title: string;
  event_status: string;
  organisation_name: string | null;
}

export interface ReportTask {
  id: string;
  title: string;
  task_type: string;
  status: string;
  priority: string;
  due_date: string | null;
  event_id: string | null;
  event_title: string | null;
  assignee_name: string | null;
}

export interface DailyReportContent {
  report_date: string;
  generated_at: string;
  scheduled: ScheduledEntry[];
  system_tasks: ReportTask[];
  manual_tasks: ReportTask[];
  work_achieved: {
    tasks_completed: Array<{ id: string; title: string; event_title: string | null; completed_by_name: string | null; completion_note: string | null }>;
    checklist_completed: Array<{ label: string; section: string; module: string; event_title: string | null; completed_by_name: string | null }>;
    status_changes: Array<{ event_id: string; event_title: string | null; from_status: string | null; to_status: string; changed_by_name: string | null; reason: string | null }>;
  };
  outstanding: Array<ReportTask & { days_overdue: number }>;
  totals: {
    scheduled: number;
    system_tasks: number;
    manual_tasks: number;
    work_achieved: number;
    outstanding: number;
  };
}

const REPORT_TASK_SELECT = `
  SELECT t.id, t.title, t.task_type, t.status, t.priority, t.due_date, t.event_id,
         e.title AS event_title, u.name AS assignee_name
  FROM tasks t
  LEFT JOIN events e ON e.id = t.event_id
  LEFT JOIN users u ON u.id = t.assignee_id`;

/** Build the full report snapshot for the given IST date. */
export async function buildDailyReportContent(db: D1Database, reportDate: string): Promise<DailyReportContent> {
  const { results: scheduled } = await db.prepare(
    `SELECT vb.venue, se.activity_type, se.start_time, se.end_time,
            e.id AS event_id, e.title AS event_title, e.status AS event_status,
            o.name AS organisation_name
     FROM schedule_entries se
     JOIN venue_bookings vb ON vb.id = se.venue_booking_id
     JOIN events e ON e.id = se.event_id
     LEFT JOIN organisations o ON o.id = e.organisation_id
     WHERE se.activity_date = ? AND e.is_archived = 0 AND e.status NOT IN ('cancelled','regret')
     ORDER BY vb.venue, COALESCE(se.start_time, '99'), se.sort_order`
  ).bind(reportDate).all<ScheduledEntry>();

  const { results: systemTasks } = await db.prepare(
    `${REPORT_TASK_SELECT}
     WHERE t.task_type = 'automatic' AND t.due_date = ?
     ORDER BY t.priority = 'high' DESC, t.created_at`
  ).bind(reportDate).all<ReportTask>();

  const { results: manualTasks } = await db.prepare(
    `${REPORT_TASK_SELECT}
     WHERE t.task_type = 'manual' AND t.due_date = ?
     ORDER BY t.priority = 'high' DESC, t.created_at`
  ).bind(reportDate).all<ReportTask>();

  const { results: tasksCompleted } = await db.prepare(
    `SELECT t.id, t.title, e.title AS event_title, u.name AS completed_by_name, t.completion_note
     FROM tasks t
     LEFT JOIN events e ON e.id = t.event_id
     LEFT JOIN users u ON u.id = t.completed_by
     WHERE t.status = 'completed' AND t.completed_at IS NOT NULL
       AND date(t.completed_at, '+${IST_OFFSET_MINUTES} minutes') = ?
     ORDER BY t.completed_at`
  ).bind(reportDate).all<DailyReportContent["work_achieved"]["tasks_completed"][number]>();

  const { results: checklistCompleted } = await db.prepare(
    `SELECT ci.label, ci.section, ci.module, e.title AS event_title, u.name AS completed_by_name
     FROM checklist_items ci
     LEFT JOIN events e ON e.id = ci.event_id
     LEFT JOIN users u ON u.id = ci.completed_by
     WHERE ci.status = 'completed' AND ci.completed_at IS NOT NULL
       AND date(ci.completed_at, '+${IST_OFFSET_MINUTES} minutes') = ?
     ORDER BY ci.completed_at`
  ).bind(reportDate).all<DailyReportContent["work_achieved"]["checklist_completed"][number]>();

  const { results: statusChanges } = await db.prepare(
    `SELECT h.event_id, e.title AS event_title, h.from_status, h.to_status, u.name AS changed_by_name, h.reason
     FROM event_status_history h
     LEFT JOIN events e ON e.id = h.event_id
     LEFT JOIN users u ON u.id = h.changed_by
     WHERE date(h.changed_at, '+${IST_OFFSET_MINUTES} minutes') = ?
     ORDER BY h.changed_at`
  ).bind(reportDate).all<DailyReportContent["work_achieved"]["status_changes"][number]>();

  const { results: outstandingRows } = await db.prepare(
    `${REPORT_TASK_SELECT}
     WHERE t.status IN ('open','in_progress') AND t.due_date IS NOT NULL AND t.due_date <= ?
     ORDER BY t.due_date, t.priority = 'high' DESC`
  ).bind(reportDate).all<ReportTask>();

  const reportDateMs = Date.parse(`${reportDate}T00:00:00Z`);
  const outstanding = outstandingRows.map((t) => ({
    ...t,
    days_overdue: t.due_date
      ? Math.max(0, Math.round((reportDateMs - Date.parse(`${t.due_date}T00:00:00Z`)) / 86_400_000))
      : 0,
  }));

  const workAchievedCount = tasksCompleted.length + checklistCompleted.length + statusChanges.length;
  return {
    report_date: reportDate,
    generated_at: new Date().toISOString(),
    scheduled,
    system_tasks: systemTasks,
    manual_tasks: manualTasks,
    work_achieved: {
      tasks_completed: tasksCompleted,
      checklist_completed: checklistCompleted,
      status_changes: statusChanges,
    },
    outstanding,
    totals: {
      scheduled: scheduled.length,
      system_tasks: systemTasks.length,
      manual_tasks: manualTasks.length,
      work_achieved: workAchievedCount,
      outstanding: outstanding.length,
    },
  };
}
