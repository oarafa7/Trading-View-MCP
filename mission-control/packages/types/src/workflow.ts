import { z } from "zod";

/** A workflow node: run an agent, or call a connector tool. (router/parallel are future work.) */
export const WorkflowNode = z.object({
  id: z.string(),
  type: z.enum(["agent", "tool"]),
  /** agent node */
  agentId: z.string().optional(),
  /** prompt template; supports {{input}} and {{<nodeId>}} substitutions */
  prompt: z.string().optional(),
  /** tool node */
  connectorId: z.string().optional(),
  tool: z.string().optional(),
  args: z.record(z.unknown()).optional(),
});
export type WorkflowNode = z.infer<typeof WorkflowNode>;

/** A directed edge; if `whenContains` is set, it's taken only when the source output contains it. */
export const WorkflowEdge = z.object({
  from: z.string(),
  to: z.string(),
  whenContains: z.string().optional(),
});
export type WorkflowEdge = z.infer<typeof WorkflowEdge>;

export const WorkflowGraph = z.object({
  entry: z.string(),
  nodes: z.array(WorkflowNode),
  edges: z.array(WorkflowEdge),
});
export type WorkflowGraph = z.infer<typeof WorkflowGraph>;

export const Workflow = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  graph: WorkflowGraph,
  createdAt: z.string(),
});
export type Workflow = z.infer<typeof Workflow>;

export const WorkflowRunStatus = z.enum(["running", "completed", "failed"]);
export type WorkflowRunStatus = z.infer<typeof WorkflowRunStatus>;
