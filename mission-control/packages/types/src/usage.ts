import { z } from "zod";
import { ProviderId } from "./provider.js";

/** One row per model call — the source of truth for all cost/token dashboards. */
export const UsageEvent = z.object({
  id: z.string(),
  workspaceId: z.string(),
  runId: z.string().optional(),
  agentId: z.string().optional(),
  provider: ProviderId,
  modelId: z.string(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cachedTokens: z.number().int().nonnegative().default(0),
  reasoningTokens: z.number().int().nonnegative().default(0),
  costUsd: z.number().nonnegative(),
  latencyMs: z.number().nonnegative(),
  ts: z.string(),
});
export type UsageEvent = z.infer<typeof UsageEvent>;
