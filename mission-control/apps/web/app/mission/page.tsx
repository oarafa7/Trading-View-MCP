"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { api, type Agent, type Model, type ConnectorHealth, type UsageRollup } from "@/lib/gateway";
import { openRealtime } from "@/lib/realtime";
import { TopNav } from "@/components/TopNav";
import { StatusDot } from "@/components/StatusDot";

export default function MissionPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [connectors, setConnectors] = useState<ConnectorHealth[]>([]);
  const [usageByModel, setUsageByModel] = useState<UsageRollup | null>(null);
  const [totalCost, setTotalCost] = useState(0);
  const [activeRuns, setActiveRuns] = useState(0);
  const [online, setOnline] = useState<boolean | null>(null);
  const [pulse, setPulse] = useState(0); // bumps on each live event for a subtle activity feel
  const usageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const modelName = useCallback((id: string) => models.find((m) => m.id === id)?.displayName ?? id, [models]);

  const loadUsage = useCallback(async () => {
    const u = await api.usage("model");
    setUsageByModel(u);
    setTotalCost(u.totalCostUsd);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [a, m, c] = await Promise.all([api.agents(), api.models(), api.connectors()]);
      setAgents(a);
      setModels(m);
      setConnectors(c);
      setOnline(true);
      await loadUsage();
    } catch {
      setOnline(false);
    }
  }, [loadUsage]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Live workspace state over WebSocket.
  useEffect(() => {
    return openRealtime(["agents", "runs", "usage", "connectors"], (ev) => {
      setPulse((p) => p + 1);
      if (ev.type === "agent.status_changed") {
        setAgents((prev) =>
          prev.map((a) => (a.id === ev.data.agentId ? { ...a, status: ev.data.status, costToDate: ev.data.costToDate ?? a.costToDate } : a)),
        );
      } else if (ev.type === "run.started") {
        setActiveRuns((n) => n + 1);
      } else if (ev.type === "run.completed") {
        setActiveRuns((n) => Math.max(0, n - 1));
      } else if (ev.type === "usage.recorded") {
        // debounce a rollup refetch
        if (usageTimer.current) clearTimeout(usageTimer.current);
        usageTimer.current = setTimeout(() => void loadUsage(), 250);
      }
    });
  }, [loadUsage]);

  return (
    <div className="flex h-screen flex-col">
      <TopNav
        right={
          <span className="flex items-center gap-4">
            <span>
              gateway <span className={online === false ? "text-danger" : online ? "text-ok" : "text-muted"}>{online === false ? "offline" : online ? "online" : "…"}</span>
            </span>
            <span>
              live <span className="text-accent">●</span> {pulse}
            </span>
          </span>
        }
      />

      <div className="grid flex-1 grid-cols-3 gap-4 overflow-auto p-4">
        {/* KPIs + agent grid */}
        <section className="col-span-2 space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <Kpi label="Total spend" value={`$${totalCost.toFixed(4)}`} accent />
            <Kpi label="Active runs" value={String(activeRuns)} />
            <Kpi label="Agents" value={String(agents.length)} />
          </div>

          <Panel title="Agents">
            <div className="grid grid-cols-2 gap-3">
              {agents.map((a) => (
                <div key={a.id} className="rounded-lg border border-border bg-base p-3">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-sm font-medium text-white">
                      <StatusDot status={a.status} /> {a.name}
                    </span>
                    <span className="rounded bg-elevated px-1.5 py-0.5 text-[10px] uppercase text-muted">{a.kind}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between font-mono text-[11px] text-muted">
                    <span>{modelName(a.modelId)}</span>
                    <span>${a.costToDate.toFixed(4)}</span>
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-muted">
                    status <span className="text-white">{a.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </section>

        {/* Right column: connectors + cost by model */}
        <section className="space-y-4">
          <Panel title="Connectors">
            <div className="space-y-2">
              {connectors.map((c) => (
                <div key={c.id} className="rounded-lg border border-border bg-base p-3 font-mono text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-white">{c.name}</span>
                    <span className={c.status === "ok" ? "text-ok" : c.status === "degraded" ? "text-amber" : "text-danger"}>
                      ● {c.status}
                    </span>
                  </div>
                  <div className="mt-1 text-muted">{c.toolCount} tools{c.tools.length ? `: ${c.tools.slice(0, 4).join(", ")}${c.tools.length > 4 ? "…" : ""}` : ""}</div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Cost by model">
            <div className="space-y-2">
              {usageByModel && usageByModel.buckets.length > 0 ? (
                usageByModel.buckets.map((b) => {
                  const pct = usageByModel.totalCostUsd > 0 ? (b.costUsd / usageByModel.totalCostUsd) * 100 : 0;
                  return (
                    <div key={b.key} className="font-mono text-xs">
                      <div className="flex justify-between text-muted">
                        <span className="text-white">{b.key}</span>
                        <span>${b.costUsd.toFixed(4)} · {b.calls} calls</span>
                      </div>
                      <div className="mt-1 h-1.5 w-full rounded bg-base">
                        <div className="h-1.5 rounded bg-accent" style={{ width: `${Math.max(2, pct)}%` }} />
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="text-xs text-muted">No usage yet — chat with an agent to populate.</div>
              )}
            </div>
          </Panel>
        </section>
      </div>
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-panel p-4">
      <div className="text-[10px] uppercase tracking-widest text-muted">{label}</div>
      <div className={`mt-1 font-mono text-2xl ${accent ? "text-accent" : "text-white"}`}>{value}</div>
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
