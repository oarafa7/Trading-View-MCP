import type { ProviderId, StreamEvent, UnifiedRequest, UnifiedMessage, Usage, FinishReason } from "@mc/types";
import { BaseProvider, type CallOpts } from "../contract.js";
import { fetchStream, parseSSE } from "../http.js";
import { providerError } from "../errors.js";

const DEFAULT_BASE_URL = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";

function splitSystem(messages: UnifiedMessage[]): { system: string; rest: UnifiedMessage[] } {
  const sys: string[] = [];
  const rest: UnifiedMessage[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      sys.push(typeof m.content === "string" ? m.content : m.content.map((p) => (p.type === "text" ? p.text : "")).join(""));
    } else {
      rest.push(m);
    }
  }
  return { system: sys.join("\n\n"), rest };
}

function toAnthropicMessages(messages: UnifiedMessage[]) {
  return messages.map((m) => {
    const role = m.role === "tool" ? "user" : m.role; // tool results go in a user turn
    if (typeof m.content === "string") return { role, content: m.content };
    const blocks = m.content.map((p) => {
      if (p.type === "text") return { type: "text", text: p.text };
      if (p.type === "tool_call") return { type: "tool_use", id: p.id, name: p.name, input: p.args ?? {} };
      return { type: "tool_result", tool_use_id: p.toolCallId, content: JSON.stringify(p.result), is_error: p.isError };
    });
    return { role, content: blocks };
  });
}

function mapStop(reason: string | null | undefined): FinishReason {
  switch (reason) {
    case "max_tokens":
      return "length";
    case "tool_use":
      return "tool_calls";
    default:
      return "stop";
  }
}

export class AnthropicProvider extends BaseProvider {
  readonly id: ProviderId = "anthropic";

  async *stream(req: UnifiedRequest, opts: CallOpts): AsyncIterable<StreamEvent> {
    const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
    const { system, rest } = splitSystem(req.messages);

    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.maxTokens ?? 4096,
      messages: toAnthropicMessages(rest),
      stream: true,
    };
    if (system) body.system = system;
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.topP !== undefined) body.top_p = req.topP;
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
      if (req.toolChoice && typeof req.toolChoice === "object") body.tool_choice = { type: "tool", name: req.toolChoice.name };
      else if (req.toolChoice === "required") body.tool_choice = { type: "any" };
      else if (req.toolChoice === "auto") body.tool_choice = { type: "auto" };
    }

    const res = await fetchStream(
      `${baseUrl}/v1/messages`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": opts.apiKey ?? "",
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
      },
      opts.timeoutMs,
      opts.signal,
    );

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      yield { type: "error", error: providerError(this.id, text || res.statusText, { status: res.status }) };
      return;
    }

    const usage: Usage = { inputTokens: 0, outputTokens: 0 };
    let finish: FinishReason = "stop";
    const toolBlocks = new Map<number, { id: string; name: string; args: string }>();

    for await (const data of parseSSE(res)) {
      let json: any;
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }
      switch (json.type) {
        case "message_start":
          usage.inputTokens = json.message?.usage?.input_tokens ?? 0;
          usage.cachedInputTokens = json.message?.usage?.cache_read_input_tokens;
          break;
        case "content_block_start":
          if (json.content_block?.type === "tool_use") {
            toolBlocks.set(json.index, { id: json.content_block.id, name: json.content_block.name, args: "" });
          }
          break;
        case "content_block_delta": {
          const d = json.delta ?? {};
          if (d.type === "text_delta" && d.text) yield { type: "token", delta: d.text };
          else if (d.type === "thinking_delta" && d.thinking) yield { type: "reasoning", delta: d.thinking };
          else if (d.type === "input_json_delta") {
            const acc = toolBlocks.get(json.index);
            if (acc) {
              acc.args += d.partial_json ?? "";
              yield { type: "tool_call", id: acc.id, name: acc.name, argsDelta: d.partial_json ?? "" };
            }
          }
          break;
        }
        case "message_delta":
          if (json.delta?.stop_reason) finish = mapStop(json.delta.stop_reason);
          if (json.usage?.output_tokens) usage.outputTokens = json.usage.output_tokens;
          break;
        case "error":
          yield { type: "error", error: providerError(this.id, json.error?.message ?? "stream error", { code: "PROVIDER_UNAVAILABLE", retryable: true }) };
          return;
      }
    }

    for (const acc of toolBlocks.values()) {
      let args: unknown = {};
      try {
        args = acc.args ? JSON.parse(acc.args) : {};
      } catch {
        args = { _raw: acc.args };
      }
      yield { type: "tool_call_done", id: acc.id, name: acc.name, args };
    }

    yield { type: "finish", reason: finish, usage };
  }
}
