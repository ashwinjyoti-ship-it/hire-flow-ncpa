import type { Env } from "../env";

export type RealtimeChange = {
  eventId: string;
  sourceClientId: string | null;
  resources: Array<"event" | "checklist" | "tasks" | "documents">;
  changedAt: string;
};

function roomStub(env: Env, room: string): DurableObjectStub | null {
  if (!env.EVENT_ROOMS) return null;
  return env.EVENT_ROOMS.get(env.EVENT_ROOMS.idFromName(room));
}

export async function publishEventChange(
  env: Env,
  eventId: string | null | undefined,
  sourceClientId: string | null,
  resources: RealtimeChange["resources"] = ["event"],
): Promise<void> {
  if (!eventId || !env.EVENT_ROOMS) return;
  const change: RealtimeChange = {
    eventId,
    sourceClientId,
    resources: [...new Set(resources)],
    changedAt: new Date().toISOString(),
  };
  const request = () => new Request("https://room.internal/publish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(change),
  });
  // Realtime delivery is best-effort: a room outage must never turn a committed
  // D1 mutation into an apparent failure (which would incorrectly roll back UI).
  await Promise.allSettled([
    roomStub(env, `event:${eventId}`)?.fetch(request()),
    roomStub(env, "dashboard")?.fetch(request()),
  ]);
}

export function realtimeClientId(request: Request): string | null {
  return request.headers.get("X-Realtime-Client")?.slice(0, 100) || null;
}
