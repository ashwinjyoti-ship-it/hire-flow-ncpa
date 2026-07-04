/**
 * Cron Worker: ncpa-hire-scheduler.
 * Runs idempotent scheduled jobs on a 30-minute trigger (see scheduler/wrangler.jsonc).
 * Phase 6 implements the real job handlers (task creation, notification evaluation,
 * overdue detection, post-event checks). Until then this is a heartbeat.
 */
export default {
  async scheduled(_controller: ScheduledController, env: { DB: D1Database; TZ: string }): Promise<void> {
    // Heartbeat: record that the scheduler ran. Idempotent-safe no-op for now.
    const now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO scheduler_runs (ran_at, note) VALUES (?, ?)"
    )
      .bind(now, "heartbeat")
      .run()
      .catch(() => {
        // Table may not exist yet (pre-Phase-2 migration). Swallow until schema lands.
      });
  },
} satisfies ExportedHandler<{ DB: D1Database; TZ: string }>;
