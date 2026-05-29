import { describe, it, expect } from "vitest";
import { ProviderRegistry } from "@mc/providers";
import { AgentRuntime, type ModelResolver, type RunEvent } from "@mc/agent-core";
import type { AgentDefinition } from "@mc/types";

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
});
