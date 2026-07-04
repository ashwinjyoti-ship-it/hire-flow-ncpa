import { describe, it, expect } from "vitest";
import { buildApp } from "../app";

/**
 * Smoke test for the Hono app. Real domain tests (state machine, notification
 * intervals, task dedupe, IST date handling) land in Phase 6 alongside the
 * logic they cover.
 */
describe("API health", () => {
  it("returns ok on /health", async () => {
    const app = buildApp({} as never);
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; service: string };
    expect(body.ok).toBe(true);
    expect(body.service).toBe("ncpa-hire-api");
  });
});
