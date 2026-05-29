import type { ProviderId, StreamEvent, UnifiedRequest, UnifiedMessage, Usage, FinishReason } from "@mc/types";
import { BaseProvider, type CallOpts } from "../contract.js";
import { fetchStream, parseSSE } from "../http.js";
import { providerError, ProviderCallError } from "../errors.js";

const DEFAULT_BASE_URLS: Partial<Record<ProviderId, string>> = {
  openai: "https://api.openai.com/v1",
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  together: "https://api.together.xyz/v1",
};

function toOpenAIMessages(messages: UnifiedMessage[]) {
  return messages.map((m) => {
    if (typeof m.content === "string") return { role: m.role, content: m.content };
    if (m.role === "tool") {
      const tr = m.content.find((p) => p.type === "tool_result");
      return {
        role: "tool" as const,
        tool_call_id: tr?.type === "tool_result" ? tr.toolCallId : "",
        content: JSON.stringify(tr?.type === "tool_result" ? tr.result : ""),
      };
    }
    const text = m.content.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("");
    const toolCalls = m.content
      .filter((p) => p.type === "tool_call")
      .map((p) => {
        const tc = p as { id: string; name: string; args: unknown };
        return { id: tc.id, type: "function" as const, function: { name: tc.name, arguments: JSON.stringify(tc.args ?? {}) } };
      });
    return { role: m.role, content: text || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) };
  });
}

function mapFinish(reason: string | null | undefined): FinishReason {
  switch (reason) {
    case "length":
      return "length";
    case "tool_calls":
    case "function_call":
      return "tool_calls";
    case "content_filter":
      return "content_filter";
    default:
      return "stop";
  }
}

/** Adapter for any OpenAI-wire-compatible API: OpenAI, Groq, OpenRouter, Together. */
export class OpenAICompatibleProvider extends BaseProvider {
  readonly id: ProviderId;
  private defaultBaseUrl?: string;

  constructor(id: ProviderId = "openai") {
    super();
    this.id = id;
    this.defaultBaseUrl = DEFAULT_BASE_URLS[id];
  }

  async *stream(req: UnifiedRequest, opts: CallOpts): AsyncIterable<StreamEvent> {
    const baseUrl = opts.baseUrl ?? this.defaultBaseUrl;
    if (!baseUrl) throw new ProviderCallError(providerError(this.id, "Missing baseUrl", { code: "BAD_REQUEST" }));

    const body: Record<string, unknown> = {
      model: req.model,
      messages: toOpenAIMessages(req.messages),
      stream: true,
      stream_options: { include_usage: true },
    };
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.topP !== undefined) body.top_p = req.topP;
    if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
      if (req.toolChoice) body.tool_choice = typeof req.toolChoice === "object" ? { type: "function", function: { name: req.toolChoice.name } } : req.toolChoice;
    }
    if (req.responseFormat === "json") body.response_format = { type: "json_object" };

    const res = await fetchStream(
      `${baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${opts.apiKey ?? ""}`,
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

    const toolAcc = new Map<number, { id: string; name: string; args: string }>();
    let usage: Usage = { inputTokens: 0, outputTokens: 0 };
    let finish: FinishReason = "stop";

    for await (const data of parseSSE(res)) {
      let json: any;
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }
      if (json.usage) {
        usage = {
          inputTokens: json.usage.prompt_tokens ?? 0,
          outputTokens: json.usage.completion_tokens ?? 0,
          cachedInputTokens: json.usage.prompt_tokens_details?.cached_tokens,
        };
      }
      const choice = json.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta ?? {};
      if (typeof delta.content === "string" && delta.content.length) {
        yield { type: "token", delta: delta.content };
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          const acc = toolAcc.get(idx) ?? { id: tc.id ?? `tc_${idx}`, name: "", args: "" };
          if (tc.id) acc.id = tc.id;
          if (tc.function?.name) acc.name = tc.function.name;
          if (tc.function?.arguments) {
            acc.args += tc.function.arguments;
            yield { type: "tool_call", id: acc.id, name: acc.name, argsDelta: tc.function.arguments };
          }
          toolAcc.set(idx, acc);
        }
      }
      if (choice.finish_reason) finish = mapFinish(choice.finish_reason);
    }

    for (const acc of toolAcc.values()) {
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
