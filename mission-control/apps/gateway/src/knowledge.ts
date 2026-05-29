import type { MemoryService } from "@mc/memory";

/** Seed a few documents so retrieval works out of the box (and the offline mock agent has context). */
export function seedKnowledge(memory: MemoryService, workspaceId: string): void {
  memory.ingest(
    workspaceId,
    "Risk Policy",
    `Position sizing and risk management rules.

Risk at most 1% of account equity on any single trade. Always define a stop loss before entry.
Never average down into a losing position. Maximum portfolio heat is 5% across all open trades.
Reduce size by half after two consecutive losing days.`,
  );

  memory.ingest(
    workspaceId,
    "Mission Control Overview",
    `AI Mission Control is a control plane for AI agents. It connects multiple LLM providers behind a
unified interface, runs agents with tools via MCP connectors, supports human-in-the-loop approvals,
streams responses over SSE, broadcasts live state over WebSocket, and orchestrates multi-agent workflows.
The TradingView MCP is registered as one of its connectors.`,
  );

  memory.ingest(
    workspaceId,
    "XRP Trading Notes",
    `XRP tends to react strongly to regulatory headlines. Key intraday levels are watched around prior-day
high and low. Volume spikes on the 5-minute chart often precede breakouts. The scalper strategy uses
VWAP with a fast RSI and an 8-period EMA for entries.`,
  );
}
