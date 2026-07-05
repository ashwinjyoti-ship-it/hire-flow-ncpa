/**
 * Cron Worker: ncpa-hire-scheduler.
 * Runs idempotent scheduled jobs on a 30-minute trigger (see scheduler/wrangler.jsonc).
 * Runs operational jobs for automatic task creation and due-task notifications.
 */
import { runOperationalJobs } from "../../worker/lib/operations";
import { dispatchPendingEmailNotifications } from "../../worker/lib/email";

export default {
  async scheduled(_controller: ScheduledController, env: { DB: D1Database; TZ: string; MAIL_FROM: string; RESEND_API_KEY?: string }): Promise<void> {
    await runOperationalJobs(env.DB).catch(async (err) => {
      await env.DB.prepare(
        "INSERT INTO scheduler_runs (ran_at, job, note, rows_affected) VALUES (?, ?, ?, 0)"
      ).bind(new Date().toISOString(), "operational_jobs", `failed: ${(err as Error).message}`).run();
    });
    await dispatchPendingEmailNotifications(env).catch(async (err) => {
      await env.DB.prepare(
        "INSERT INTO scheduler_runs (ran_at, job, note, rows_affected) VALUES (?, ?, ?, 0)"
      ).bind(new Date().toISOString(), "email_notifications", `failed: ${(err as Error).message}`).run();
    });
  },
} satisfies ExportedHandler<{ DB: D1Database; TZ: string; MAIL_FROM: string; RESEND_API_KEY?: string }>;
