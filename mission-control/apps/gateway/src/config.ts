import type { ProviderId } from "@mc/types";
import type { ResolvedModel, ModelResolver } from "@mc/agent-core";
import type { MemoryStore } from "./store.js";

export interface GatewayConfig {
  port: number;
  webOrigin: string;
}

export function loadConfig(): GatewayConfig {
  return {
    port: Number(process.env.PORT ?? 4000),
    webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
  };
}

/** Pull a provider credential from the environment. Real deployments use the encrypted store. */
export function credentialFor(provider: ProviderId): ResolvedModel["credential"] {
  switch (provider) {
    case "openai":
      return { apiKey: process.env.OPENAI_API_KEY, baseUrl: process.env.OPENAI_BASE_URL };
    case "anthropic":
      return { apiKey: process.env.ANTHROPIC_API_KEY, baseUrl: process.env.ANTHROPIC_BASE_URL };
    case "groq":
      return { apiKey: process.env.GROQ_API_KEY };
    case "openrouter":
      return { apiKey: process.env.OPENROUTER_API_KEY };
    case "together":
      return { apiKey: process.env.TOGETHER_API_KEY };
    case "ollama":
      return { baseUrl: process.env.OLLAMA_BASE_URL };
    default:
      return undefined;
  }
}

/** Build a ModelResolver backed by the store's model registry + env credentials. */
export function makeModelResolver(store: MemoryStore): ModelResolver {
  return (modelId: string): ResolvedModel | undefined => {
    const m = store.models.get(modelId);
    if (!m) return undefined;
    return {
      provider: m.provider,
      vendorModelId: m.modelId,
      pricing: m.pricing,
      credential: credentialFor(m.provider),
    };
  };
}
