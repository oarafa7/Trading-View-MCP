import { describe, it, expect } from "vitest";
import { ProviderRegistry } from "@mc/providers";
import { AgentRuntime, type ModelResolver, type RunEvent, type ResolvedTool } from "@mc/agent-core";
import type { AgentDefinition, ToolResult } from "@mc/types";

const agent: AgentDefinition = {
  id: "agt_test",
  workspaceId: "ws_test",
  name: "Test",
  kind: "custom",
  systemPrompt: "You are a test agent.",
  modelId: "mdl_mock",
  settings: { maxToolIterations: 8 },
  memory: { shortTerm: "window", longTerm: false },
  status: "idle",
  costToDate: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const resolver: ModelResolver = (modelId) =>
  modelId === "mdl_mock" ? { provider: "mock", vendorModelId: "mock-1", pricing: { inputPerM: 0, outputPerM: 0 } } : undefined;

describe("AgentRuntime", () => {
  it("streams multiple tokens, a usage event, then done", async () => {
    const runtime = new AgentRuntime(new ProviderRegistry(), resolver);
    const events: RunEvent[] = [];
    for await (const ev of runtime.run({ agent, history: [{ role: "user", content: "hello mission control" }] })) {
      events.push(ev);
    }

    const tokens = events.filter((e) => e.type === "token");
    expect(tokens.length).toBeGreaterThan(1); // regression: must not stop after the first token

    const usage = events.find((e) => e.type === "usage");
    expect(usage).toBeTruthy();

    const done = events.at(-1);
    expect(done?.type).toBe("done");
  });

  it("emits an error for an unknown model", async () => {
    const runtime = new AgentRuntime(new ProviderRegistry(), () => undefined);
    const events: RunEvent[] = [];
    for await (const ev of runtime.run({ agent, history: [{ role: "user", content: "hi" }] })) events.push(ev);
    expect(events.some((e) => e.type === "error")).toBe(true);
  });

  const getTimeTool: ResolvedTool = {
    spec: { name: "get_time", description: "now", parameters: { type: "object", properties: {} } },
    connectorId: "conn_utility",
    requireApproval: false,
  };

  it("runs the tool-calling loop: tool_call -> tool_result -> final answer", async () => {
    const runtime = new AgentRuntime(new ProviderRegistry(), resolver);
    const calls: string[] = [];
    const executeTool = async (connectorId: string, name: string): Promise<ToolResult> => {
      calls.push(`${connectorId}/${name}`);
      return { ok: true, content: { now: "2026-05-29T00:00:00Z" }, isError: false };
    };

    const events: RunEvent[] = [];
    for await (const ev of runtime.run({
      agent,
      history: [{ role: "user", content: "please call get_time" }],
      tools: [getTimeTool],
      executeTool,
    })) {
      events.push(ev);
    }

    expect(calls).toContain("conn_utility/get_time");
    expect(events.some((e) => e.type === "tool_call_done" && e.name === "get_time")).toBe(true);
    expect(events.some((e) => e.type === "tool_result" && e.ok)).toBe(true);
    const finalText = events.filter((e) => e.type === "token").map((e) => (e.type === "token" ? e.delta : "")).join("");
    expect(finalText).toContain("2026-05-29");
    expect(events.at(-1)?.type).toBe("done");
  });

  it("HITL: a rejected approval blocks the tool and reports denial", async () => {
    const runtime = new AgentRuntime(new ProviderRegistry(), resolver);
    let executed = false;

    const events: RunEvent[] = [];
    for await (const ev of runtime.run({
      agent,
      history: [{ role: "user", content: "please call get_time" }],
      tools: [{ ...getTimeTool, requireApproval: true }],
      executeTool: async () => {
        executed = true;
        return { ok: true, content: {}, isError: false };
      },
      requestApproval: async () => false,
    })) {
      events.push(ev);
    }

    expect(events.some((e) => e.type === "awaiting_approval")).toBe(true);
    expect(events.some((e) => e.type === "tool_result" && !e.ok)).toBe(true);
    expect(executed).toBe(false); // rejected → executor never ran
  });
});
