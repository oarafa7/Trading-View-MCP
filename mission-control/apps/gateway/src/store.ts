import type { AgentDefinition, ModelInfo, UnifiedMessage, UsageEvent, MessageRole } from "@mc/types";
import { id, nowIso } from "@mc/agent-core";

export interface StoredMessage {
  id: string;
  conversationId: string;
  runId?: string;
  role: MessageRole;
  content: string;
  agentId?: string;
  createdAt: string;
}

export interface Conversation {
  id: string;
  workspaceId: string;
  title: string;
  participantAgentIds: string[];
  createdAt: string;
}

/**
 * In-memory repository for the Phase 1 slice. Implements the same surface the Drizzle/Postgres
 * repository will (see docs/mission-control/03-database-schema.md) so swapping the backend later
 * is contained to this module.
 */
export class MemoryStore {
  readonly workspaceId = "ws_default";
  models = new Map<string, ModelInfo>();
  agents = new Map<string, AgentDefinition>();
  conversations = new Map<string, Conversation>();
  messages = new Map<string, StoredMessage[]>(); // conversationId -> messages
  usage: UsageEvent[] = [];

  constructor() {
    this.seed();
  }

  private seed(): void {
    const models: ModelInfo[] = [
      {
        id: "mdl_mock",
        provider: "mock",
        modelId: "mock-1",
        displayName: "Mock (offline)",
        capabilities: { contextWindow: 128000, supportsTools: false, supportsStreaming: true, supportsJsonMode: true, inputModalities: ["text"] },
        pricing: { inputPerM: 0, outputPerM: 0 },
        enabled: true,
      },
      {
        id: "mdl_gpt4o",
        provider: "openai",
        modelId: "gpt-4o",
        displayName: "GPT-4o",
        capabilities: { contextWindow: 128000, supportsTools: true, supportsStreaming: true, supportsJsonMode: true, inputModalities: ["text", "image"] },
        pricing: { inputPerM: 2.5, outputPerM: 10, cachedInputPerM: 1.25 },
        enabled: true,
      },
      {
        id: "mdl_claude",
        provider: "anthropic",
        modelId: "claude-3-5-sonnet-latest",
        displayName: "Claude 3.5 Sonnet",
        capabilities: { contextWindow: 200000, supportsTools: true, supportsStreaming: true, supportsJsonMode: false, inputModalities: ["text", "image"] },
        pricing: { inputPerM: 3, outputPerM: 15, cachedInputPerM: 0.3 },
        enabled: true,
      },
      {
        id: "mdl_llama",
        provider: "ollama",
        modelId: "llama3.1",
        displayName: "Llama 3.1 (local)",
        capabilities: { contextWindow: 128000, supportsTools: true, supportsStreaming: true, supportsJsonMode: true, inputModalities: ["text"] },
        pricing: { inputPerM: 0, outputPerM: 0 },
        enabled: true,
      },
    ];
    for (const m of models) this.models.set(m.id, m);

    const ts = nowIso();
    const agents: AgentDefinition[] = [
      {
        id: "agt_assistant",
        workspaceId: this.workspaceId,
        name: "Mission Assistant",
        kind: "custom",
        systemPrompt: "You are Mission Control's assistant. Be concise and precise.",
        modelId: "mdl_mock",
        settings: { maxToolIterations: 8 },
        memory: { shortTerm: "window", longTerm: false },
        status: "idle",
        costToDate: 0,
        createdAt: ts,
        updatedAt: ts,
      },
      {
        id: "agt_research",
        workspaceId: this.workspaceId,
        name: "Research Agent",
        kind: "research",
        systemPrompt: "You are a meticulous research analyst. Cite reasoning and be thorough.",
        modelId: "mdl_gpt4o",
        settings: { temperature: 0.4, maxToolIterations: 8 },
        memory: { shortTerm: "summary", longTerm: true, retrieval: { topK: 6 } },
        status: "idle",
        costToDate: 0,
        createdAt: ts,
        updatedAt: ts,
      },
      {
        id: "agt_trading",
        workspaceId: this.workspaceId,
        name: "Trading Agent",
        kind: "trading",
        systemPrompt: "You are a disciplined trading analyst. Never propose orders without a clear thesis and risk note.",
        modelId: "mdl_claude",
        settings: { temperature: 0.2, maxToolIterations: 8 },
        memory: { shortTerm: "window", longTerm: false },
        status: "idle",
        costToDate: 0,
        createdAt: ts,
        updatedAt: ts,
      },
    ];
    for (const a of agents) this.agents.set(a.id, a);
  }

  createConversation(title: string, participantAgentIds: string[]): Conversation {
    const conv: Conversation = {
      id: id("conv"),
      workspaceId: this.workspaceId,
      title,
      participantAgentIds,
      createdAt: nowIso(),
    };
    this.conversations.set(conv.id, conv);
    this.messages.set(conv.id, []);
    return conv;
  }

  addMessage(conversationId: string, msg: Omit<StoredMessage, "id" | "conversationId" | "createdAt">): StoredMessage {
    const stored: StoredMessage = { id: id("msg"), conversationId, createdAt: nowIso(), ...msg };
    const list = this.messages.get(conversationId) ?? [];
    list.push(stored);
    this.messages.set(conversationId, list);
    return stored;
  }

  history(conversationId: string): UnifiedMessage[] {
    return (this.messages.get(conversationId) ?? []).map((m) => ({ role: m.role, content: m.content }));
  }

  recordUsage(ev: UsageEvent): void {
    this.usage.push(ev);
    if (ev.agentId) {
      const agent = this.agents.get(ev.agentId);
      if (agent) {
        agent.costToDate = Math.round((agent.costToDate + ev.costUsd) * 1e6) / 1e6;
        agent.updatedAt = nowIso();
      }
    }
  }
}
