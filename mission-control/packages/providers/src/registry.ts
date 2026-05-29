import type { ProviderId } from "@mc/types";
import type { LLMProvider } from "./contract.js";
import { MockProvider } from "./adapters/mock.js";
import { OpenAICompatibleProvider } from "./adapters/openai-compatible.js";
import { AnthropicProvider } from "./adapters/anthropic.js";
import { OllamaProvider } from "./adapters/ollama.js";

/** Resolves a `ProviderId` to a singleton adapter instance. */
export class ProviderRegistry {
  private providers = new Map<ProviderId, LLMProvider>();

  constructor(registerDefaults = true) {
    if (registerDefaults) this.registerDefaults();
  }

  register(provider: LLMProvider): void {
    this.providers.set(provider.id, provider);
  }

  get(id: ProviderId): LLMProvider {
    const p = this.providers.get(id);
    if (!p) throw new Error(`No provider registered for "${id}"`);
    return p;
  }

  has(id: ProviderId): boolean {
    return this.providers.has(id);
  }

  registerDefaults(): void {
    this.register(new MockProvider({ delayMs: 0 }));
    this.register(new OpenAICompatibleProvider("openai"));
    this.register(new OpenAICompatibleProvider("groq"));
    this.register(new OpenAICompatibleProvider("openrouter"));
    this.register(new OpenAICompatibleProvider("together"));
    this.register(new AnthropicProvider());
    this.register(new OllamaProvider());
  }
}
