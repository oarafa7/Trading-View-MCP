/**
 * Local, deterministic embeddings via the hashing trick (feature hashing) — no network, no keys.
 * Good enough to demonstrate semantic-ish retrieval (overlapping vocabulary ranks higher).
 * In production, swap `embed` for a provider's `embed()` (OpenAI/Ollama) — the VectorStore and
 * MemoryService are agnostic to where vectors come from. See docs/mission-control/10-memory-rag.md.
 */
export const EMBED_DIM = 256;

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/** FNV-1a 32-bit hash. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function embed(text: string, dim: number = EMBED_DIM): number[] {
  const v = new Array<number>(dim).fill(0);
  for (const tok of tokenize(text)) {
    const idx = fnv1a(tok) % dim;
    const sign = fnv1a(tok + "§") % 2 === 0 ? 1 : -1; // signed hashing reduces collisions
    v[idx] = (v[idx] ?? 0) + sign;
  }
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  return v.map((x) => x / norm);
}

/** Cosine similarity of two L2-normalized vectors (= dot product). */
export function cosine(a: number[], b: number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i]! * b[i]!;
  return s;
}
