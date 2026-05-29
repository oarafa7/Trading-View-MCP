import type { ModelInfo, Usage } from "@mc/types";

/** Cost in USD from authoritative usage + model pricing (per 1M tokens). */
export function computeCostUsd(usage: Usage, pricing: ModelInfo["pricing"]): number {
  const cached = usage.cachedInputTokens ?? 0;
  const billableInput = Math.max(0, usage.inputTokens - cached);
  const cachedRate = pricing.cachedInputPerM ?? pricing.inputPerM;
  const reasoning = usage.reasoningTokens ?? 0;

  const cost =
    (billableInput * pricing.inputPerM) / 1e6 +
    (cached * cachedRate) / 1e6 +
    ((usage.outputTokens + reasoning) * pricing.outputPerM) / 1e6;

  return Math.round(cost * 1e6) / 1e6; // round to 6 decimals
}
