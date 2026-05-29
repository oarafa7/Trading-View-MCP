import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { z } from "zod";
import { ProviderRegistry } from "@mc/providers";
import { AgentRuntime, WorkflowEngine, id, nowIso, type ResolvedTool, type RunEvent } from "@mc/agent-core";
import type { AgentDefinition } from "@mc/types";
import { MemoryStore } from "./store.js";
import { loadConfig, makeModelResolver } from "./config.js";
import { MemoryService } from "@mc/memory";
import { SSEStream } from "./sse.js";
import { buildConnectors } from "./connectors.js";
import { Realtime } from "./realtime.js";
import { seedKnowledge } from "./knowledge.js";
import { installAuth, requirePerm } from "./auth.js";

const config = loadConfig();
const store = new MemoryStore();
const registry = new ProviderRegistry();
const runtime = new AgentRuntime(registry, makeModelResolver(store));
const connectors = buildConnectors();
const realtime = new Realtime();
const memory = new MemoryService();
seedKnowledge(memory, store.workspaceId);

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
await app.register(cors, { origin: true, credentials: true });
await app.register(websocket);
installAuth(app, store.workspaceId);
await connectors.connectAll((msg) => app.log.info(msg));

/** Update an agent's live status and broadcast the change to subscribed dashboards. */
function setAgentStatus(agent: AgentDefinition, status: AgentDefinition["status"]): void {
  agent.status = status;
  agent.updatedAt = nowIso();
  realtime.publish("agent.status_changed", { agentId: agent.id, status, costToDate: agent.costToDate });
}

// Pending HITL approvals, keyed by toolCallId. Resolved by POST /v1/runs/:runId/approvals/:id.
const pendingApprovals = new Map<string, (approved: boolean) => void>();

/** Resolve an agent's tool grants into runnable tool specs (skipping any whose connector is down). */
function resolveTools(agent: AgentDefinition): ResolvedTool[] {
  const out: ResolvedTool[] = [];
  for (const g of agent.tools) {
    const spec = connectors.toolSpec(g.connectorId, g.toolName);
    if (spec) out.push({ spec, connectorId: g.connectorId, requireApproval: g.requireApproval });
  }
  return out;
}

// Workflow engine: runs agent nodes via the agent runtime, tool nodes via the connector pool.
const workflowEngine = new WorkflowEngine((g, nodeId) => g.nodes.find((n) => n.id === nodeId), {
  async *runAgentNode(agentId, prompt): AsyncGenerator<RunEvent> {
    const agent = store.agents.get(agentId);
    if (!agent) {
      yield { type: "error", error: { code: "BAD_REQUEST", message: `unknown agent "${agentId}"`, retryable: false } };
      return;
    }
    const tools = resolveTools(agent);
    for await (const ev of runtime.run({
      agent,
      history: [{ role: "user", content: prompt }],
      tools: tools.length ? tools : undefined,
      executeTool: (c, n, a) => connectors.call(c, n, a),
      requestApproval: async () => true, // workflow nodes auto-approve (workflow-level HITL is future)
    })) {
      if (ev.type === "usage") {
        store.recordUsage(ev.event);
        realtime.publish("usage.recorded", { ...ev.event, agentCostToDate: agent.costToDate });
      }
      yield ev;
    }
  },
  runToolNode: (connectorId, tool, args) => connectors.call(connectorId, tool, args),
});

// --- health ---
app.get("/v1/health", async () => ({
  ok: true,
  ts: nowIso(),
  providers: ["mock", "openai", "anthropic", "groq", "openrouter", "together", "ollama"],
}));

app.get("/v1/workspaces", async () => [{ id: store.workspaceId, name: "Default Workspace" }]);

// --- current principal (who am I + what can I do) ---
app.get("/v1/me", async (req) => req.principal);

// --- realtime workspace state (WebSocket) ---
app.get("/v1/realtime", { websocket: true }, (socket: { send: (d: string) => void; on: (ev: string, cb: (raw?: unknown) => void) => void }) => {
  realtime.add(socket);
  socket.send(JSON.stringify({ type: "hello", ts: nowIso(), data: { ok: true } }));
  socket.on("message", (raw?: unknown) => {
    try {
      const msg = JSON.parse(String(raw));
      if (msg.op === "subscribe" && Array.isArray(msg.topics)) realtime.setTopics(socket, msg.topics);
    } catch {
      /* ignore malformed control frames */
    }
  });
  socket.on("close", () => realtime.remove(socket));
});

