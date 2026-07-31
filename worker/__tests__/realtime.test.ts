import { describe, expect, it, vi } from "vitest";
import { publishEventChange } from "../lib/realtime";
import type { Env } from "../env";

describe("event realtime publishing", () => {
  it("publishes one compact message to the affected event and dashboard rooms", async () => {
    const fetch = vi.fn(async (request: Request) => {
      void request;
      return new Response(null, { status: 204 });
    });
    const idFromName = vi.fn((name: string) => name as unknown as DurableObjectId);
    const get = vi.fn(() => ({ fetch }) as unknown as DurableObjectStub);
    const env = {
      EVENT_ROOMS: { idFromName, get } as unknown as DurableObjectNamespace,
    } as Env;

    await publishEventChange(env, "evt_123", "browser_1", ["event", "tasks", "tasks"]);

    expect(idFromName.mock.calls.map(([room]) => room)).toEqual(["event:evt_123", "dashboard"]);
    expect(fetch).toHaveBeenCalledTimes(2);
    const message = await fetch.mock.calls[0]![0].json();
    expect(message).toMatchObject({
      eventId: "evt_123",
      sourceClientId: "browser_1",
      resources: ["event", "tasks"],
    });
  });

  it("does not query or publish when realtime is unavailable", async () => {
    await expect(publishEventChange({} as Env, "evt_123", null)).resolves.toBeUndefined();
  });
});
