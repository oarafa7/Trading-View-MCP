import { describe, it, expect } from "vitest";
import { WorkflowEngine, renderTemplate, type WorkflowEvent } from "@mc/agent-core";
import type { WorkflowGraph, ToolResult } from "@mc/types";

describe("renderTemplate", () => {
  it("substitutes {{input}} and {{nodeId}} from state", () => {
    expect(renderTemplate("a={{input}} b={{n1}}", { input: "X", n1: "Y" })).toBe("a=X b=Y");
  });
});

describe("WorkflowEngine", () => {
  const graph: WorkflowGraph = {
    entry: "n1",
    nodes: [
      { id: "n1", type: "agent", agentId: "agt_a", prompt: "{{input}}" },
      { id: "n2", type: "tool", connectorId: "conn_utility", tool: "get_time" },
      { id: "n3", type: "agent", agentId: "agt_b", prompt: "combine input={{input}} t={{n2}} prior={{n1}}" },
    ],
    edges: [
      { from: "n1", to: "n2" },
      { from: "n2", to: "n3" },
    ],
  };

  // fake agent: echoes the prompt back as a single token; fake tool: returns a fixed time
  async function* runAgentNode(_agentId: string, prompt: string) {
    yield { type: "token", delta: `echo:${prompt}` } as const;
  }
  const runToolNode = async (): Promise<ToolResult> => ({ ok: true, content: { now: "T0" }, isError: false });

  it("chains agent -> tool -> agent, threading state through templates", async () => {
    const engine = new WorkflowEngine((g, id) => g.nodes.find((n) => n.id === id), { runAgentNode, runToolNode });
    const events: WorkflowEvent[] = [];
    for await (const ev of engine.run(graph, "hello")) events.push(ev);

    const completed = events.filter((e) => e.type === "node_completed");
    expect(completed.map((e) => (e.type === "node_completed" ? e.nodeId : ""))).toEqual(["n1", "n2", "n3"]);

    // n3's output must include the rendered references to input, n2 (tool result), and n1
    const n3 = completed.find((e) => e.type === "node_completed" && e.nodeId === "n3");
    const out = n3 && n3.type === "node_completed" ? n3.output : "";
    expect(out).toContain("input=hello");
    expect(out).toContain('t={"now":"T0"}');
    expect(out).toContain("prior=echo:hello");

    expect(events.at(-1)?.type).toBe("workflow_completed");
  });

  it("follows conditional edges (whenContains)", async () => {
    const branch: WorkflowGraph = {
      entry: "start",
      nodes: [
        { id: "start", type: "agent", agentId: "a", prompt: "{{input}}" },
        { id: "yes", type: "agent", agentId: "a", prompt: "YES branch" },
        { id: "no", type: "agent", agentId: "a", prompt: "NO branch" },
      ],
      edges: [
        { from: "start", to: "yes", whenContains: "urgent" },
        { from: "start", to: "no" },
      ],
    };
    const engine = new WorkflowEngine((g, id) => g.nodes.find((n) => n.id === id), { runAgentNode, runToolNode });

    const ran: string[] = [];
    for await (const ev of engine.run(branch, "this is urgent")) {
      if (ev.type === "node_started") ran.push(ev.nodeId);
    }
    expect(ran).toContain("yes");
    expect(ran).not.toContain("no");
  });
});