// --- models ---
app.get("/v1/models", async () => [...store.models.values()]);

// --- connectors ---
app.get("/v1/connectors", async () =>
  connectors.health().map((h) => ({ ...h, tools: connectors.toolsFor(h.id).map((t) => t.name) })),
);

// --- knowledge base / RAG ---
app.get("/v1/knowledge", async () => ({
  sources: memory.listSources(store.workspaceId),
  stats: memory.stats(store.workspaceId),
}));

const IngestDoc = z.object({ title: z.string().min(1), text: z.string().min(1) });
app.post("/v1/knowledge", async (req, reply) => {
  if (!requirePerm(req, reply, "knowledge:write")) return;
  const parsed = IngestDoc.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ code: "BAD_REQUEST", message: parsed.error.message });
  const source = memory.ingest(store.workspaceId, parsed.data.title, parsed.data.text);
  return reply.code(201).send(source);
});

const SearchDoc = z.object({ query: z.string().min(1), topK: z.number().int().positive().max(20).default(5) });
app.post("/v1/knowledge/search", async (req, reply) => {
  const parsed = SearchDoc.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ code: "BAD_REQUEST", message: parsed.error.message });
  return { query: parsed.data.query, chunks: memory.retrieve(store.workspaceId, parsed.data.query, parsed.data.topK) };
});

// --- workflows ---
app.get("/v1/workflows", async () => [...store.workflows.values()]);

app.get("/v1/workflows/:id", async (req, reply) => {
  const wf = store.workflows.get((req.params as { id: string }).id);
  if (!wf) return reply.code(404).send({ code: "NOT_FOUND", message: "workflow not found" });
  return wf;
});

const RunWorkflow = z.object({ input: z.string().default("") });

app.post("/v1/workflows/:id/run", async (req, reply) => {
  const wf = store.workflows.get((req.params as { id: string }).id);
  if (!wf) return reply.code(404).send({ code: "NOT_FOUND", message: "workflow not found" });
  if (!requirePerm(req, reply, "workflows:run")) return;
  const parsed = RunWorkflow.safeParse(req.body ?? {});
  if (!parsed.success) return reply.code(400).send({ code: "BAD_REQUEST", message: parsed.error.message });

  reply.hijack();
  const sse = new SSEStream(reply);
  const ac = new AbortController();
  reply.raw.on("close", () => {
    if (!reply.raw.writableEnded) ac.abort();
  });

  const workflowRunId = id("wfr");
  realtime.publish("workflow.started", { workflowRunId, workflowId: wf.id, name: wf.name });
  sse.send("workflow_started", { workflowRunId, workflowId: wf.id });

  try {
    for await (const ev of workflowEngine.run(wf.graph, parsed.data.input)) {
      sse.send(ev.type, ev);
      if (ev.type === "node_started") realtime.publish("workflow.step_started", { workflowRunId, nodeId: ev.nodeId, nodeType: ev.nodeType });
      else if (ev.type === "node_completed") realtime.publish("workflow.step_completed", { workflowRunId, nodeId: ev.nodeId });
      if (ac.signal.aborted) break;
    }
  } catch (err) {
    sse.send("error", { message: err instanceof Error ? err.message : String(err) });
  } finally {
    realtime.publish("workflow.completed", { workflowRunId, workflowId: wf.id });
    sse.close();
  }
});

// --- HITL approvals ---
app.post("/v1/runs/:runId/approvals/:toolCallId", async (req, reply) => {
  if (!requirePerm(req, reply, "runs:approve")) return;
  const { toolCallId } = req.params as { runId: string; toolCallId: string };
  const decision = (req.body as { decision?: string } | undefined)?.decision;
  const resolve = pendingApprovals.get(toolCallId);
  if (!resolve) return reply.code(404).send({ code: "NOT_FOUND", message: "no pending approval for that tool call" });
  pendingApprovals.delete(toolCallId);
  resolve(decision === "approve");
  return { ok: true, decision: decision === "approve" ? "approved" : "rejected" };
});

// --- agents ---
app.get("/v1/agents", async () => [...store.agents.values()]);

app.get("/v1/agents/:id", async (req, reply) => {
  const agent = store.agents.get((req.params as { id: string }).id);
  if (!agent) return reply.code(404).send({ code: "NOT_FOUND", message: "agent not found" });
  return agent;
});

