import { randomUUID } from "node:crypto";
import { embed } from "./embedding.js";
import { InMemoryVectorStore } from "./vectorstore.js";
import { chunkText, type ChunkOptions } from "./chunk.js";

export interface KnowledgeSource {
  id: string;
  workspaceId: string;
  title: string;
  status: "ready";
  chunkCount: number;
  createdAt: string;
}

export interface RetrievedChunk {
  text: string;
  score: number;
  sourceId: string;
  sourceTitle: string;
}

export type EmbedFn = (text: string) => number[];

/**
 * Ties chunking + embedding + vector storage into the RAG pipeline used by the gateway:
 * ingest documents, then retrieve relevant chunks for a query (scoped per workspace).
 */
export class MemoryService {
  private store = new InMemoryVectorStore();
  private sources = new Map<string, KnowledgeSource>();

  constructor(
    private embedFn: EmbedFn = embed,
    private chunkOpts: ChunkOptions = {},
  ) {}

  ingest(workspaceId: string, title: string, text: string): KnowledgeSource {
    const sourceId = `src_${randomUUID().replace(/-/g, "")}`;
    const chunks = chunkText(text, this.chunkOpts);
    this.store.upsert(
      chunks.map((c, i) => ({
        id: `${sourceId}_${i}`,
        vector: this.embedFn(c),
        payload: { workspaceId, sourceId, sourceTitle: title, text: c },
      })),
    );
    const source: KnowledgeSource = {
      id: sourceId,
      workspaceId,
      title,
      status: "ready",
      chunkCount: chunks.length,
      createdAt: new Date().toISOString(),
    };
    this.sources.set(sourceId, source);
    return source;
  }

  retrieve(workspaceId: string, query: string, topK = 5): RetrievedChunk[] {
    const qv = this.embedFn(query);
    return this.store
      .search(qv, topK, (p) => p.workspaceId === workspaceId)
      .filter((h) => h.score > 0.01)
      .map((h) => ({
        text: String(h.point.payload.text),
        score: Math.round(h.score * 1000) / 1000,
        sourceId: String(h.point.payload.sourceId),
        sourceTitle: String(h.point.payload.sourceTitle),
      }));
  }

  listSources(workspaceId: string): KnowledgeSource[] {
    return [...this.sources.values()].filter((s) => s.workspaceId === workspaceId);
  }

  stats(workspaceId: string): { sources: number; chunks: number } {
    return {
      sources: this.listSources(workspaceId).length,
      chunks: this.store.count((p) => p.workspaceId === workspaceId),
    };
  }
}
