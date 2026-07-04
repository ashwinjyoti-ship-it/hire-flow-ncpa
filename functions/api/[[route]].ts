// Pages Function: /api/** catch-all → mounts the shared Hono app.
import { buildApp } from "../../worker";
import type { Env } from "../../worker/env";

export const onRequest: PagesFunction<Env> = async (context) => {
  const app = buildApp(context.env);
  // Forward the incoming request + execution context to Hono.
  return app.fetch(context.request, context.env, context as unknown as ExecutionContext);
};
