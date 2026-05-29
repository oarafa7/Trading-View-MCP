import type {
  AgentDefinition,
  ModelInfo,
  ProviderId,
  ContentPart,
  ToolSpec,
  ToolResult,
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

/** A tool the agent may call, resolved to its connector + schema + approval policy. */
export interface ResolvedTool {
  spec: ToolSpec;
  connectorId: string;
  requireApproval: boolean;
}

export type ToolExecutor = (connectorId: string, tool: string, args: unknown) => Promise<ToolResult>;

export interface ApprovalRequest {
  runId: string;
  toolCallId: string;
  name: string;
  args: unknown;
}
export type ApprovalRequester = (req: ApprovalRequest) => Promise<boolean>;

export interface RetrievedChunk {
  text: string;
  score: number;
  sourceTitle?: string;
}
/** Long-term memory retrieval hook (RAG). Returns chunks relevant to a query. */
export type ContextRetriever = (query: string) => Promise<RetrievedChunk[]>;

/** Events the runtime emits; the gateway forwards these to SSE/WS. */
export type RunEvent =
  | { type: "token"; delta: string }
  | { type: "reasoning"; delta: string }
  | { type: "tool_call"; id: string; name: string; argsDelta: string }
  | { type: "tool_call_done"; id: string; name: string; args: unknown }
  | { type: "awaiting_approval"; toolCallId: string; name: string; args: unknown }
  | { type: "tool_result"; toolCallId: string; name: string; ok: boolean; result: unknown }
  | { type: "retrieval"; chunks: RetrievedChunk[] }
  | { type: "usage"; event: UsageEvent }
  | { type: "done"; runId: string; finishReason: FinishReason }
  | { type: "error"; error: ProviderError };

export interface RunInput {
  agent: AgentDefinition;
  /** Prior conversation turns (system prompt is injected from the agent). */
  history: UnifiedMessage[];
  tools?: ResolvedTool[];
  executeTool?: ToolExecutor;
  requestApproval?: ApprovalRequester;
  retrieveContext?: ContextRetriever;
  runId?: string;
  signal?: AbortSignal;
}

/**
 * Executes one agent turn against the provider layer and yields normalized events. Runs the
 * tool-calling loop (with HITL gates) until the model stops requesting tools or the iteration
 * cap is hit. See docs/mission-control/06-agent-lifecycle.md.
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

    // Long-term memory (RAG): retrieve relevant context and inject it before the conversation.
    if (input.retrieveContext) {
      const lastUser = [...input.history].reverse().find((m) => m.role === "user");
      const query = typeof lastUser?.content === "string" ? lastUser.content : "";
      if (query) {
        const chunks = await input.retrieveContext(query);
        if (chunks.length) {
          yield { type: "retrieval", chunks };
          const block = chunks.map((c, i) => `[${i + 1}] (${c.sourceTitle ?? "source"}) ${c.text}`).join("\n\n");
          messages.push({ role: "system", content: `Relevant context retrieved from the knowledge base:\n\n${block}` });
        }
      }
    }

    messages.push(...input.history);

    const toolSpecs = input.tools?.map((t) => t.spec) ?? [];
    const provider = this.registry.get(resolved.provider);
    const opts: CallOpts = { apiKey: resolved.credential?.apiKey, baseUrl: resolved.credential?.baseUrl, signal: input.signal };
    const maxIterations = agent.settings.maxToolIterations ?? 8;

    let finishReason: FinishReason = "stop";

    for (let iteration = 1; ; iteration++) {
      const req: UnifiedRequest = {
        model: resolved.vendorModelId,
        messages,
        temperature: agent.settings.temperature,
        topP: agent.settings.topP,
        maxTokens: agent.settings.maxTokens,
        ...(toolSpecs.length ? { tools: toolSpecs, toolChoice: "auto" as const } : {}),
      };

      let assistantText = "";
      const toolCalls: { id: string; name: string; args: unknown }[] = [];
      const startedAt = Date.now();

      try {
        for await (const ev of provider.stream(req, opts)) {
          switch (ev.type) {
            case "token":
              assistantText += ev.delta;
              yield { type: "token", delta: ev.delta };
              break;
            case "reasoning":
              yield { type: "reasoning", delta: ev.delta };
              break;
            case "tool_call":
              yield { type: "tool_call", id: ev.id, name: ev.name, argsDelta: ev.argsDelta };
              break;
            case "tool_call_done":
              toolCalls.push({ id: ev.id, name: ev.name, args: ev.args });
              yield { type: "tool_call_done", id: ev.id, name: ev.name, args: ev.args };
              break;
            case "error":
              yield { type: "error", error: ev.error };
              return;
            case "finish": {
              finishReason = ev.reason;
              const costUsd =
                resolved.provider === "ollama" || resolved.provider === "mock" ? 0 : computeCostUsd(ev.usage, resolved.pricing);
              yield {
                type: "usage",
                event: {
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
                },
              };
              break;
            }
          }
        }
      } catch (err) {
        const pe = (err as { providerError?: ProviderError }).providerError;
        yield { type: "error", error: pe ?? { code: "UNKNOWN", message: err instanceof Error ? err.message : String(err), retryable: false } };
        return;
      }

      // No tools requested (or no executor) → the turn is complete.
      if (toolCalls.length === 0 || !input.executeTool) break;

      // Record the assistant's tool-calling turn so the next request has context.
      const assistantParts: ContentPart[] = [];
      if (assistantText) assistantParts.push({ type: "text", text: assistantText });
      for (const tc of toolCalls) assistantParts.push({ type: "tool_call", id: tc.id, name: tc.name, args: tc.args });
      messages.push({ role: "assistant", content: assistantParts });

      // Execute each tool call (with optional human-in-the-loop approval).
      for (const tc of toolCalls) {
        const grant = input.tools?.find((t) => t.spec.name === tc.name);
        let result: ToolResult;

        if (grant?.requireApproval && input.requestApproval) {
          yield { type: "awaiting_approval", toolCallId: tc.id, name: tc.name, args: tc.args };
          const approved = await input.requestApproval({ runId, toolCallId: tc.id, name: tc.name, args: tc.args });
          if (!approved) {
            result = { ok: false, content: "Denied by operator", isError: true };
            messages.push({ role: "tool", content: [{ type: "tool_result", toolCallId: tc.id, result: result.content, isError: true }] });
            yield { type: "tool_result", toolCallId: tc.id, name: tc.name, ok: false, result: result.content };
            continue;
          }
        }

        result = await input.executeTool(grant?.connectorId ?? "", tc.name, tc.args);
        messages.push({ role: "tool", content: [{ type: "tool_result", toolCallId: tc.id, result: result.content, isError: result.isError }] });
        yield { type: "tool_result", toolCallId: tc.id, name: tc.name, ok: result.ok, result: result.content };
      }

      if (iteration >= maxIterations) {
        yield { type: "error", error: { code: "UNKNOWN", message: `max tool iterations (${maxIterations}) reached`, retryable: false } };
        break;
      }
      // loop: let the model produce its next turn using the tool results
    }

    yield { type: "done", runId, finishReason };
  }
}
