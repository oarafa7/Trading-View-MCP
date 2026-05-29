import type { UnifiedMessage } from "@mc/types";

/**
 * Heuristic token estimate (~4 chars/token). Used for pre-flight budgeting and routing only;
 * provider-reported usage on finish is authoritative. Swap for a real tokenizer (tiktoken)
 * per provider when exact pre-flight counts matter.
 */
export function estimateTokens(messages: UnifiedMessage[]): number {
  let chars = 0;
  for (const m of messages) {
    if (typeof m.content === "string") {
      chars += m.content.length;
    } else {
      for (const part of m.content) {
        if (part.type === "text") chars += part.text.length;
        else chars += JSON.stringify(part).length;
      }
    }
    chars += 4; // role/formatting overhead
  }
  return Math.ceil(chars / 4);
}

export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
