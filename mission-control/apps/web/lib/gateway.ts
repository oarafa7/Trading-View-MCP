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

export interface ConnectorHealth {
  id: string;
  name: string;
  status: "ok" | "degraded" | "down";
  toolCount: number;
  tools: string[];
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
  connectors: () => getJSON<ConnectorHealth[]>("/v1/connectors"),
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
 * POST to an SSE endpoint and dispatch each frame to `onFrame`. EventSource only supports GET,
 * so we read the body stream manually. Shared by chat and workflow streaming.
 */
async function postSSE(
  path: string,
  body: unknown,
  onFrame: (event: string, data: any) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${GATEWAY}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    onFrame("error", { code: "HTTP", message: `gateway responded ${res.status}` });
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
      try {
        onFrame(event, JSON.parse(dataLines.join("\n")));
      } catch {
        /* ignore non-JSON frames */
      }
    }
  }
}

/** Stream an agent reply over POST+SSE. */
export function streamMessage(
  conversationId: string,
  content: string,
  agentId: string,
  h: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  return postSSE(
    `/v1/conversations/${conversationId}/messages`,
    { content, agentId },
    (event, data) => {
      if (event === "token") h.onToken?.(data.delta);
      else if (event === "reasoning") h.onReasoning?.(data.delta);
      else if (event === "tool_call") h.onToolCall?.(data.name, data.argsDelta);
      else if (event === "tool_call_done") h.onToolCallDone?.(data);
      else if (event === "awaiting_approval") h.onAwaitingApproval?.(data);
      else if (event === "tool_result") h.onToolResult?.(data);
      else if (event === "usage") h.onUsage?.(data);
      else if (event === "done") h.onDone?.();
      else if (event === "error") h.onError?.(data);
    },
    signal,
  );
}

export interface WorkflowNode {
  id: string;
  type: "agent" | "tool";
  agentId?: string;
  connectorId?: string;
  tool?: string;
  prompt?: string;
}
export interface Workflow {
  id: string;
  name: string;
  graph: { entry: string; nodes: WorkflowNode[]; edges: { from: string; to: string; whenContains?: string }[] };
}

export interface WorkflowHandlers {
  onNodeStarted?: (info: { nodeId: string; nodeType: string }) => void;
  onNodeToken?: (info: { nodeId: string; delta: string }) => void;
  onNodeCompleted?: (info: { nodeId: string; output: string }) => void;
  onCompleted?: (state: Record<string, string>) => void;
  onError?: (err: { message: string }) => void;
}

/** Run a workflow and stream node-level progress. */
export function streamWorkflow(workflowId: string, input: string, h: WorkflowHandlers, signal?: AbortSignal): Promise<void> {
  return postSSE(
    `/v1/workflows/${workflowId}/run`,
    { input },
    (event, data) => {
      if (event === "node_started") h.onNodeStarted?.(data);
      else if (event === "node_token") h.onNodeToken?.(data);
      else if (event === "node_completed") h.onNodeCompleted?.(data);
      else if (event === "workflow_completed") h.onCompleted?.(data.state);
      else if (event === "error") h.onError?.(data);
    },
    signal,
  );
}

export const workflowsApi = {
  list: () => getJSON<Workflow[]>("/v1/workflows"),
};
