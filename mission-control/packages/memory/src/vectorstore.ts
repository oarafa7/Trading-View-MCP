import { cosine } from "./embedding.js";

export interface VectorPoint {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
}

export interface SearchHit {
  point: VectorPoint;
  score: number;
}

/**
 * In-memory vector store (cosine kNN). The interface mirrors what a Qdrant-backed store would
 * expose, so swapping is contained to this file. See docs/mission-control/10-memory-rag.md.
 */
export class InMemoryVectorStore {
  private points = new Map<string, VectorPoint>();

  upsert(points: VectorPoint[]): void {
    for (const p of points) this.points.set(p.id, p);
  }

  search(query: number[], topK: number, filter?: (payload: Record<string, unknown>) => boolean): SearchHit[] {
    const hits: SearchHit[] = [];
    for (const point of this.points.values()) {
      if (filter && !filter(point.payload)) continue;
      hits.push({ point, score: cosine(query, point.vector) });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, topK);
  }

  remove(filter: (payload: Record<string, unknown>) => boolean): number {
    let n = 0;
    for (const [id, p] of this.points) if (filter(p.payload)) (this.points.delete(id), n++);
    return n;
  }

  count(filter?: (payload: Record<string, unknown>) => boolean): number {
    if (!filter) return this.points.size;
    let n = 0;
    for (const p of this.points.values()) if (filter(p.payload)) n++;
    return n;
  }
}
