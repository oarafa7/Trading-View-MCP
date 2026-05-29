import { z } from "zod";

export const AgentKind = z.enum([
  "research",
  "coding",
  "trading",
  "finance",
  "data",
  "social",
  "compliance",
  "custom",
]);
export type AgentKind = z.infer<typeof AgentKind>;

export const AgentSettings = z.object({
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  maxTokens: z.number().int().positive().optional(),
  maxToolIterations: z.number().int().positive().default(8),
  budget: z
    .object({
      maxUsdPerRun: z.number().positive().optional(),
      maxTokensPerRun: z.number().int().positive().optional(),
    })
    .optional(),
});
export type AgentSettings = z.infer<typeof AgentSettings>;

export const AgentMemoryConfig = z.object({
  shortTerm: z.enum(["window", "summary", "none"]).default("window"),
  longTerm: z.boolean().default(false),
  retrieval: z
    .object({ topK: z.number().int().positive().default(6), sources: z.array(z.string()).optional() })
    .optional(),
});
export type AgentMemoryConfig = z.infer<typeof AgentMemoryConfig>;

export const AgentStatus = z.enum(["idle", "running", "awaiting_approval", "error", "disabled"]);
export type AgentStatus = z.infer<typeof AgentStatus>;

/** A grant allowing an agent to call one tool on one connector, with an optional HITL gate. */
export const AgentToolGrant = z.object({
  connectorId: z.string(),
  toolName: z.string(),
  requireApproval: z.boolean().default(false),
});
export type AgentToolGrant = z.infer<typeof AgentToolGrant>;

export const AgentDefinition = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  kind: AgentKind.default("custom"),
  systemPrompt: z.string().default(""),
  modelId: z.string(),
  settings: AgentSettings.default({}),
  memory: AgentMemoryConfig.default({}),
  tools: z.array(AgentToolGrant).default([]),
  status: AgentStatus.default("idle"),
  costToDate: z.number().nonnegative().default(0),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AgentDefinition = z.infer<typeof AgentDefinition>;

/** Run lifecycle states (see docs/mission-control/06-agent-lifecycle.md). */
export const RunStatus = z.enum([
  "queued",
  "running",
  "awaiting_tool",
  "awaiting_approval",
  "completed",
  "failed",
  "cancelled",
]);
export type RunStatus = z.infer<typeof RunStatus>;
