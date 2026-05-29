import type { AgentDefinition, ModelInfo, UnifiedMessage, UsageEvent, Workflow } from "@mc/types";
import { id, nowIso } from "@mc/agent-core";
import { createDb, Db, type StoredMessage, type Conversation } from "@mc/db";

export type { StoredMessage, Conversation };

/**
 * Write-through store: an in-RAM working set (fast sync reads for the API) backed by SQLite
 * (better-sqlite3 is synchronous). Agents, conversations, messages, and usage events are loaded
 * from the database on boot and persisted on every write, so they survive restarts. Models and
 * workflows are static seed config kept in memory. The same Drizzle schema runs on Postgres in
 * production (see docs/mission-control/03-database-schema.md).
 */
export class MemoryStore {
  readonly workspaceId = "ws_default";
  models = new Map<string, ModelInfo>();
  agents = new Map<string, AgentDefinition>();
  conversations = new Map<string, Conversation>();
  messages = new Map<string, StoredMessage[]>(); // conversationId -> messages
  workflows = new Map<string, Workflow>();
  usage: UsageEvent[] = [];

  constructor(private db: Db = new Db(createDb())) {
    this.seedStaticConfig();
    this.hydrateOrSeed();
  }

  private seedStaticConfig(): void {
    const models: ModelInfo[] = [
      { id: "mdl_mock", provider: "mock", modelId: "mock-1", displayName: "Mock (offline)", capabilities: { contextWindow: 128000, supportsTools: false, supportsStreaming: true, supportsJsonMode: true, inputModalities: ["text"] }, pricing: { inputPerM: 0, outputPerM: 0 }, enabled: true },
      { id: "mdl_gpt4o", provider: "openai", modelId: "gpt-4o", displayName: "GPT-4o", capabilities: { contextWindow: 128000, supportsTools: true, supportsStreaming: true, supportsJsonMode: true, inputModalities: ["text", "image"] }, pricing: { inputPerM: 2.5, outputPerM: 10, cachedInputPerM: 1.25 }, enabled: true },
      { id: "mdl_claude", provider: "anthropic", modelId: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6", displayName: "Claude Sonnet", capabilities: { contextWindow: 200000, supportsTools: true, supportsStreaming: true, supportsJsonMode: false, inputModalities: ["text", "image"] }, pricing: { inputPerM: 3, outputPerM: 15, cachedInputPerM: 0.3 }, enabled: true },
      { id: "mdl_llama", provider: "ollama", modelId: "llama3.1", displayName: "Llama 3.1 (local)", capabilities: { contextWindow: 128000, supportsTools: true, supportsStreaming: true, supportsJsonMode: true, inputModalities: ["text"] }, pricing: { inputPerM: 0, outputPerM: 0 }, enabled: true },
    ];
    for (const m of models) this.models.set(m.id, m);

    const ts = nowIso();
    const wf: Workflow = {
      id: "wf_brief",
      workspaceId: this.workspaceId,
      name: "Daily Brief",
      createdAt: ts,
      graph: {
        entry: "research",
        nodes: [
          { id: "research", type: "agent", agentId: "agt_assistant", prompt: "Research notes on: {{input}}" },
          { id: "clock", type: "tool", connectorId: "conn_utility", tool: "get_time" },
          { id: "brief", type: "agent", agentId: "agt_assistant", prompt: "Write a short brief.\nTopic: {{input}}\nTime: {{clock}}\nResearch: {{research}}" },
        ],
        edges: [
          { from: "research", to: "clock" },
          { from: "clock", to: "brief" },
        ],
      },
    };
    this.workflows.set(wf.id, wf);
  }

  /** Load durable entities from the database; on a fresh DB, seed the default agents and persist them. */
  private hydrateOrSeed(): void {
    const existingAgents = this.db.listAgents(this.workspaceId);
    if (existingAgents.length) {
      for (const a of existingAgents) this.agents.set(a.id, a);
    } else {
      for (const a of this.defaultAgents()) {
        this.agents.set(a.id, a);
        this.db.upsertAgent(a);
      }
    }

    for (const conv of this.db.listConversations(this.workspaceId)) {
      this.conversations.set(conv.id, conv);
      this.messages.set(conv.id, this.db.messagesByConversation(conv.id));
    }
    this.usage = this.db.allUsage(this.workspaceId);
  }

  private defaultAgents(): AgentDefinition[] {
    const ts = nowIso();
    return [
      { id: "agt_assistant", workspaceId: this.workspaceId, name: "Mission Assistant", kind: "custom", systemPrompt: "You are Mission Control's assistant. Be concise and precise. Use the available tools when they help.", modelId: "mdl_claude", settings: { temperature: 0.3, maxToolIterations: 8 }, memory: { shortTerm: "window", longTerm: true, retrieval: { topK: 4 } }, tools: [{ connectorId: "conn_utility", toolName: "get_time", requireApproval: false }, { connectorId: "conn_utility", toolName: "add", requireApproval: false }, { connectorId: "conn_utility", toolName: "send_notification", requireApproval: true }], status: "idle", costToDate: 0, createdAt: ts, updatedAt: ts },
      { id: "agt_research", workspaceId: this.workspaceId, name: "Research Agent", kind: "research", systemPrompt: "You are a meticulous research analyst. Cite reasoning and be thorough.", modelId: "mdl_gpt4o", settings: { temperature: 0.4, maxToolIterations: 8 }, memory: { shortTerm: "summary", longTerm: true, retrieval: { topK: 6 } }, tools: [{ connectorId: "conn_utility", toolName: "get_time", requireApproval: false }], status: "idle", costToDate: 0, createdAt: ts, updatedAt: ts },
      { id: "agt_trading", workspaceId: this.workspaceId, name: "Trading Agent", kind: "trading", systemPrompt: "You are a disciplined trading analyst. Never propose orders without a clear thesis and risk note.", modelId: "mdl_claude", settings: { temperature: 0.2, maxToolIterations: 8 }, memory: { shortTerm: "window", longTerm: false }, tools: [{ connectorId: "conn_tradingview", toolName: "chart_get_state", requireApproval: false }], status: "idle", costToDate: 0, createdAt: ts, updatedAt: ts },
    ];
  }

  /** Persist an agent (create or update). */
  saveAgent(agent: AgentDefinition): void {
    this.agents.set(agent.id, agent);
    this.db.upsertAgent(agent);
  }

  removeAgent(agentId: string): boolean {
    const existed = this.agents.delete(agentId);
    if (existed) this.db.deleteAgent(agentId);
    return existed;
  }

  createConversation(title: string, participantAgentIds: string[]): Conversation {
    const conv: Conversation = { id: id("conv"), workspaceId: this.workspaceId, title, participantAgentIds, createdAt: nowIso() };
    this.conversations.set(conv.id, conv);
    this.messages.set(conv.id, []);
    this.db.insertConversation(conv);
    return conv;
  }

  addMessage(conversationId: string, msg: Omit<StoredMessage, "id" | "conversationId" | "createdAt">): StoredMessage {
    const stored: StoredMessage = { id: id("msg"), conversationId, createdAt: nowIso(), ...msg };
    const list = this.messages.get(conversationId) ?? [];
    list.push(stored);
    this.messages.set(conversationId, list);
    this.db.insertMessage(stored);
    return stored;
  }

  history(conversationId: string): UnifiedMessage[] {
    return (this.messages.get(conversationId) ?? []).map((m) => ({ role: m.role, content: m.content }));
  }

  recordUsage(ev: UsageEvent): void {
    this.usage.push(ev);
    this.db.insertUsage(ev);
    if (ev.agentId) {
      const agent = this.agents.get(ev.agentId);
      if (agent) {
        agent.costToDate = Math.round((agent.costToDate + ev.costUsd) * 1e6) / 1e6;
        agent.updatedAt = nowIso();
        this.db.upsertAgent(agent);
      }
    }
  }
}
