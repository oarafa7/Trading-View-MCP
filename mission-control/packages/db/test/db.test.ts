import { describe, it, expect } from "vitest";
import { createDb, Db } from "@mc/db";
import type { AgentDefinition, UsageEvent } from "@mc/types";

function agent(id: string, cost = 0): AgentDefinition {
  return {
    id,
    workspaceId: "ws_default",
    name: id,
    kind: "custom",
    systemPrompt: "",
    modelId: "mdl_mock",
    settings: { maxToolIterations: 8 },
    memory: { shortTerm: "window", longTerm: false },
    tools: [],
    status: "idle",
    costToDate: cost,
    createdAt: "t",
    updatedAt: "t",
  };
}

describe("Db (sqlite/drizzle)", () => {
  it("persists agents with upsert semantics", () => {
    const db = new Db(createDb(":memory:"));
    db.upsertAgent(agent("a", 0));
    db.upsertAgent(agent("a", 1.5)); // update
    db.upsertAgent(agent("b"));
    const list = db.listAgents("ws_default").sort((x, y) => x.id.localeCompare(y.id));
    expect(list.map((a) => a.id)).toEqual(["a", "b"]);
    expect(list[0]!.costToDate).toBe(1.5);
    db.deleteAgent("a");
    expect(db.listAgents("ws_default").map((a) => a.id)).toEqual(["b"]);
  });

  it("stores conversations + messages and reads them back in order", () => {
    const db = new Db(createDb(":memory:"));
    db.insertConversation({ id: "c1", workspaceId: "ws_default", title: "t", participantAgentIds: ["a"], createdAt: "t" });
    db.insertMessage({ id: "m1", conversationId: "c1", role: "user", content: "hi", createdAt: "2026-01-01" });
    db.insertMessage({ id: "m2", conversationId: "c1", role: "assistant", content: "yo", agentId: "a", runId: "r1", createdAt: "2026-01-02" });
    const msgs = db.messagesByConversation("c1");
    expect(msgs.map((m) => m.content)).toEqual(["hi", "yo"]);
    expect(msgs[1]!.agentId).toBe("a");
    expect(db.listConversations("ws_default").length).toBe(1);
  });

  it("records usage events for rollups", () => {
    const db = new Db(createDb(":memory:"));
    const ev: UsageEvent = {
      id: "ue1", workspaceId: "ws_default", agentId: "a", provider: "mock", modelId: "mock-1",
      inputTokens: 10, outputTokens: 5, cachedTokens: 0, reasoningTokens: 0, costUsd: 0.01, latencyMs: 3, ts: "t",
    };
    db.insertUsage(ev);
    const all = db.allUsage("ws_default");
    expect(all.length).toBe(1);
    expect(all[0]!.costUsd).toBe(0.01);
  });

  it("persists across reopen of the same file", () => {
    const path = `/tmp/mc-test-${Date.now()}.db`;
    const db1 = new Db(createDb(path));
    db1.upsertAgent(agent("persisted"));
    const db2 = new Db(createDb(path)); // reopen
    expect(db2.listAgents("ws_default").map((a) => a.id)).toContain("persisted");
  });
});
