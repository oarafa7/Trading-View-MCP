import type {
  AgentDefinition,
  ModelInfo,
  ProviderId,
  UnifiedMessage,
  UnifiedRequest,
  UsageEvent,
  FinishReason,
  ProviderError,
} from "@mc/types";
import { ProviderRegistry, computeCostUsd, type CallOpts } from "@mc/providers";
import { id, nowIso } from "./ids.js";

/** How a platform model id resolves to a concrete provider call. */
export interface ResolvedModel {
  provider: ProviderId;
  vendorModelId: string;
  pricing: ModelInfo["pricing"];
  credential?: { apiKey?: string; baseUrl?: string };
}

export type ModelResolver = (modelId: string) => ResolvedModel | undefined;

/** Events the runtime emits; the gateway forwards these to SSE/WS. */
export type RunEvent =
  | { type: "token"; delta: string }
  | { type: "reasoning"; delta: string }
  | { type: "tool_call"; id: string; name: string; argsDelta: string }
  | { type: "tool_call_done"; id: string; name: string; args: unknown }
  | { type: "usage"; event: UsageEvent }
  | { type: "done"; runId: string; finishReason: FinishReason }
  | { type: "error"; error: ProviderError };

export interface RunInput {
  agent: AgentDefinition;
  /** Prior conversation turns (system prompt is injected from the agent). */
  history: UnifiedMessage[];
  runId?: string;
  signal?: AbortSignal;
}

/**
 * Executes one agent turn against the provider layer and yields normalized events.
 * Phase 1: streaming chat + usage/cost. The tool-calling loop (HITL, MCP) plugs in here
 * (see docs/mission-control/06-agent-lifecycle.md) without changing the event contract.
 */
export class AgentRuntime {
  constructor(
    private registry: ProviderRegistry,
    private resolveModel: ModelResolver,
  ) {}

  async *run(input: RunInput): AsyncGenerator<RunEvent> {
    const { agent } = input;
    const runId = input.runId ?? id("run");

    const resolved = this.resolveModel(agent.modelId);
    if (!resolved) {
      yield { type: "error", error: { code: "BAD_REQUEST", message: `Unknown model "${agent.modelId}"`, retryable: false } };
      return;
    }

    const messages: UnifiedMessage[] = [];
    if (agent.systemPrompt) messages.push({ role: "system", content: agent.systemPrompt });
    messages.push(...input.history);

    const req: UnifiedRequest = {
      model: resolved.vendorModelId,
      messages,
      temperature: agent.settings.temperature,
      topP: agent.settings.topP,
      maxTokens: agent.settings.maxTokens,
    };

    const provider = this.registry.get(resolved.provider);
    const opts: CallOpts = {
      apiKey: resolved.credential?.apiKey,
      baseUrl: resolved.credential?.baseUrl,
      signal: input.signal,
    };

    const startedAt = Date.now();
    let finishReason: FinishReason = "stop";

    try {
      for await (const ev of provider.stream(req, opts)) {
        switch (ev.type) {
          case "token":
            yield { type: "token", delta: ev.delta };
            break;
          case "reasoning":
            yield { type: "reasoning", delta: ev.delta };
            break;
          case "tool_call":
            yield { type: "tool_call", id: ev.id, name: ev.name, argsDelta: ev.argsDelta };
            break;
          case "tool_call_done":
            yield { type: "tool_call_done", id: ev.id, name: ev.name, args: ev.args };
            break;
          case "error":
            yield { type: "error", error: ev.error };
            return;
          case "finish": {
            finishReason = ev.reason;
            const costUsd = resolved.provider === "ollama" || resolved.provider === "mock" ? 0 : computeCostUsd(ev.usage, resolved.pricing);
            const usageEvent: UsageEvent = {
              id: id("ue"),
              workspaceId: agent.workspaceId,
              runId,
              agentId: agent.id,
              provider: resolved.provider,
              modelId: resolved.vendorModelId,
              inputTokens: ev.usage.inputTokens,
              outputTokens: ev.usage.outputTokens,
              cachedTokens: ev.usage.cachedInputTokens ?? 0,
              reasoningTokens: ev.usage.reasoningTokens ?? 0,
              costUsd,
              latencyMs: Date.now() - startedAt,
              ts: nowIso(),
            };
            yield { type: "usage", event: usageEvent };
            break;
          }
        }
      }
    } catch (err) {
      const pe = (err as { providerError?: ProviderError }).providerError;
      yield {
        type: "error",
        error: pe ?? { code: "UNKNOWN", message: err instanceof Error ? err.message : String(err), retryable: false },
      };
      return;
    }

    yield { type: "done", runId, finishReason };
  }
}
