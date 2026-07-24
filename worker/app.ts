import { Hono } from "hono";
import type { Env } from "./env";
import { attachUser, type AuthEnv } from "./middleware/auth";
import { authRoutes } from "./routes/auth";
import { settingsRoutes } from "./lib/secrets";
import { organisationRoutes } from "./routes/organisations";
import { eventRoutes } from "./routes/events";
import { calendarRoutes } from "./routes/calendar";
import { lookupRoutes } from "./routes/lookups";
import { userRoutes } from "./routes/users";
import { taskRoutes } from "./routes/tasks";
import { notificationRoutes } from "./routes/notifications";
import { documentRoutes, eventDocumentRoutes } from "./routes/documents";
import { reportRoutes } from "./routes/reports";
import { analyticsRoutes } from "./routes/analytics";
import { announcementRoutes } from "./routes/announcements";
import { stickyNoteRoutes } from "./routes/sticky-notes";

/**
 * Builds the Hono API app, bound to the given environment.
 * Shared by the Pages Function (functions/api) and the scheduler worker.
 *
 * Routes are defined WITHOUT the /api prefix — the Pages Function strips it.
 */
export function buildApp(env: Env): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();

  // Attach the authenticated user (or null) to every request.
  app.use("*", attachUser);

  app.get("/health", (c) =>
    c.json({ ok: true, service: "ncpa-hire-api", ts: new Date().toISOString() })
  );

  // Lookups: dropdown options grouped by list key (public to authenticated users).
  app.get("/lookups", async (c) => {
    const { results } = await env.DB.prepare(
      `SELECT list_key, value, sort_order, metadata FROM dropdown_options WHERE is_active = 1 ORDER BY list_key, sort_order`
    ).all();
    const grouped: Record<string, Array<{ value: string; metadata?: unknown }>> = {};
    for (const r of results as Array<{ list_key: string; value: string; metadata: string | null }>) {
      const key = r.list_key;
      if (!grouped[key]) grouped[key] = [];
      let metadata: unknown = undefined;
      try { metadata = r.metadata ? JSON.parse(r.metadata) : undefined; } catch { /* ignore */ }
      grouped[key].push({ value: r.value, metadata });
    }
    return c.json({ lookups: grouped });
  });

  // Auth routes (login, mfa, me, logout, mfa setup/confirm/disable, recovery).
  app.route("/auth", authRoutes);

  // Settings routes (admin-only: Resend key + mail-from with configured-check).
  app.route("/settings", settingsRoutes);

  // Organisation & contact routes.
  app.route("/organisations", organisationRoutes);

  // Event routes (with nested venue bookings + schedule entries).
  app.route("/events", eventRoutes);

  // Event-scoped document upload/list (R2-backed via the FILES binding).
  app.route("/events", eventDocumentRoutes);

  // Document metadata / download / archive.
  app.route("/documents", documentRoutes);

  // Calendar routes (schedule entries in a date range).
  app.route("/calendar", calendarRoutes);

  // Lookup (dropdown_options) admin CRUD — public reads still go to GET /lookups above.
  app.route("/lookups", lookupRoutes);
  app.route("/users", userRoutes);

  // Operational workflow routes.
  app.route("/tasks", taskRoutes);
  app.route("/notifications", notificationRoutes);

  // Daily operational reports (immutable snapshots) + analytics.
  app.route("/reports", reportRoutes);
  app.route("/analytics", analyticsRoutes);

  // Pinned team announcement (admin → whole team, shown on the Dashboard).
  app.route("/announcements", announcementRoutes);

  // Shared call-capture corkboard (all authenticated team accounts).
  app.route("/sticky-notes", stickyNoteRoutes);

  return app;
}
