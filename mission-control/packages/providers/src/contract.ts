import type {
  UnifiedRequest,
  StreamEvent,
  Usage,
  TokenCount,
  ProviderId,
  ModelCapabilities,
  FinishReason,
} from "@mc/types";
import { estimateTokens } from "./tokens.js";

export interface CallOpts {
  apiKey?: string;
  baseUrl?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface UnifiedResult {
  text: string;
  toolCalls: { id: string; name: string; args: unknown }[];
  finishReason: FinishReason;
  usage: Usage;
}

/** The single interface every adapter implements. Nothing above this layer is vendor-aware. */
export interface LLMProvider {
  readonly id: ProviderId;
  capabilities(model: string): ModelCapabilities | undefined;
  stream(req: UnifiedRequest, opts: CallOpts): AsyncIterable<StreamEvent>;
  chat(req: UnifiedRequest, opts: CallOpts): Promise<UnifiedResult>;
  countTokens(req: UnifiedRequest): Promise<TokenCount>;
}

/**
 * Shared base: `chat()` is derived by draining `stream()`, and `countTokens()` uses a
 * heuristic estimate. Adapters only need to implement `stream()` (+ optional overrides).
 */
export abstract class BaseProvider implements LLMProvider {
  abstract readonly id: ProviderId;

  capabilities(_model: string): ModelCapabilities | undefined {
    return undefined;
  }

  abstract stream(req: UnifiedRequest, opts: CallOpts): AsyncIterable<StreamEvent>;

  async chat(req: UnifiedRequest, opts: CallOpts): Promise<UnifiedResult> {
    let text = "";
    const toolCalls: UnifiedResult["toolCalls"] = [];
    let finishReason: FinishReason = "stop";
    let usage: Usage = { inputTokens: 0, outputTokens: 0 };

    for await (const ev of this.stream(req, opts)) {
      switch (ev.type) {
        case "token":
          text += ev.delta;
          break;
        case "tool_call_done":
          toolCalls.push({ id: ev.id, name: ev.name, args: ev.args });
          break;
        case "finish":
          finishReason = ev.reason;
          usage = ev.usage;
          break;
        case "error":
          throw Object.assign(new Error(ev.error.message), { providerError: ev.error });
      }
    }
    return { text, toolCalls, finishReason, usage };
  }

  async countTokens(req: UnifiedRequest): Promise<TokenCount> {
    return { inputTokens: estimateTokens(req.messages) };
  }
}
