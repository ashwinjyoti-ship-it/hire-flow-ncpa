/**
 * Scheduled generation + delivery of the Morning Brief and Evening Debrief.
 *
 * The cron worker fires every 30 minutes; this job is catch-up-safe and
 * idempotent per (date, type): once IST time passes the configured send time
 * (07:30 / 18:30 by default), the first run that finds no auto-generated
 * snapshot for the day generates one, emails it to active Admins and Venue
 * Managers via Resend, and drops an in-app notification. Manual snapshots
 * (generated_by set) never suppress the automatic one.
 */
import type { Env } from "../env";
import { makeId } from "./id";
import { istToday, IST_OFFSET_MINUTES } from "./daily-report";
import { buildBriefContent, getBriefSettings, type BriefType } from "./brief";
import { briefTitle, renderBriefEmail } from "./brief-html";
import { sendHtmlEmail } from "./email";
import { createNotification } from "./operations";

type BriefEnv = Pick<Env, "DB" | "MAIL_FROM" | "RESEND_API_KEY"> & { APP_URL?: string };

/** Current IST time as HH:MM. */
export function istNowHHMM(now: Date = new Date()): string {
  return new Date(now.getTime() + IST_OFFSET_MINUTES * 60_000).toISOString().slice(11, 16);
}

const BRIEF_RECIPIENT_ROLES = ["admin", "venue_manager"] as const;

export async function runBriefJobs(env: BriefEnv, now: Date = new Date()): Promise<{ generated: BriefType[] }> {
  const db = env.DB;
  const settings = await getBriefSettings(db);
  const today = istToday(now);
  const hhmm = istNowHHMM(now);
  const generated: BriefType[] = [];

  const due: Array<{ type: BriefType; sendTime: string }> = [
    { type: "morning", sendTime: settings.morning_time },
    { type: "evening", sendTime: settings.evening_time },
  ];

  for (const { type, sendTime } of due) {
    if (hhmm < sendTime) continue;

    const existing = await db.prepare(
      `SELECT 1 AS found FROM daily_reports
       WHERE report_date = ? AND report_type = ? AND generated_by IS NULL LIMIT 1`
    ).bind(today, type).first<{ found: number }>();
    if (existing) continue;

    const content = await buildBriefContent(db, type, today);
    const id = makeId("rep");
    await db.prepare(
      `INSERT INTO daily_reports (id, report_date, report_type, generated_by, generated_at, content, notes)
       VALUES (?, ?, ?, NULL, ?, ?, 'Generated automatically')`
    ).bind(id, today, type, content.generated_at, JSON.stringify(content)).run();
    generated.push(type);

    // In-app notification for the manager roles (idempotent per date+type+role).
    const title = type === "morning" ? "Morning Brief is ready" : "Evening Debrief is ready";
    for (const role of BRIEF_RECIPIENT_ROLES) {
      await createNotification(db, {
        idempotencyKey: `brief:${type}:${today}:${role}`,
        recipientRole: role,
        title,
        body: `${briefTitle(content)} — open Reports to view it.`,
      });
    }

    // Email digest to every active Admin / Venue Manager.
    let emailNote = "email disabled";
    if (settings.email_enabled) {
      const { results: recipients } = await db.prepare(
        `SELECT email, name FROM users
         WHERE is_active = 1 AND role IN ('admin','venue_manager') AND email IS NOT NULL`
      ).all<{ email: string; name: string }>();
      const html = renderBriefEmail(content, env.APP_URL ?? "");
      const subject = `${type === "morning" ? "☀️" : "🌙"} ${briefTitle(content)} — NCPA Venue for Hire`;
      let sent = 0;
      let failed = 0;
      for (const r of recipients) {
        const res = await sendHtmlEmail(env, { to: r.email, subject, html });
        if (res.ok) sent++;
        else failed++;
      }
      emailNote = `emailed ${sent}/${recipients.length}${failed ? ` (${failed} failed)` : ""}`;
    }

    await db.prepare(
      "INSERT INTO scheduler_runs (ran_at, job, note, rows_affected) VALUES (?, ?, ?, 1)"
    ).bind(new Date().toISOString(), `brief_${type}`, `Generated ${type} brief for ${today}; ${emailNote}`).run();
  }

  return { generated };
}
