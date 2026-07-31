import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

type RealtimeChange = {
  eventId: string;
  sourceClientId: string | null;
  resources: Array<"event" | "checklist" | "tasks" | "documents">;
};

const CLIENT_ID = crypto.randomUUID();

export function realtimeClientId(): string {
  return CLIENT_ID;
}

function websocketUrl(path: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/realtime/${path}`;
}

export function useEventRealtime(eventId: string | undefined): void {
  const queryClient = useQueryClient();
  useRealtimeSocket(eventId ? `events/${encodeURIComponent(eventId)}` : null, (change) => {
    if (!eventId || change.eventId !== eventId || change.sourceClientId === realtimeClientId()) return;
    if (change.resources.includes("event")) {
      void queryClient.invalidateQueries({ queryKey: ["event", eventId] });
    }
    if (change.resources.includes("checklist")) {
      void queryClient.invalidateQueries({ queryKey: ["event", eventId, "checklist"] });
    }
    if (change.resources.includes("tasks")) {
      void queryClient.invalidateQueries({ queryKey: ["tasks", eventId] });
    }
    if (change.resources.includes("documents")) {
      void queryClient.invalidateQueries({ queryKey: ["event", eventId, "documents"] });
    }
  });
}

export function useDashboardRealtime(): void {
  const queryClient = useQueryClient();
  useRealtimeSocket("dashboard", (change) => {
    if (change.sourceClientId === realtimeClientId()) return;
    void queryClient.invalidateQueries({ queryKey: ["calendar-lifecycle", "dashboard"] });
    void queryClient.invalidateQueries({ queryKey: ["tasks", "dashboard"] });
  });
}

function useRealtimeSocket(path: string | null, onChange: (change: RealtimeChange) => void): void {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    if (!path) return;
    let socket: WebSocket | null = null;
    let retryTimer: number | null = null;
    let retry = 0;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      socket = new WebSocket(websocketUrl(path));
      socket.addEventListener("open", () => { retry = 0; });
      socket.addEventListener("message", (event) => {
        try {
          onChangeRef.current(JSON.parse(String(event.data)) as RealtimeChange);
        } catch {
          // Ignore malformed messages and keep the live connection healthy.
        }
      });
      socket.addEventListener("close", () => {
        if (disposed) return;
        const delay = Math.min(30_000, 1_000 * 2 ** retry++);
        retryTimer = window.setTimeout(connect, delay);
      });
    };

    connect();
    return () => {
      disposed = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      socket?.close(1000, "View closed");
    };
  }, [path]);
}
