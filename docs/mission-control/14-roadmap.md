# 14 — Roadmap

A phased path from this blueprint to the full platform. Each phase is independently shippable and demoable. Estimates assume a small senior team; sequence matters more than the numbers.

## Phase 0 — Monorepo foundation
Stand up the structure from [02](./02-monorepo-structure.md).
- pnpm + Turborepo; `packages/types` (zod schemas) as the contract hub.
- `packages/db` with Drizzle schema ([03](./03-database-schema.md)) + first migration.
- `infra/docker` compose: Postgres, Redis, Qdrant, Ollama.
- Clerk auth wired into a bare `apps/gateway` (Fastify) + `apps/web` (Next.js) shell.
- **Exit:** can log in, create a workspace, see an empty Mission view.

## Phase 1 — Provider layer + single-agent chat (vertical slice)
The first end-to-end value.
- `packages/providers`: contract + OpenAI-compatible base + Anthropic + Ollama adapters.
- Credentials (envelope-encrypted) + models registry + `/v1/models/:id/test`.
- One agent, one conversation, **SSE streaming chat** ([09](./09-streaming-websockets.md)), `usage_events` + cost ([11](./11-observability-cost.md)).
- Chat console UI ([12](./12-ui-ux.md#2-global-chat-console)).
- **Exit:** stream a real reply from a configured agent; see live token cost.

## Phase 2 — Tools via MCP + agent loop
- `packages/mcp-connectors` client framework + connector registry ([08](./08-mcp-integration.md)).
- Repackage this repo's TradingView MCP as `packages/tradingview-mcp`; register it as the first connector.
- Tool-calling agent loop + HITL approvals ([06](./06-agent-lifecycle.md)).
- Add remaining provider adapters (Gemini, OpenRouter, Groq, Together, HF).
- **Exit:** a Trading Agent reads chart data and proposes a gated `replay_trade` an operator approves.

## Phase 3 — Realtime mission control + observability
- WS workspace bus + live agent grid + presence ([09](./09-streaming-websockets.md), [12](./12-ui-ux.md#1-mission-live-agent-grid)).
- OpenTelemetry traces/metrics/logs + in-app Observability & Infra panels ([11](./11-observability-cost.md)).
- Provider routing, failover, circuit breakers ([05](./05-provider-abstraction.md#registry-routing--failover)).
- **Exit:** watch all agents live; drill into a run's trace; see provider health flip on failure.

## Phase 4 — Memory & RAG
- `apps/rag` (FastAPI) + Qdrant; ingest pipeline + embeddings status ([10](./10-memory-rag.md)).
- Long-term agent memory + memory viewer.
- **Exit:** upload docs, ask an agent, see cited retrieved chunks in the memory viewer.

## Phase 5 — Workflows & multi-agent
- Workflow engine (durable, BullMQ) + DAG builder UI ([07](./07-orchestration-multiagent.md), [12](./12-ui-ux.md#3-workflow-builder)).
- Triggers (manual/cron/event/webhook); multi-agent conversations + handoff/supervisor.
- **Exit:** scheduled multi-agent "Trade Idea" workflow runs end-to-end with a human gate.

## Phase 6 — Hardening & scale
- RBAC roles + audit log UI; rate limiting; budgets/alerts.
- K8s Helm chart, HPA, read replicas, `usage_events` partitioning.
- Cost optimization (caching, routing policies), graceful degradation paths.
- **Exit:** multi-tenant, multi-user, horizontally scaled, with SLOs + dashboards.

## Continuous (every phase)
- Tests per package (vitest/pytest) + e2e on critical paths.
- Security review of new boundaries (secrets, tool sandboxing, tenant isolation).
- Keep `packages/types` the single source of truth; generate the SDK from it.

## Suggested first build after this blueprint
Per the scope discussion, the natural next deliverable is **Phase 0 + Phase 1** — the monorepo foundation plus a working streaming-chat vertical slice against one or two real providers. That proves the architecture before breadth is added.
