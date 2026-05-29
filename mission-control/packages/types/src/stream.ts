import { z } from "zod";

export const FinishReason = z.enum(["stop", "length", "tool_calls", "content_filter", "error"]);
export type FinishReason = z.infer<typeof FinishReason>;

/** Authoritative token counts reported by the provider on finish. */
export const Usage = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative().optional(),
  reasoningTokens: z.number().int().nonnegative().optional(),
});
export type Usage = z.infer<typeof Usage>;

/** Stable error categories shared by the provider layer and the HTTP API. */
export const ErrorCode = z.enum([
  "AUTH",
  "RATE_LIMIT",
  "CONTEXT_LENGTH",
  "CONTENT_FILTER",
  "PROVIDER_UNAVAILABLE",
  "TIMEOUT",
  "BAD_REQUEST",
  "TOOL_ERROR",
  "BUDGET_EXCEEDED",
  "UNKNOWN",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ProviderError = z.object({
  code: ErrorCode,
  message: z.string(),
  retryable: z.boolean().default(false),
  provider: z.string().optional(),
  status: z.number().optional(),
});
export type ProviderError = z.infer<typeof ProviderError>;

/**
 * The normalized streaming event set. Every adapter maps its native chunks
 * into exactly these shapes so the runtime and UI render one schema.
 */
export type StreamEvent =
  | { type: "token"; delta: string }
  | { type: "reasoning"; delta: string }
  | { type: "tool_call"; id: string; name: string; argsDelta: string }
  | { type: "tool_call_done"; id: string; name: string; args: unknown }
  | { type: "finish"; reason: FinishReason; usage: Usage }
  | { type: "error"; error: ProviderError };

export interface TokenCount {
  inputTokens: number;
}
