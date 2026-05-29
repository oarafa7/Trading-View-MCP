import { eq } from "drizzle-orm";
import type { AgentDefinition, UsageEvent, MessageRole } from "@mc/types";
import type { DrizzleDb } from "./client.js";
import { agents, conversations, messages, usageEvents } from "./schema.js";

export interface StoredMessage {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  agentId?: string;
  runId?: string;
  createdAt: string;
}

export interface Conversation {
  id: string;
  workspaceId: string;
  title: string;
  participantAgentIds: string[];
  createdAt: string;
}

/** Synchronous repository over the Drizzle/SQLite database (better-sqlite3 is sync). */
export class Db {
  constructor(private d: DrizzleDb) {}

  // agents
  listAgents(workspaceId: string): AgentDefinition[] {
    return this.d
      .select()
      .from(agents)
      .where(eq(agents.workspaceId, workspaceId))
      .all()
      .map((r) => JSON.parse(r.data) as AgentDefinition);
  }
  upsertAgent(a: AgentDefinition): void {
    const row = { id: a.id, workspaceId: a.workspaceId, data: JSON.stringify(a), updatedAt: a.updatedAt };
    this.d.insert(agents).values(row).onConflictDoUpdate({ target: agents.id, set: { data: row.data, updatedAt: row.updatedAt } }).run();
  }
  deleteAgent(id: string): void {
    this.d.delete(agents).where(eq(agents.id, id)).run();
  }

  // conversations
  listConversations(workspaceId: string): Conversation[] {
    return this.d
      .select()
      .from(conversations)
      .where(eq(conversations.workspaceId, workspaceId))
      .all()
      .map((r) => JSON.parse(r.data) as Conversation);
  }
  insertConversation(c: Conversation): void {
    this.d.insert(conversations).values({ id: c.id, workspaceId: c.workspaceId, data: JSON.stringify(c), createdAt: c.createdAt }).run();
  }

  // messages
  messagesByConversation(conversationId: string): StoredMessage[] {
    return this.d
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .all()
      .map((r) => ({
        id: r.id,
        conversationId: r.conversationId,
        role: r.role as MessageRole,
        content: r.content,
        agentId: r.agentId ?? undefined,
        runId: r.runId ?? undefined,
        createdAt: r.createdAt,
      }));
  }
  insertMessage(m: StoredMessage): void {
    this.d.insert(messages).values({
      id: m.id,
      conversationId: m.conversationId,
      role: m.role,
      content: m.content,
      agentId: m.agentId ?? null,
      runId: m.runId ?? null,
      createdAt: m.createdAt,
    }).run();
  }

  // usage
  allUsage(workspaceId: string): UsageEvent[] {
    return this.d
      .select()
      .from(usageEvents)
      .where(eq(usageEvents.workspaceId, workspaceId))
      .all()
      .map((r) => ({
        id: r.id,
        workspaceId: r.workspaceId,
        runId: r.runId ?? undefined,
        agentId: r.agentId ?? undefined,
        provider: r.provider as UsageEvent["provider"],
        modelId: r.modelId,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        cachedTokens: r.cachedTokens,
        reasoningTokens: r.reasoningTokens,
        costUsd: r.costUsd,
        latencyMs: r.latencyMs,
        ts: r.ts,
      }));
  }
  insertUsage(e: UsageEvent): void {
    this.d.insert(usageEvents).values({
      id: e.id,
      workspaceId: e.workspaceId,
      runId: e.runId ?? null,
      agentId: e.agentId ?? null,
      provider: e.provider,
      modelId: e.modelId,
      inputTokens: e.inputTokens,
      outputTokens: e.outputTokens,
      cachedTokens: e.cachedTokens ?? 0,
      reasoningTokens: e.reasoningTokens ?? 0,
      costUsd: e.costUsd,
      latencyMs: e.latencyMs,
      ts: e.ts,
    }).run();
  }
}
