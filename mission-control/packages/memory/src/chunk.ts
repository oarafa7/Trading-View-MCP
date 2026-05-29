export interface ChunkOptions {
  maxChars?: number;
  overlap?: number;
}

/** Structure-aware-ish chunker: packs paragraphs up to `maxChars`, hard-splitting long ones. */
export function chunkText(text: string, opts: ChunkOptions = {}): string[] {
  const maxChars = opts.maxChars ?? 600;
  const overlap = opts.overlap ?? 80;
  const clean = text.trim();
  if (clean.length <= maxChars) return clean ? [clean] : [];

  const paras = clean.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let cur = "";

  const flush = () => {
    if (cur.trim()) chunks.push(cur.trim());
    cur = cur.length > overlap ? cur.slice(cur.length - overlap) : "";
  };

  for (const para of paras) {
    if (para.length > maxChars) {
      flush();
      for (let i = 0; i < para.length; i += maxChars - overlap) {
        chunks.push(para.slice(i, i + maxChars));
      }
      cur = "";
      continue;
    }
    if ((cur + "\n\n" + para).length > maxChars) flush();
    cur = cur ? `${cur}\n\n${para}` : para;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}