const CreateAgent = z.object({
  name: z.string().min(1),
  kind: z.enum(["research", "coding", "trading", "finance", "data", "social", "compliance", "custom"]).default("custom"),
  systemPrompt: z.string().default(""),
  modelId: z.string(),
  settings: z.object({ temperature: z.number().optional(), maxTokens: z.number().optional() }).optional(),
});

app.post("/v1/agents", async (req, reply) => {
  if (!requirePerm(req, reply, "agents:write")) return;
  const parsed = CreateAgent.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ code: "BAD_REQUEST", message: parsed.error.message });
  if (!store.models.has(parsed.data.modelId)) return reply.code(400).send({ code: "BAD_REQUEST", message: "unknown modelId" });
  const ts = nowIso();
  const agent: AgentDefinition = {
    id: id("agt"),
    workspaceId: store.workspaceId,
    name: parsed.data.name,
    kind: parsed.data.kind,
    systemPrompt: parsed.data.systemPrompt,
    modelId: parsed.data.modelId,
    settings: { maxToolIterations: 8, ...parsed.data.settings },
    memory: { shortTerm: "window", longTerm: false },
    tools: [],
    status: "idle",
    costToDate: 0,
    createdAt: ts,
    updatedAt: ts,
  };
  store.agents.set(agent.id, agent);
  return reply.code(201).send(agent);
});

app.patch("/v1/agents/:id", async (req, reply) => {
  if (!requirePerm(req, reply, "agents:write")) return;
  const agent = store.agents.get((req.params as { id: string }).id);
  if (!agent) return reply.code(404).send({ code: "NOT_FOUND", message: "agent not found" });
  const patch = req.body as Partial<AgentDefinition>;
  Object.assign(agent, {
    name: patch.name ?? agent.name,
    systemPrompt: patch.systemPrompt ?? agent.systemPrompt,
    modelId: patch.modelId ?? agent.modelId,
    settings: { ...agent.settings, ...(patch.settings ?? {}) },
    updatedAt: nowIso(),
  });
  return agent;
});

app.delete("/v1/agents/:id", async (req, reply) => {
  if (!requirePerm(req, reply, "agents:write")) return;
  const ok = store.agents.delete((req.params as { id: string }).id);
  return reply.code(ok ? 204 : 404).send();
});

// --- conversations ---
app.get("/v1/conversations", async () => [...store.conversations.values()]);

app.post("/v1/conversations", async (req, reply) => {
  if (!requirePerm(req, reply, "conversations:write")) return;
  const body = (req.body ?? {}) as { title?: string; participantAgentIds?: string[] };
  const conv = store.createConversation(body.title ?? "New conversation", body.participantAgentIds ?? ["agt_assistant"]);
  return reply.code(201).send(conv);
});

app.get("/v1/conversations/:id", async (req, reply) => {
  const conv = store.conversations.get((req.params as { id: string }).id);
  if (!conv) return reply.code(404).send({ code: "NOT_FOUND", message: "conversation not found" });
  return conv;
});

app.get("/v1/conversations/:id/messages", async (req, reply) => {
  const convId = (req.params as { id: string }).id;
  if (!store.conversations.has(convId)) return reply.code(404).send({ code: "NOT_FOUND", message: "conversation not found" });
  return store.messages.get(convId) ?? [];
});

// --- streaming chat (SSE) ---
const PostMessage = z.object({ content: z.string().min(1), agentId: z.string().optional() });

