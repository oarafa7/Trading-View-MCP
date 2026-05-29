"use client";

import { useEffect, useState } from "react";
import { api, type KnowledgeSource, type RetrievedChunk } from "@/lib/gateway";
import { TopNav } from "@/components/TopNav";

export default function KnowledgePage() {
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [stats, setStats] = useState<{ sources: number; chunks: number }>({ sources: 0, chunks: 0 });
  const [online, setOnline] = useState<boolean | null>(null);

  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [adding, setAdding] = useState(false);

  const [query, setQuery] = useState("how much should I risk per trade?");
  const [hits, setHits] = useState<RetrievedChunk[]>([]);
  const [searching, setSearching] = useState(false);

  async function refresh() {
    try {
      const k = await api.knowledge();
      setSources(k.sources);
      setStats(k.stats);
      setOnline(true);
    } catch {
      setOnline(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);

  async function add() {
    if (!title.trim() || !text.trim() || adding) return;
    setAdding(true);
    await api.ingestDoc(title.trim(), text.trim());
    setTitle("");
    setText("");
    await refresh();
    setAdding(false);
  }

  async function search() {
    if (!query.trim() || searching) return;
    setSearching(true);
    const res = await api.searchKnowledge(query.trim(), 5);
    setHits(res.chunks);
    setSearching(false);
  }

  return (
    <div className="flex h-screen flex-col">
      <TopNav
        right={
          <span className="flex items-center gap-4">
            <span>
              gateway <span className={online === false ? "text-danger" : online ? "text-ok" : "text-muted"}>{online === false ? "offline" : online ? "online" : "…"}</span>
            </span>
            <span>
              <span className="text-accent">{stats.sources}</span> docs · <span className="text-accent">{stats.chunks}</span> chunks
            </span>
          </span>
        }
      />

      <div className="grid flex-1 grid-cols-3 gap-4 overflow-auto p-4">
        {/* sources + add */}
        <section className="space-y-4">
          <Panel title="Add document">
            <div className="space-y-2">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Title"
                className="w-full rounded-lg border border-border bg-base px-3 py-2 text-sm text-white outline-none focus:border-accent/60"
              />
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Paste document text…"
                rows={5}
                className="w-full resize-none rounded-lg border border-border bg-base px-3 py-2 text-sm text-white outline-none focus:border-accent/60"
              />
              <button
                onClick={() => void add()}
                disabled={adding || !title.trim() || !text.trim()}
                className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-base transition hover:opacity-90 disabled:opacity-40"
              >
                {adding ? "Embedding…" : "Ingest"}
              </button>
            </div>
          </Panel>

          <Panel title={`Sources (${sources.length})`}>
            <div className="space-y-2">
              {sources.map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded-lg border border-border bg-base p-3 text-sm">
                  <span className="text-white">{s.title}</span>
                  <span className="font-mono text-[11px] text-muted">
                    {s.chunkCount} chunks · <span className="text-ok">{s.status}</span>
                  </span>
                </div>
              ))}
              {sources.length === 0 && <div className="text-xs text-muted">No documents yet.</div>}
            </div>
          </Panel>
        </section>

        {/* retrieval playground */}
        <section className="col-span-2">
          <Panel title="Retrieval playground (RAG)">
            <div className="flex gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void search()}
                placeholder="Ask the knowledge base…"
                className="flex-1 rounded-lg border border-border bg-base px-3 py-2 text-sm text-white outline-none focus:border-accent/60"
              />
              <button
                onClick={() => void search()}
                disabled={searching || !query.trim()}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-base transition hover:opacity-90 disabled:opacity-40"
              >
                {searching ? "…" : "Search"}
              </button>
            </div>

            <div className="mt-4 space-y-3">
              {hits.map((h, i) => (
                <div key={i} className="rounded-lg border border-border bg-base p-3">
                  <div className="flex items-center justify-between font-mono text-[11px]">
                    <span className="text-white">{h.sourceTitle}</span>
                    <span className="text-accent">score {h.score.toFixed(3)}</span>
                  </div>
                  <div className="mt-1.5 h-1 w-full rounded bg-elevated">
                    <div className="h-1 rounded bg-accent" style={{ width: `${Math.min(100, Math.max(3, h.score * 100))}%` }} />
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-muted">{h.text}</p>
                </div>
              ))}
              {hits.length === 0 && <div className="text-xs text-muted">Run a search to see ranked chunks. These same chunks are injected into agents with long-term memory enabled.</div>}
            </div>
          </Panel>
        </section>
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-panel p-4">
      <div className="mb-3 text-[10px] uppercase tracking-widest text-muted">{title}</div>
      {children}
    </div>
  );
}
