import type { ProviderId, StreamEvent, UnifiedRequest, ModelCapabilities } from "@mc/types";
import { BaseProvider, type CallOpts } from "../contract.js";
import { estimateTokens, estimateTextTokens } from "../tokens.js";

/**
 * Offline provider for tests/demos with no API key. Echoes a deterministic reply built
 * from the last user message, streamed token-by-token, and reports estimated usage.
 */
export class MockProvider extends BaseProvider {
  readonly id: ProviderId = "mock";
  private delayMs: number;

  constructor(opts: { delayMs?: number } = {}) {
    super();
    this.delayMs = opts.delayMs ?? 0;
  }

  override capabilities(_model: string): ModelCapabilities {
    return {
      contextWindow: 128_000,
      supportsTools: false,
      supportsStreaming: true,
      supportsJsonMode: true,
      inputModalities: ["text"],
    };
  }

  async *stream(req: UnifiedRequest, opts: CallOpts): AsyncIterable<StreamEvent> {
    const lastUser = [...req.messages].reverse().find((m) => m.role === "user");
    const prompt =
      typeof lastUser?.content === "string"
        ? lastUser.content
        : (lastUser?.content ?? []).map((p) => (p.type === "text" ? p.text : "")).join(" ");

    const reply = `Mock(${req.model}) received ${prompt.length} chars. Echo: ${prompt}`;
    const words = reply.match(/\S+\s*/g) ?? [reply];

    for (const w of words) {
      if (opts.signal?.aborted) break;
      if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
      yield { type: "token", delta: w };
    }

    yield {
      type: "finish",
      reason: "stop",
      usage: {
        inputTokens: estimateTokens(req.messages),
        outputTokens: estimateTextTokens(reply),
      },
    };
  }
}
