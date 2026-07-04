// Pages Function: /api/** catch-all → mounts the shared Hono app.
// Strips the /api prefix so Hono routes are defined cleanly (e.g. "/health").
import { buildApp } from "../../worker/app";
import type { Env } from "../../worker/env";

export const onRequest: PagesFunction<Env> = async (context) => {
  const app = buildApp(context.env);

  // Rewrite the URL to drop the "/api" prefix for Hono's internal router.
  const url = new URL(context.request.url);
  const newPath = url.pathname.replace(/^\/api/, "") || "/";
  const newUrl = new URL(newPath, url.origin);
  // Preserve query string.
  newUrl.search = url.search;
  const rewritten = new Request(newUrl, context.request);

  return app.fetch(rewritten, context.env, context as unknown as ExecutionContext);
};
