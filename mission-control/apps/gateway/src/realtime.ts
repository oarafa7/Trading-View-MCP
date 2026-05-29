/**
 * In-process realtime broadcaster. Sockets subscribe to topics and receive matching events.
 * This is the single-process equivalent of the blueprint's Redis Streams fan-out
 * (docs/mission-control/09-streaming-websockets.md) — swap the publish() backing for Redis
 * to fan out across gateway replicas without changing callers or the client.
 */
export interface RealtimeEvent {
  type: string; // dot-namespaced, e.g. "agent.status_changed"
  ts: string;
  data: unknown;
}

interface Sock {
  send(data: string): void;
}

function topicForType(type: string): string {
  if (type.startsWith("agent.")) return "agents";
  if (type.startsWith("run.")) return "runs";
  if (type.startsWith("usage")) return "usage";
  if (type.startsWith("connector.")) return "connectors";
  if (type.startsWith("workflow.")) return "workflows";
  return "events";
}

export class Realtime {
  private sockets = new Map<Sock, Set<string>>();

  add(sock: Sock): void {
    this.sockets.set(sock, new Set()); // empty set = subscribe to all
  }

  remove(sock: Sock): void {
    this.sockets.delete(sock);
  }

  setTopics(sock: Sock, topics: string[]): void {
    this.sockets.set(sock, new Set(topics));
  }

  get connectionCount(): number {
    return this.sockets.size;
  }

  publish(type: string, data: unknown): void {
    const event: RealtimeEvent = { type, ts: new Date().toISOString(), data };
    const topic = topicForType(type);
    const payload = JSON.stringify(event);
    for (const [sock, topics] of this.sockets) {
      if (topics.size === 0 || topics.has(topic)) {
        try {
          sock.send(payload);
        } catch {
          this.sockets.delete(sock);
        }
      }
    }
  }
}
