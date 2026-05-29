export const GATEWAY = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:4000";

export interface Agent {
  id: string;
  name: string;
  kind: string;
  systemPrompt: string;
  modelId: string;
  status: "idle" | "running" | "awaiting_approval" | "error" | "disabled";
  costToDate: number;
  settings?: { temperature?: number };
}

export interface Model {
  id: string;
  provider: string;
  modelId: string;
  displayName: string;
}

export interface Conversation {
  id: string;
  title: string;
  participantAgentIds: string[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  agentId?: string;
}

export interface UsageRollup {
  groupBy: string;
  totalCostUsd: number;
  buckets: { key: string; costUsd: number; inputTokens: number; outputTokens: number; calls: number }[];
}

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${GATEWAY}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  agents: () => getJSON<Agent[]>("/v1/agents"),
  models: () => getJSON<Model[]>("/v1/models"),
  conversations: () => getJSON<Conversation[]>("/v1/conversations"),
  messages: (id: string) => getJSON<ChatMessage[]>(`/v1/conversations/${id}/messages`),
  usage: (groupBy = "agent") => getJSON<UsageRollup>(`/v1/usage?groupBy=${groupBy}`),
  async createConversation(participantAgentIds: string[], title = "New conversation"): Promise<Conversation> {
    const res = await fetch(`${GATEWAY}/v1/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, participantAgentIds }),
    });
    return res.json() as Promise<Conversation>;
  },
};

export interface StreamHandlers {
  onToken?: (delta: string) => void;
  onReasoning?: (delta: string) => void;
  onToolCall?: (name: string, argsDelta: string) => void;
  onToolCallDone?: (info: { id: string; name: string; args: unknown }) => void;
  onAwaitingApproval?: (info: { runId: string; toolCallId: string; name: string; args: unknown }) => void;
  onToolResult?: (info: { toolCallId: string; name: string; ok: boolean; result: unknown }) => void;
  onUsage?: (usage: { costUsd: number; inputTokens: number; outputTokens: number }) => void;
  onDone?: () => void;
  onError?: (err: { code: string; message: string }) => void;
}

/** Approve or reject a gated tool call that the run is waiting on. */
export async function decideApproval(
  runId: string,
  toolCallId: string,
  decision: "approve" | "reject",
): Promise<void> {
  await fetch(`${GATEWAY}/v1/runs/${runId}/approvals/${toolCallId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision }),
  });
}

/**
 * Stream an agent reply. The gateway endpoint is POST+SSE, so we read the body manually
 * (EventSource only supports GET).
 */
export async function streamMessage(
  conversationId: string,
  content: string,
  agentId: string,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${GATEWAY}/v1/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify({ content, agentId }),
    signal,
  });

  if (!res.ok || !res.body) {
    handlers.onError?.({ code: "HTTP", message: `gateway responded ${res.status}` });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let event = "message";
      const dataLines: string[] = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length === 0) continue;
      let data: any;
      try {
        data = JSON.parse(dataLines.join("\n"));
      } catch {
        continue;
      }
      switch (event) {
        case "token":
          handlers.onToken?.(data.delta);
          break;
        case "reasoning":
          handlers.onReasoning?.(data.delta);
          break;
        case "tool_call":
          handlers.onToolCall?.(data.name, data.argsDelta);
          break;
        case "tool_call_done":
          handlers.onToolCallDone?.(data);
          break;
        case "awaiting_approval":
          handlers.onAwaitingApproval?.(data);
          break;
        case "tool_result":
          handlers.onToolResult?.(data);
          break;
        case "usage":
          handlers.onUsage?.(data);
          break;
        case "done":
          handlers.onDone?.();
          break;
        case "error":
          handlers.onError?.(data);
          break;
      }
    }
  }
}
