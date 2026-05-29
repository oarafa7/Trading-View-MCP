import { describe, it, expect } from "vitest";
import { ProviderRegistry, MockProvider, computeCostUsd } from "@mc/providers";
import type { UnifiedRequest, StreamEvent } from "@mc/types";

describe("MockProvider", () => {
  it("streams tokens then finishes with usage", async () => {
    const p = new MockProvider();
    const req: UnifiedRequest = { model: "mock-1", messages: [{ role: "user", content: "hello world" }] };
    const events: StreamEvent[] = [];
    for await (const ev of p.stream(req, {})) events.push(ev);

    const tokens = events.filter((e) => e.type === "token");
    const finish = events.find((e) => e.type === "finish");
    expect(tokens.length).toBeGreaterThan(0);
    expect(finish).toBeTruthy();

    const text = tokens.map((t) => (t.type === "token" ? t.delta : "")).join("");
    expect(text).toContain("hello world");
  });

  it("chat() drains the stream into text + usage", async () => {
    const p = new MockProvider();
    const res = await p.chat({ model: "m", messages: [{ role: "user", content: "hi there" }] }, {});
    expect(res.text).toContain("hi there");
    expect(res.usage.outputTokens).toBeGreaterThan(0);
    expect(res.finishReason).toBe("stop");
  });
});

describe("computeCostUsd", () => {
  it("computes from per-1M pricing", () => {
    const cost = computeCostUsd({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, { inputPerM: 3, outputPerM: 15 });
    expect(cost).toBeCloseTo(18, 5);
  });

  it("prices cached input separately", () => {
    const cost = computeCostUsd(
      { inputTokens: 1_000_000, outputTokens: 0, cachedInputTokens: 1_000_000 },
      { inputPerM: 3, outputPerM: 15, cachedInputPerM: 0.3 },
    );
    expect(cost).toBeCloseTo(0.3, 5);
  });
});

describe("ProviderRegistry", () => {
  it("registers all default providers", () => {
    const r = new ProviderRegistry();
    expect(r.has("mock")).toBe(true);
    expect(r.has("anthropic")).toBe(true);
    expect(r.has("ollama")).toBe(true);
    expect(r.get("openai").id).toBe("openai");
  });
});
