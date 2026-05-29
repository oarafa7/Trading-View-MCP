"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { api, streamMessage, decideApproval, type Agent, type Model, type ChatMessage } from "@/lib/gateway";
import { StatusDot } from "@/components/StatusDot";
import { TopNav } from "@/components/TopNav";

interface ToolActivity {
  toolCallId: string;
  name: string;
  status: "called" | "awaiting" | "done" | "denied";
  runId?: string;
}

export default function MissionControl() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [convId, setConvId] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [live, setLive] = useState<string>("");
  const [activity, setActivity] = useState<ToolActivity[]>([]);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [totalCost, setTotalCost] = useState(0);
  const [online, setOnline] = useState<boolean | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const modelName = useCallback(
    (id: string) => models.find((m) => m.id === id)?.displayName ?? id,
    [models],
  );

  const refresh = useCallback(async () => {
    try {
      const [a, m, u] = await Promise.all([api.agents(), api.models(), api.usage("agent")]);
      setAgents(a);
      setModels(m);
      setTotalCost(u.totalCostUsd);
      setOnline(true);
      setActiveId((cur) => cur || a[0]?.id || "");
    } catch {
      setOnline(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, live]);

  const active = agents.find((a) => a.id === activeId);

  async function send() {
    const text = input.trim();
    if (!text || !active || busy) return;
    setBusy(true);
    setInput("");

    // ensure a conversation exists for this agent
    let cid = convId;
    if (!cid) {
      const conv = await api.createConversation([active.id], `${active.name} session`);
      cid = conv.id;
      setConvId(cid);
    }

    setMessages((prev) => [...prev, { id: `local_${Date.now()}`, role: "user", content: text }]);
    setLive("");
    setActivity([]);
    setAgents((prev) => prev.map((a) => (a.id === active.id ? { ...a, status: "running" } : a)));

    const upsert = (item: ToolActivity) =>
      setActivity((prev) => {
        const i = prev.findIndex((x) => x.toolCallId === item.toolCallId);
        if (i === -1) return [...prev, item];
        const next = [...prev];
        next[i] = { ...next[i], ...item };
        return next;
      });

    let acc = "";
    await streamMessage(cid, text, active.id, {
      onToken: (d) => {
        acc += d;
        setLive(acc);
      },
      onToolCallDone: ({ id, name }) => upsert({ toolCallId: id, name, status: "called" }),
      onAwaitingApproval: ({ runId, toolCallId, name }) => upsert({ toolCallId, name, status: "awaiting", runId }),
      onToolResult: ({ toolCallId, name, ok }) => upsert({ toolCallId, name, status: ok ? "done" : "denied" }),
      onUsage: (u) => setTotalCost((c) => Math.round((c + u.costUsd) * 1e6) / 1e6),
      onError: (e) => {
        acc += `\n\n⚠️ ${e.code}: ${e.message}`;
        setLive(acc);
      },
      onDone: () => {},
    });

    setMessages((prev) => [...prev, { id: `a_${Date.now()}`, role: "assistant", content: acc, agentId: active.id }]);
    setLive("");
    setActivity([]);
    setBusy(false);
    setAgents((prev) => prev.map((a) => (a.id === active.id ? { ...a, status: "idle" } : a)));
    void refresh();
  }

  async function approve(item: ToolActivity, decision: "approve" | "reject") {
    if (!item.runId) return;
    setActivity((prev) =>
      prev.map((x) => (x.toolCallId === item.toolCallId ? { ...x, status: decision === "approve" ? "called" : "denied" } : x)),
    );
    await decideApproval(item.runId, item.toolCallId, decision);
  }

  function switchAgent(id: string) {
    if (id === activeId) return;
    setActiveId(id);
    setConvId("");
    setMessages([]);
    setLive("");
    setActivity([]);
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TopNav
        right={
          <span className="flex items-center gap-4">
            <span>
              gateway <span className={online === false ? "text-danger" : online ? "text-ok" : "text-muted"}>{online === false ? "offline" : online ? "online" : "…"}</span>
            </span>
            <span>
              spend <span className="text-accent">${totalCost.toFixed(4)}</span>
            </span>
          </span>
        }
      />
      <div className="flex flex-1 overflow-hidden">
      {/* Left rail — agent grid */}
      <aside className="flex w-72 flex-col border-r border-border bg-panel">
        <div className="px-4 py-3 text-[10px] uppercase tracking-widest text-muted">Agents</div>
        <div className="flex-1 space-y-1 overflow-y-auto px-2 pb-4">
          {agents.map((a) => (
            <button
              key={a.id}
              onClick={() => switchAgent(a.id)}
              className={`flex w-full flex-col gap-1 rounded-lg border px-3 py-2 text-left transition ${
                a.id === activeId ? "border-accent/50 bg-elevated" : "border-transparent hover:bg-elevated"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-medium text-white">
                  <StatusDot status={a.status} />
                  {a.name}
                </span>
                <span className="rounded bg-base px-1.5 py-0.5 text-[10px] uppercase text-muted">{a.kind}</span>
              </div>
              <div className="flex items-center justify-between font-mono text-[11px] text-muted">
                <span>{modelName(a.modelId)}</span>
                <span>${a.costToDate.toFixed(4)}</span>
              </div>
            </button>
          ))}
          {agents.length === 0 && <div className="px-3 py-6 text-center text-xs text-muted">No agents</div>}
        </div>
      </aside>

      {/* Main */}
      <main className="flex flex-1 flex-col">
        {/* Active-agent context bar */}
        <header className="flex items-center gap-3 border-b border-border bg-panel px-5 py-3">
          {active && <StatusDot status={active.status} />}
          <h1 className="text-sm font-semibold text-white">{active ? active.name : "—"}</h1>
          {active && <span className="font-mono text-xs text-muted">{modelName(active.modelId)}</span>}
        </header>

        {/* Chat */}
        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-6 py-6">
          {messages.length === 0 && !live && (
            <div className="mx-auto mt-20 max-w-md text-center text-sm text-muted">
              {online === false ? (
                <>Gateway not reachable. Start it with <code className="text-accent">pnpm --filter @mc/gateway dev</code>.</>
              ) : (
                <>Talk to <span className="text-white">{active?.name ?? "an agent"}</span>. The Mission Assistant streams with no API key.</>
              )}
            </div>
          )}
          {messages.map((m) => (
            <Bubble key={m.id} role={m.role} text={m.content} />
          ))}
          {activity.length > 0 && (
            <div className="space-y-2">
              {activity.map((t) => (
                <ToolChip key={t.toolCallId} item={t} onDecide={approve} />
              ))}
            </div>
          )}
          {live && <Bubble role="assistant" text={live} streaming />}
        </div>

        {/* Composer */}
        <div className="border-t border-border bg-panel px-6 py-4">
          <div className="flex items-end gap-3">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={1}
              placeholder={active ? `Message ${active.name}…` : "Select an agent"}
              disabled={!active || busy}
              className="max-h-40 flex-1 resize-none rounded-lg border border-border bg-base px-3 py-2 text-sm text-white outline-none placeholder:text-muted focus:border-accent/60 disabled:opacity-50"
            />
            <button
              onClick={() => void send()}
              disabled={!active || busy || !input.trim()}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-base transition hover:opacity-90 disabled:opacity-40"
            >
              {busy ? "…" : "Send"}
            </button>
          </div>
        </div>
      </main>
      </div>
    </div>
  );
}

function ToolChip({ item, onDecide }: { item: ToolActivity; onDecide: (i: ToolActivity, d: "approve" | "reject") => void }) {
  const label: Record<ToolActivity["status"], string> = {
    called: "called",
    awaiting: "awaiting approval",
    done: "completed",
    denied: "denied",
  };
  const tone: Record<ToolActivity["status"], string> = {
    called: "text-accent",
    awaiting: "text-amber",
    done: "text-ok",
    denied: "text-danger",
  };
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-base px-3 py-2 font-mono text-xs">
      <span>
        <span className="text-muted">tool</span> <span className="text-white">{item.name}</span>{" "}
        <span className={tone[item.status]}>· {label[item.status]}</span>
      </span>
      {item.status === "awaiting" && (
        <span className="flex gap-2">
          <button onClick={() => onDecide(item, "approve")} className="rounded bg-ok px-2 py-0.5 text-base">
            Approve
          </button>
          <button onClick={() => onDecide(item, "reject")} className="rounded bg-danger px-2 py-0.5 text-white">
            Reject
          </button>
        </span>
      )}
    </div>
  );
}

function Bubble({ role, text, streaming }: { role: string; text: string; streaming?: boolean }) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser ? "bg-accent text-base" : "border border-border bg-elevated text-white"
        }`}
      >
        {text}
        {streaming && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-accent align-middle" />}
      </div>
    </div>
  );
}
