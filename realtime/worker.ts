import type { RealtimeChange } from "../worker/lib/realtime";

export type RealtimeEnv = object;

export class EventRoom implements DurableObject {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/connect") {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return new Response("WebSocket upgrade required", { status: 426 });
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.state.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === "/publish" && request.method === "POST") {
      const message = await request.json<RealtimeChange>();
      const encoded = JSON.stringify(message);
      for (const socket of this.state.getWebSockets()) {
        try {
          socket.send(encoded);
        } catch {
          socket.close(1011, "Delivery failed");
        }
      }
      return new Response(null, { status: 204 });
    }
    return new Response("Not found", { status: 404 });
  }

  webSocketMessage(): void {
    // Connections are receive-only; clients need not send heartbeats.
  }

  webSocketClose(socket: WebSocket, code: number, reason: string): void {
    socket.close(code, reason);
  }
}

export default {
  fetch: () => new Response("Not found", { status: 404 }),
} satisfies ExportedHandler<RealtimeEnv>;