app.post("/v1/conversations/:id/messages", async (req, reply) => {
  const convId = (req.params as { id: string }).id;
  const conv = store.conversations.get(convId);
  if (!conv) return reply.code(404).send({ code: "NOT_FOUND", message: "conversation not found" });
  if (!requirePerm(req, reply, "conversations:write")) return;

  const parsed = PostMessage.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ code: "BAD_REQUEST", message: parsed.error.message });

  const agentId = parsed.data.agentId ?? conv.participantAgentIds[0] ?? "agt_assistant";
  const agent = store.agents.get(agentId);
  if (!agent) return reply.code(404).send({ code: "NOT_FOUND", message: "agent not found" });

  store.addMessage(convId, { role: "user", content: parsed.data.content });

  reply.hijack();
  const sse = new SSEStream(reply);
  const ac = new AbortController();
  // Abort the run if the client disconnects. Listen on the *response* socket — listening on
  // req.raw fires as soon as the request body is consumed, which would abort immediately.
  reply.raw.on("close", () => {
    if (!reply.raw.writableEnded) ac.abort();
  });

  const runId = id("run");
  let assistantText = "";
  setAgentStatus(agent, "running");
  realtime.publish("run.started", { runId, agentId: agent.id, conversationId: convId });

  const tools = resolveTools(agent);
  const approvalToolCallIds = new Set<string>();

  try {
    for await (const ev of runtime.run({
      agent,
      history: store.history(convId),
      runId,
      signal: ac.signal,
      tools: tools.length ? tools : undefined,
      executeTool: (connectorId, name, args) => connectors.call(connectorId, name, args),
      retrieveContext: agent.memory.longTerm
        ? async (query) => memory.retrieve(store.workspaceId, query, agent.memory.retrieval?.topK ?? 5)
        : undefined,
      requestApproval: ({ toolCallId }) =>
        new Promise<boolean>((resolve) => {
          approvalToolCallIds.add(toolCallId);
          pendingApprovals.set(toolCallId, resolve);
          ac.signal.addEventListener("abort", () => {
            if (pendingApprovals.delete(toolCallId)) resolve(false);
          });
        }),
    })) {
      switch (ev.type) {
        case "token":
          assistantText += ev.delta;
          sse.send("token", { delta: ev.delta });
          break;
        case "reasoning":
          sse.send("reasoning", { delta: ev.delta });
          break;
        case "tool_call":
          sse.send("tool_call", { id: ev.id, name: ev.name, argsDelta: ev.argsDelta });
          break;
        case "tool_call_done":
          sse.send("tool_call_done", { id: ev.id, name: ev.name, args: ev.args });
          break;
        case "retrieval":
          sse.send("retrieval", { chunks: ev.chunks });
          break;
        case "awaiting_approval":
          setAgentStatus(agent, "awaiting_approval");
          sse.send("awaiting_approval", { runId, toolCallId: ev.toolCallId, name: ev.name, args: ev.args });
          break;
        case "tool_result":
          if (agent.status === "awaiting_approval") setAgentStatus(agent, "running");
          sse.send("tool_result", { toolCallId: ev.toolCallId, name: ev.name, ok: ev.ok, result: ev.result });
          break;
        case "usage":
          store.recordUsage(ev.event);
          realtime.publish("usage.recorded", { ...ev.event, agentCostToDate: agent.costToDate });
          sse.send("usage", ev.event);
          break;
        case "done":
          sse.send("done", { runId: ev.runId, finishReason: ev.finishReason });
          break;
        case "error":
          setAgentStatus(agent, "error");
          sse.send("error", ev.error);
          break;
      }
    }
  } catch (err) {
    sse.send("error", { code: "UNKNOWN", message: err instanceof Error ? err.message : String(err), retryable: false });
  } finally {
    for (const tcId of approvalToolCallIds) pendingApprovals.delete(tcId);
    if (assistantText) store.addMessage(convId, { role: "assistant", content: assistantText, agentId, runId });
    if (agent.status !== "error") setAgentStatus(agent, "idle");
    realtime.publish("run.completed", { runId, agentId: agent.id, status: agent.status });
    sse.close();
  }
});

// --- usage rollups ---
app.get("/v1/usage", async (req) => {
  const groupBy = (req.query as { groupBy?: string }).groupBy ?? "agent";
  const buckets = new Map<string, { key: string; costUsd: number; inputTokens: number; outputTokens: number; calls: number }>();
  for (const e of store.usage) {
    const key = groupBy === "model" ? e.modelId : groupBy === "day" ? e.ts.slice(0, 10) : (e.agentId ?? "unknown");
    const b = buckets.get(key) ?? { key, costUsd: 0, inputTokens: 0, outputTokens: 0, calls: 0 };
    b.costUsd = Math.round((b.costUsd + e.costUsd) * 1e6) / 1e6;
    b.inputTokens += e.inputTokens;
    b.outputTokens += e.outputTokens;
    b.calls += 1;
    buckets.set(key, b);
  }
  const totalCost = Math.round([...buckets.values()].reduce((s, b) => s + b.costUsd, 0) * 1e6) / 1e6;
  return { groupBy, totalCostUsd: totalCost, buckets: [...buckets.values()] };
});

app
  .listen({ port: config.port, host: "0.0.0.0" })
  .then(() => app.log.info(`gateway listening on :${config.port}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
