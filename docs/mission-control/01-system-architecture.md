# 01 — System Architecture

## Runtime topology (C4 container view)

```mermaid
flowchart TB
  User((Operator)) -->|HTTPS / WSS| WEB[apps/web — Next.js]

  WEB -->|REST + SSE| GW[apps/gateway — Fastify]
  WEB -->|WSS realtime| GW

  subgraph GWcore["Gateway internals"]
    PROV[Provider Layer<br/>packages/providers]
    AGENT[Agent Runtime<br/>packages/agent-core]
    MCPC[MCP Client Pool<br/>packages/mcp-connectors]
    BUS[Event Bus + Workers<br/>BullMQ / Redis Streams]
  end
  GW --- PROV & AGENT & MCPC & BUS

  PROV -->|HTTPS| LLMS[(LLM Providers:<br/>OpenAI / Anthropic / Gemini /<br/>OpenRouter / Groq / Together / HF)]
  PROV -->|HTTP| OLLAMA[(Ollama / local GPUs)]

  MCPC -->|stdio / HTTP| CONN[(MCP Connectors:<br/>TradingView / GitHub / Slack /<br/>Notion / Gmail / Drive / FS / DB)]

  AGENT -->|embed/retrieve| RAG[apps/rag — FastAPI]
  RAG --> QDRANT[(Qdrant — vectors)]

  GW --> PG[(PostgreSQL)]
  GW --> REDIS[(Redis)]
  RAG --> PG

  OTEL[OpenTelemetry Collector] --- GW & RAG & WEB
  OTEL --> OBSV[(Traces/Metrics/Logs backend)]
```

## Layered view

```mermaid
flowchart LR
  subgraph L1[Presentation]
    A[Mission Control UI]
  end
  subgraph L2[Application / Gateway]
    B[REST API]
    C[Realtime: SSE + WS]
    D[Auth + RBAC middleware]
    E[Rate limit + idempotency]
  end
  subgraph L3[Domain]
    F[Agent Runtime + Orchestrator]
    G[Workflow Engine]
    H[Provider Abstraction]
    I[MCP Connector Manager]
    J[Memory/RAG client]
  end
  subgraph L4[Infrastructure]
    K[(Postgres)]
    M[(Redis)]
    N[(Qdrant)]
    O[(Object storage)]
    P[(LLM/MCP externals)]
  end
  L1-->L2-->L3-->L4
```

## Request flow — "chat with an agent" (happy path)

```mermaid
sequenceDiagram
  participant UI
  participant GW as Gateway
  participant DB as Postgres
  participant AR as Agent Runtime
  participant PR as Provider Layer
  participant LLM as LLM Provider
  participant BUS as Event Bus

  UI->>GW: POST /v1/conversations/:id/messages (SSE)
  GW->>GW: authN (Clerk) + authZ (RBAC) + rate limit
  GW->>DB: persist user message
  GW->>AR: start run(agent, conversation)
  AR->>DB: load agent cfg + memory + tools
  AR->>PR: chat(unifiedRequest, stream=true)
  PR->>LLM: provider-native streaming call
  loop tokens
    LLM-->>PR: delta
    PR-->>AR: normalized StreamEvent(token)
    AR-->>GW: emit event
    GW-->>UI: SSE: token delta
  end
  alt tool call requested
    AR->>GW: tool_call event (maybe HITL gate)
    GW-->>UI: SSE: tool_call (await approval if gated)
    AR->>AR: execute via MCP client
    AR->>PR: continue with tool result
  end
  PR-->>AR: finish(usage)
  AR->>DB: persist assistant message + tool_calls
  AR->>BUS: publish usage_event + run.completed
  BUS->>DB: write usage_events, traces
  GW-->>UI: SSE: done(usage, cost)
```

## Event-driven core

Everything meaningful is an event published to **Redis Streams** (durable, replayable) and fanned out:

- **Producers:** agent runtime, workflow engine, provider layer, MCP manager.
- **Consumers:** WebSocket broadcaster (live UI), usage/cost writer, OTel trace exporter, audit logger, workflow trigger matcher.

```mermaid
flowchart LR
  subgraph Producers
    AR[Agent Runtime]
    WF[Workflow Engine]
    PR[Provider Layer]
    MC[MCP Manager]
  end
  AR & WF & PR & MC --> STREAM[(Redis Streams<br/>event bus)]
  STREAM --> WSB[WS Broadcaster] --> UI
  STREAM --> USAGE[Usage/Cost Writer] --> PG[(Postgres)]
  STREAM --> AUD[Audit Logger] --> PG
  STREAM --> OTELX[OTel Exporter] --> OBS[(Observability)]
  STREAM --> TRIG[Workflow Trigger Matcher] --> WF
```

### Canonical event envelope

```jsonc
{
  "id": "evt_01H...",            // ULID
  "type": "run.token",          // dot-namespaced, versioned via schema registry
  "ts": "2026-05-29T12:00:00Z",
  "workspaceId": "ws_...",
  "actor": { "kind": "agent", "id": "agt_..." },
  "subject": { "kind": "run", "id": "run_..." },
  "traceId": "...",             // ties to OpenTelemetry span
  "data": { /* type-specific payload */ }
}
```

Core event types: `run.started`, `run.token`, `run.tool_call`, `run.tool_result`, `run.awaiting_approval`, `run.completed`, `run.failed`, `agent.status_changed`, `workflow.step_started/completed`, `usage.recorded`, `connector.health_changed`, `provider.health_changed`.

## Concurrency & scaling stance

- **Gateway** and **web** are stateless → scale by replica count behind a load balancer.
- **Realtime fan-out** survives multi-replica because the WS broadcaster subscribes to the shared Redis Streams bus (any replica can serve any socket; sticky sessions optional, not required).
- **Heavy/long work** (full workflow runs, batch jobs, RAG ingest) runs in **BullMQ workers**, not request handlers, so request latency stays bounded.
- **Durable state only in backing stores** — no in-process session affinity required for correctness. See [13 — Scaling](./13-security-deployment-scaling.md#scaling).
