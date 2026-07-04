import { Hono } from "hono";
import type { Env } from "./env";

/**
 * Builds the Hono API app, bound to the given environment.
 * Shared by the Pages Function (functions/api) and the scheduler worker.
 * Route groups are mounted in subsequent phases (auth, orgs, events, …).
 */
export function buildApp(env: Env): Hono {
  const app = new Hono();

  app.get("/health", (c) =>
    c.json({ ok: true, service: "ncpa-hire-api", ts: new Date().toISOString() })
  );

  // Phase 2+ route groups are mounted here as implemented:
  //   app.route("/auth", authRoutes)
  //   app.route("/events", eventRoutes)
  //   ...

  // Temp stub for /auth/me so the SPA shell loads before Phase 3 wires real auth.
  app.get("/auth/me", (c) => {
    void env;
    return c.json({ user: null });
  });

  return app;
}
