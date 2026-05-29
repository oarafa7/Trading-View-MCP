"use client";

import { useEffect, useState } from "react";
import { workflowsApi, streamWorkflow, type Workflow } from "@/lib/gateway";
import { TopNav } from "@/components/TopNav";

type NodeState = "idle" | "running" | "done";

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [selected, setSelected] = useState<Workflow | null>(null);
  const [input, setInput] = useState("XRP market structure");
  const [busy, setBusy] = useState(false);
  const [nodeStates, setNodeStates] = useState<Record<string, NodeState>>({});
  const [output, setOutput] = useState<Record<string, string>>({});
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    workflowsApi
      .list()
      .then((w) => {
        setWorkflows(w);
        setSelected((cur) => cur ?? w[0] ?? null);
        setOnline(true);
      })
      .catch(() => setOnline(false));
  }, []);

  async function run() {
    if (!selected || busy) return;
    setBusy(true);
    setNodeStates(Object.fromEntries(selected.graph.nodes.map((n) => [n.id, "idle"])));
    setOutput({});

    await streamWorkflow(selected.id, input, {
      onNodeStarted: ({ nodeId }) => setNodeStates((s) => ({ ...s, [nodeId]: "running" })),
      onNodeToken: ({ nodeId, delta }) => setOutput((o) => ({ ...o, [nodeId]: (o[nodeId] ?? "") + delta })),
      onNodeCompleted: ({ nodeId, output: out }) => {
        setNodeStates((s) => ({ ...s, [nodeId]: "done" }));
        setOutput((o) => ({ ...o, [nodeId]: out }));
      },
      onError: (e) => setOutput((o) => ({ ...o, _error: e.message })),
    });
    setBusy(false);
  }

  return (
    <div className="flex h-screen flex-col">
      <TopNav
        right={
          <span>
            gateway <span className={online === false ? "text-danger" : online ? "text-ok" : "text-muted"}>{online === false ? "offline" : online ? "online" : "…"}</span>
          </span>
        }
      />
      <div className="flex flex-1 overflow-hidden">
        {/* workflow list */}
        <aside className="w-64 shrink-0 space-y-1 overflow-y-auto border-r border-border bg-panel p-2">
          <div className="px-2 py-2 text-[10px] uppercase tracking-widest text-muted">Workflows</div>
          {workflows.map((w) => (
            <button
              key={w.id}
              onClick={() => setSelected(w)}
              className={`block w-full rounded-lg border px-3 py-2 text-left text-sm transition ${
                selected?.id === w.id ? "border-accent/50 bg-elevated text-white" : "border-transparent text-muted hover:bg-elevated"
              }`}
            >
              {w.name}
              <span className="block font-mono text-[11px] text-muted">{w.graph.nodes.length} nodes</span>
            </button>
          ))}
        </aside>

        {/* graph + run */}
        <main className="flex flex-1 flex-col overflow-hidden">
          <div className="flex items-center gap-3 border-b border-border bg-panel px-5 py-3">
            <h1 className="text-sm font-semibold text-white">{selected?.name ?? "—"}</h1>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="workflow input"
              className="flex-1 rounded-lg border border-border bg-base px-3 py-1.5 text-sm text-white outline-none focus:border-accent/60"
            />
            <button
              onClick={() => void run()}
              disabled={!selected || busy}
              className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-base transition hover:opacity-90 disabled:opacity-40"
            >
              {busy ? "Running…" : "Run"}
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-5">
            {selected?.graph.nodes.map((n, i) => {
              const st = nodeStates[n.id] ?? "idle";
              return (
                <div key={n.id}>
                  {i > 0 && <div className="ml-4 h-3 w-px bg-border" />}
                  <div
                    className={`rounded-xl border bg-panel p-4 transition ${
                      st === "running" ? "border-accent" : st === "done" ? "border-ok/40" : "border-border"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2 text-sm font-medium text-white">
                        <span
                          className={`inline-block h-2.5 w-2.5 rounded-full ${
                            st === "running" ? "animate-pulse bg-accent" : st === "done" ? "bg-ok" : "bg-border"
                          }`}
                        />
                        {n.id}
                      </span>
                      <span className="rounded bg-elevated px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted">
                        {n.type}
                        {n.type === "agent" ? ` · ${n.agentId}` : ` · ${n.connectorId}/${n.tool}`}
                      </span>
                    </div>
                    {output[n.id] && (
                      <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-base p-2 font-mono text-[11px] leading-relaxed text-muted">
                        {output[n.id]}
                      </pre>
                    )}
                  </div>
                </div>
              );
            })}
            {output._error && <div className="rounded-lg border border-danger/50 bg-base p-3 text-sm text-danger">⚠️ {output._error}</div>}
            {!selected && <div className="mt-20 text-center text-sm text-muted">No workflows.</div>}
          </div>
        </main>
      </div>
    </div>
  );
}
