import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("scoped realtime subscriptions", () => {
  const source = readFileSync(new URL("./realtime.ts", import.meta.url), "utf8");

  it("subscribes event views to their event room and dashboard views to dashboard", () => {
    expect(source).toContain("events/${encodeURIComponent(eventId)}");
    expect(source).toContain('useRealtimeSocket("dashboard"');
  });

  it("ignores the originating browser and invalidates resource-specific caches", () => {
    expect(source).toContain("change.sourceClientId === realtimeClientId()");
    expect(source).toContain('change.resources.includes("checklist")');
    expect(source).toContain('change.resources.includes("documents")');
  });

  it("reconnects with capped exponential backoff", () => {
    expect(source).toContain("Math.min(30_000, 1_000 * 2 ** retry++)");
  });
});
