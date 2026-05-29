/** Low-level HTTP + streaming helpers shared by the network adapters. */

export async function fetchStream(
  url: string,
  init: RequestInit,
  timeoutMs = 120_000,
  externalSignal?: AbortSignal,
): Promise<Response> {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  externalSignal?.addEventListener("abort", onAbort);
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onAbort);
  }
}

/** Yield decoded text chunks from a Response body stream. */
async function* readChunks(res: Response): AsyncGenerator<string> {
  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    yield decoder.decode(value, { stream: true });
  }
}

/** Parse an SSE stream, yielding the `data:` payload of each event (skipping `[DONE]`). */
export async function* parseSSE(res: Response): AsyncGenerator<string> {
  let buffer = "";
  for await (const chunk of readChunks(res)) {
    buffer += chunk;
    let idx: number;
    // events are separated by a blank line
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const dataLines = raw
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim());
      if (dataLines.length === 0) continue;
      const data = dataLines.join("\n");
      if (data === "[DONE]") return;
      yield data;
    }
  }
}

/** Parse a newline-delimited JSON stream (Ollama), yielding each line. */
export async function* parseNDJSON(res: Response): AsyncGenerator<string> {
  let buffer = "";
  for await (const chunk of readChunks(res)) {
    buffer += chunk;
    let idx: number;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line) yield line;
    }
  }
  if (buffer.trim()) yield buffer.trim();
}
