import type { ProviderId, StreamEvent, UnifiedRequest, UnifiedMessage, ModelCapabilities } from "@mc/types";
import { BaseProvider, type CallOpts } from "../contract.js";
import { estimateTokens, estimateTextTokens } from "../tokens.js";

function lastUserText(messages: UnifiedMessage[]): string {
  const m = [...messages].reverse().find((x) => x.role === "user");
  if (!m) return "";
  return typeof m.content === "string" ? m.content : m.content.map((p) => (p.type === "text" ? p.text : "")).join(" ");
}

function hasToolResult(messages: UnifiedMessage[]): { found: boolean; text: string } {
  for (const m of [...messages].reverse()) {
    if (m.role === "tool" && Array.isArray(m.content)) {
      const tr = m.content.find((p) => p.type === "tool_result");
      if (tr && tr.type === "tool_result") return { found: true, text: JSON.stringify(tr.result) };
    }
  }
  return { found: false, text: "" };
}

function argsFor(toolName: string, prompt: string): Record<string, unknown> {
  if (toolName === "add") {
    const nums = prompt.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
    return { a: nums[0] ?? 0, b: nums[1] ?? 0 };
  }
  if (toolName === "send_notification") return { message: prompt };
  return {};
}

/**
 * Offline provider for tests/demos with no API key. Echoes the last user message, and — when
 * tools are offered and the prompt names one — exercises the full tool-calling loop:
 * it emits a tool_call, then on the follow-up turn summarizes the tool result.
 */
export class MockProvider extends BaseProvider {
  readonly id: ProviderId = "mock";
  private delayMs: number;

  constructor(opts: { delayMs?: number } = {}) {
    super();
    this.delayMs = opts.delayMs ?? 0;
  }

  override capabilities(_model: string): ModelCapabilities {
    return { contextWindow: 128_000, supportsTools: true, supportsStreaming: true, supportsJsonMode: true, inputModalities: ["text"] };
  }

  async *stream(req: UnifiedRequest, opts: CallOpts): AsyncIterable<StreamEvent> {
    const prompt = lastUserText(req.messages);
    const prior = hasToolResult(req.messages);

    // Second turn: a tool already ran — summarize its result and stop.
    if (prior.found) {
      const reply = `Done. The tool returned: ${prior.text}`;
      yield* this.emitText(reply, opts);
      yield this.finish(req, reply);
      return;
    }

    // First turn: if a named tool is offered and the prompt mentions it, call it.
    const tool = req.tools?.find((t) => prompt.toLowerCase().includes(t.name.toLowerCase()));
    if (tool) {
      const args = argsFor(tool.name, prompt);
      const argStr = JSON.stringify(args);
      const tcId = `tc_mock_${Date.now()}`;
      yield { type: "tool_call", id: tcId, name: tool.name, argsDelta: argStr };
      yield { type: "tool_call_done", id: tcId, name: tool.name, args };
      yield { type: "finish", reason: "tool_calls", usage: { inputTokens: estimateTokens(req.messages), outputTokens: estimateTextTokens(argStr) } };
      return;
    }

    // Plain echo.
    const reply = `Mock(${req.model}) received ${prompt.length} chars. Echo: ${prompt}`;
    yield* this.emitText(reply, opts);
    yield this.finish(req, reply);
  }

  private async *emitText(text: string, opts: CallOpts): AsyncIterable<StreamEvent> {
    for (const w of text.match(/\S+\s*/g) ?? [text]) {
      if (opts.signal?.aborted) break;
      if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
      yield { type: "token", delta: w };
    }
  }

  private finish(req: UnifiedRequest, reply: string): StreamEvent {
    return { type: "finish", reason: "stop", usage: { inputTokens: estimateTokens(req.messages), outputTokens: estimateTextTokens(reply) } };
  }
}
