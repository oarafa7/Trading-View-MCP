import type { ProviderId, StreamEvent, UnifiedRequest, UnifiedMessage, Usage } from "@mc/types";
import { BaseProvider, type CallOpts } from "../contract.js";
import { fetchStream, parseNDJSON } from "../http.js";
import { providerError } from "../errors.js";

const DEFAULT_BASE_URL = "http://localhost:11434";

function toOllamaMessages(messages: UnifiedMessage[]) {
  return messages.map((m) => ({
    role: m.role === "tool" ? "tool" : m.role,
    content:
      typeof m.content === "string"
        ? m.content
        : m.content.map((p) => (p.type === "text" ? p.text : JSON.stringify(p))).join(""),
  }));
}

/** Local models via Ollama. Streams NDJSON; cost is always zero (local compute). */
export class OllamaProvider extends BaseProvider {
  readonly id: ProviderId = "ollama";

  async *stream(req: UnifiedRequest, opts: CallOpts): AsyncIterable<StreamEvent> {
    const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
    const body: Record<string, unknown> = {
      model: req.model,
      messages: toOllamaMessages(req.messages),
      stream: true,
      options: {
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(req.topP !== undefined ? { top_p: req.topP } : {}),
        ...(req.maxTokens !== undefined ? { num_predict: req.maxTokens } : {}),
      },
    };

    const res = await fetchStream(
      `${baseUrl}/api/chat`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
      opts.timeoutMs,
      opts.signal,
    );

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      yield { type: "error", error: providerError(this.id, text || res.statusText, { status: res.status }) };
      return;
    }

    const usage: Usage = { inputTokens: 0, outputTokens: 0 };
    for await (const line of parseNDJSON(res)) {
      let json: any;
      try {
        json = JSON.parse(line);
      } catch {
        continue;
      }
      if (json.message?.content) yield { type: "token", delta: json.message.content };
      if (json.done) {
        usage.inputTokens = json.prompt_eval_count ?? 0;
        usage.outputTokens = json.eval_count ?? 0;
        yield { type: "finish", reason: "stop", usage };
        return;
      }
    }
    yield { type: "finish", reason: "stop", usage };
  }
}
