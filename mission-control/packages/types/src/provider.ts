import { z } from "zod";

/** Every LLM vendor/runtime the platform can talk to. `mock` is for offline tests/demos. */
export const ProviderId = z.enum([
  "openai",
  "anthropic",
  "google",
  "ollama",
  "openrouter",
  "groq",
  "together",
  "huggingface",
  "mock",
]);
export type ProviderId = z.infer<typeof ProviderId>;

export const Modality = z.enum(["text", "image", "audio"]);
export type Modality = z.infer<typeof Modality>;

/** What a given model can do — used by the router for capability-aware selection. */
export const ModelCapabilities = z.object({
  contextWindow: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive().optional(),
  supportsTools: z.boolean().default(false),
  supportsStreaming: z.boolean().default(true),
  supportsJsonMode: z.boolean().default(false),
  inputModalities: z.array(Modality).default(["text"]),
});
export type ModelCapabilities = z.infer<typeof ModelCapabilities>;

/** A registered model + its pricing (USD per 1M tokens), basis of all cost accounting. */
export const ModelInfo = z.object({
  id: z.string(), // platform id, e.g. mdl_...
  provider: ProviderId,
  modelId: z.string(), // vendor model id, e.g. "gpt-4o", "claude-opus-4-8"
  displayName: z.string(),
  capabilities: ModelCapabilities,
  pricing: z.object({
    inputPerM: z.number().nonnegative().default(0),
    outputPerM: z.number().nonnegative().default(0),
    cachedInputPerM: z.number().nonnegative().optional(),
  }),
  enabled: z.boolean().default(true),
});
export type ModelInfo = z.infer<typeof ModelInfo>;
