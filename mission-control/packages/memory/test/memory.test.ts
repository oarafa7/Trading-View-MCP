import { describe, it, expect } from "vitest";
import { embed, cosine, chunkText, MemoryService } from "@mc/memory";

describe("embeddings", () => {
  it("identical text is maximally similar; related beats unrelated", () => {
    const a = embed("trading risk management and position sizing");
    const aDup = embed("trading risk management and position sizing");
    const related = embed("position sizing rules for managing trading risk");
    const unrelated = embed("the cat sat on a warm windowsill at noon");

    expect(cosine(a, aDup)).toBeCloseTo(1, 5);
    expect(cosine(a, related)).toBeGreaterThan(cosine(a, unrelated));
  });
});

describe("chunkText", () => {
  it("returns one chunk for short text, multiple for long", () => {
    expect(chunkText("short").length).toBe(1);
    const long = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} with some words.`).join("\n\n");
    expect(chunkText(long, { maxChars: 200 }).length).toBeGreaterThan(1);
  });
});

describe("MemoryService (RAG)", () => {
  it("ingests docs and retrieves the relevant one first", () => {
    const m = new MemoryService();
    const ws = "ws_test";
    m.ingest(ws, "Risk Policy", "Always size positions to risk at most 1% of equity per trade. Use stop losses.");
    m.ingest(ws, "Lunch Menu", "Today we serve tomato soup, grilled cheese, and a fresh garden salad.");

    const hits = m.retrieve(ws, "how much should I risk per trade?", 3);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.sourceTitle).toBe("Risk Policy");

    expect(m.stats(ws).sources).toBe(2);
    expect(m.listSources(ws).map((s) => s.title).sort()).toEqual(["Lunch Menu", "Risk Policy"]);
  });

  it("scopes retrieval by workspace", () => {
    const m = new MemoryService();
    m.ingest("ws_a", "A", "alpha bravo charlie");
    m.ingest("ws_b", "B", "alpha bravo charlie");
    expect(m.retrieve("ws_a", "alpha", 5).every((h) => h.sourceTitle === "A")).toBe(true);
  });
});
