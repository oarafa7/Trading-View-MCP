import { GATEWAY } from "./gateway";

export interface RealtimeEvent {
  type: string;
  ts: string;
  data: any;
}

/** Open a workspace realtime socket, subscribe to topics, and stream events to `onEvent`. */
export function openRealtime(topics: string[], onEvent: (ev: RealtimeEvent) => void): () => void {
  // Same-origin when GATEWAY is empty (single-origin deploy); else derive ws from the gateway URL.
  const base = GATEWAY || (typeof window !== "undefined" ? window.location.origin : "");
  const url = base.replace(/^http/, "ws") + "/v1/realtime";
  let closed = false;
  let ws: WebSocket | null = null;

  const connect = () => {
    if (closed) return;
    ws = new WebSocket(url);
    ws.onopen = () => ws?.send(JSON.stringify({ op: "subscribe", topics }));
    ws.onmessage = (e) => {
      try {
        onEvent(JSON.parse(e.data));
      } catch {
        /* ignore */
      }
    };
    ws.onclose = () => {
      if (!closed) setTimeout(connect, 1500); // simple reconnect
    };
  };
  connect();

  return () => {
    closed = true;
    ws?.close();
  };
}
