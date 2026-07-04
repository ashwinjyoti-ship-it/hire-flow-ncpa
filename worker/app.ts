import { Hono } from "hono";
import type { Env } from "./env";
import { attachUser, type AuthEnv } from "./middleware/auth";
import { authRoutes } from "./routes/auth";
import { settingsRoutes } from "./lib/secrets";

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

  // Auth routes (login, mfa, me, logout, mfa setup/confirm/disable, recovery).
  app.route("/auth", authRoutes);

  // Settings routes (admin-only: Resend key + mail-from with configured-check).
  app.route("/settings", settingsRoutes);

  void env;
  return app;
}
