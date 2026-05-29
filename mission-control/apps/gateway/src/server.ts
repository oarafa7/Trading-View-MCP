import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import { ProviderRegistry } from "@mc/providers";
import { AgentRuntime, id, nowIso } from "@mc/agent-core";
import type { AgentDefinition } from "@mc/types";
import { MemoryStore } from "./store.js";
import { loadConfig, makeModelResolver } from "./config.js";
import { SSEStream } from "./sse.js";

const config = loadConfig();
const store = new MemoryStore();
const registry = new ProviderRegistry();
const runtime = new AgentRuntime(registry, makeModelResolver(store));

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
await app.register(cors, { origin: true, credentials: true });

// --- health ---
app.get("/v1/health", async () => ({
  ok: true,
  ts: nowIso(),
  providers: ["mock", "openai", "anthropic", "groq", "openrouter", "together", "ollama"],
}));

app.get("/v1/workspaces", async () => [{ id: store.workspaceId, name: "Default Workspace" }]);

// --- models ---
app.get("/v1/models", async () => [...store.models.values()]);

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
    status: "idle",
    costToDate: 0,
    createdAt: ts,
    updatedAt: ts,
  };
  store.agents.set(agent.id, agent);
  return reply.code(201).send(agent);
});

app.patch("/v1/agents/:id", async (req, reply) => {
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
  const ok = store.agents.delete((req.params as { id: string }).id);
  return reply.code(ok ? 204 : 404).send();
});

// --- conversations ---
app.get("/v1/conversations", async () => [...store.conversations.values()]);

app.post("/v1/conversations", async (req, reply) => {
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
  agent.status = "running";
  agent.updatedAt = nowIso();

  try {
    for await (const ev of runtime.run({ agent, history: store.history(convId), runId, signal: ac.signal })) {
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
        case "usage":
          store.recordUsage(ev.event);
          sse.send("usage", ev.event);
          break;
        case "done":
          sse.send("done", { runId: ev.runId, finishReason: ev.finishReason });
          break;
        case "error":
          agent.status = "error";
          sse.send("error", ev.error);
          break;
      }
    }
  } catch (err) {
    sse.send("error", { code: "UNKNOWN", message: err instanceof Error ? err.message : String(err), retryable: false });
  } finally {
    if (assistantText) store.addMessage(convId, { role: "assistant", content: assistantText, agentId, runId });
    if (agent.status === "running") agent.status = "idle";
    agent.updatedAt = nowIso();
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
