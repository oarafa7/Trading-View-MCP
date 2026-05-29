import { z } from "zod";

/** A JSON-Schema tool definition, normalized to one shape across all providers. */
export const ToolSpec = z.object({
  name: z.string(),
  description: z.string().optional(),
  parameters: z.record(z.unknown()), // JSON Schema object
});
export type ToolSpec = z.infer<typeof ToolSpec>;

export const TextPart = z.object({ type: z.literal("text"), text: z.string() });
export const ToolCallPart = z.object({
  type: z.literal("tool_call"),
  id: z.string(),
  name: z.string(),
  args: z.unknown(),
});
export const ToolResultPart = z.object({
  type: z.literal("tool_result"),
  toolCallId: z.string(),
  result: z.unknown(),
  isError: z.boolean().default(false),
});

export const ContentPart = z.discriminatedUnion("type", [TextPart, ToolCallPart, ToolResultPart]);
export type ContentPart = z.infer<typeof ContentPart>;

/** Result returned by an MCP tool invocation. */
export const ToolResult = z.object({
  ok: z.boolean(),
  content: z.unknown(),
  isError: z.boolean().default(false),
});
export type ToolResult = z.infer<typeof ToolResult>;

export const MessageRole = z.enum(["system", "user", "assistant", "tool"]);
export type MessageRole = z.infer<typeof MessageRole>;

/** Provider-neutral message. `content` is either plain text or structured parts. */
export const UnifiedMessage = z.object({
  role: MessageRole,
  content: z.union([z.string(), z.array(ContentPart)]),
});
export type UnifiedMessage = z.infer<typeof UnifiedMessage>;

export const ResponseFormat = z.union([
  z.literal("text"),
  z.literal("json"),
  z.object({ schema: z.record(z.unknown()) }),
]);
export type ResponseFormat = z.infer<typeof ResponseFormat>;

export const ToolChoice = z.union([
  z.literal("auto"),
  z.literal("none"),
  z.literal("required"),
  z.object({ name: z.string() }),
]);
export type ToolChoice = z.infer<typeof ToolChoice>;

/** The one request shape every provider adapter accepts. */
export const UnifiedRequest = z.object({
  model: z.string(),
  messages: z.array(UnifiedMessage),
  tools: z.array(ToolSpec).optional(),
  toolChoice: ToolChoice.optional(),
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  maxTokens: z.number().int().positive().optional(),
  responseFormat: ResponseFormat.optional(),
  metadata: z.record(z.string()).optional(),
});
export type UnifiedRequest = z.infer<typeof UnifiedRequest>;
