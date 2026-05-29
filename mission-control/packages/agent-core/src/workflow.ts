import type { WorkflowGraph, WorkflowNode, ToolResult } from "@mc/types";
import type { RunEvent } from "./runtime.js";

/** Events emitted while a workflow executes; the gateway forwards these to SSE/WS. */
export type WorkflowEvent =
  | { type: "node_started"; nodeId: string; nodeType: string }
  | { type: "node_token"; nodeId: string; delta: string }
  | { type: "node_completed"; nodeId: string; output: string }
  | { type: "workflow_completed"; state: Record<string, string> }
  | { type: "error"; nodeId?: string; message: string };

export interface WorkflowDeps {
  /** Run an agent node and yield its RunEvents (engine forwards tokens, collects final text). */
  runAgentNode: (agentId: string, prompt: string) => AsyncGenerator<RunEvent>;
  /** Execute a tool node. */
  runToolNode: (connectorId: string, tool: string, args: unknown) => Promise<ToolResult>;
}

/** Substitute {{input}} and {{<nodeId>}} references in a template from the run state. */
export function renderTemplate(template: string, state: Record<string, string>): string {
  return template.replace(/\{\{\s*([\w]+)\s*\}\}/g, (_m, key: string) => state[key] ?? "");
}

function pickNextNode(graph: WorkflowGraph, current: string, output: string): string | undefined {
  const out = output.toLowerCase();
  for (const e of graph.edges.filter((x) => x.from === current)) {
    if (!e.whenContains || out.includes(e.whenContains.toLowerCase())) return e.to;
  }
  return undefined;
}

/**
 * Minimal durable-graph executor: walks the graph from `entry`, running agent/tool nodes,
 * threading their outputs through shared state, and following edges (with optional
 * substring conditions). See docs/mission-control/07-orchestration-multiagent.md.
 */
export class WorkflowEngine {
  constructor(
    private resolveNode: (graph: WorkflowGraph, id: string) => WorkflowNode | undefined,
    private deps: WorkflowDeps,
  ) {}

  async *run(graph: WorkflowGraph, input: string): AsyncGenerator<WorkflowEvent> {
    const state: Record<string, string> = { input };
    let current: string | undefined = graph.entry;
    const maxSteps = graph.nodes.length * 4 + 4; // loop guard

    for (let step = 0; current && step < maxSteps; step++) {
      const node = this.resolveNode(graph, current);
      if (!node) {
        yield { type: "error", nodeId: current, message: `Unknown node "${current}"` };
        return;
      }

      yield { type: "node_started", nodeId: node.id, nodeType: node.type };
      let output = "";

      if (node.type === "agent") {
        if (!node.agentId) {
          yield { type: "error", nodeId: node.id, message: "agent node missing agentId" };
          return;
        }
        const prompt = renderTemplate(node.prompt ?? "{{input}}", state);
        for await (const ev of this.deps.runAgentNode(node.agentId, prompt)) {
          if (ev.type === "token") {
            output += ev.delta;
            yield { type: "node_token", nodeId: node.id, delta: ev.delta };
          } else if (ev.type === "error") {
            yield { type: "error", nodeId: node.id, message: ev.error.message };
            return;
          }
        }
      } else {
        if (!node.connectorId || !node.tool) {
          yield { type: "error", nodeId: node.id, message: "tool node missing connectorId/tool" };
          return;
        }
        const args: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(node.args ?? {})) {
          args[k] = typeof v === "string" ? renderTemplate(v, state) : v;
        }
        const res = await this.deps.runToolNode(node.connectorId, node.tool, args);
        output = typeof res.content === "string" ? res.content : JSON.stringify(res.content);
      }

      state[node.id] = output;
      yield { type: "node_completed", nodeId: node.id, output };
      current = pickNextNode(graph, node.id, output);
    }

    yield { type: "workflow_completed", state };
  }
}
