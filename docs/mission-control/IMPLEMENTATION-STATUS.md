# Implementation Status

Maps the [blueprint](./README.md) to what's actually built in [`/mission-control`](../../mission-control/). Phases refer to the [roadmap](./14-roadmap.md).

## Built & verified (Phases 0–3)

| Capability | Blueprint | Where | Verification |
|-----------|-----------|-------|-------------|
| Monorepo foundation | [02](./02-monorepo-structure.md) | `mission-control/` (pnpm + Turborepo) | builds, typechecks |
| Shared type contract | [02](./02-monorepo-structure.md) | `packages/types` (zod) | typecheck |
| Provider abstraction + adapters | [05](./05-provider-abstraction.md) | `packages/providers` — OpenAI-compatible (OpenAI/Groq/OpenRouter/Together), Anthropic, Ollama, mock | unit tests (streaming, cost, registry) |
| Token + cost accounting | [11](./11-observability-cost.md#token--cost-accounting) | `providers/cost.ts` + `usage_events` | unit tests; live usage rollups |
| Agent runtime + lifecycle | [06](./06-agent-lifecycle.md) | `packages/agent-core` | unit tests; live SSE |
| Streaming responses (SSE) | [09](./09-streaming-websockets.md) | `apps/gateway` `POST /v1/conversations/:id/messages` | live curl: multi-token stream + usage + done |
| Tool-calling loop | [06](./06-agent-lifecycle.md), [07](./07-orchestration-multiagent.md) | `agent-core` runtime | unit tests; live tool loop via connector |
| Human-in-the-loop approvals | [06](./06-agent-lifecycle.md#human-in-the-loop-hitl) | gateway `POST /v1/runs/:runId/approvals/:toolCallId` | live: run paused on `awaiting_approval`, resumed after approval POST |
| MCP connector framework | [08](./08-mcp-integration.md) | `packages/mcp-connectors` (stdio + builtin), `ConnectorManager` | unit tests; live `/v1/connectors` |
| TradingView MCP as a connector | [08](./08-mcp-integration.md) | `conn_tradingview` (stdio) wired in gateway | registers; reports `down` here (no repo-root deps / no TV Desktop) — failure isolated |
| Realtime workspace state (WS) | [09](./09-streaming-websockets.md) | gateway `GET /v1/realtime` + `Realtime` broadcaster | live WS client received `agent.status_changed`, `run.*`, `usage.recorded` |
| Mission Control UI | [12](./12-ui-ux.md) | `apps/web` — Chat console (stream + tool chips + approvals) and live **Mission** view (agent grid, KPIs, connectors, cost-by-model) | `next build`; both routes serve 200 |

Test/typecheck snapshot: **12 tests across 3 suites**, all 6 packages typecheck, web builds.

## Substituted for the slice (documented, swappable)

| Blueprint target | Current slice | Swap path |
|------------------|--------------|-----------|
| PostgreSQL + Drizzle ([03](./03-database-schema.md)) | in-memory `MemoryStore` mirroring the repository surface | implement the same methods over Drizzle |
| Redis Streams fan-out ([01](./01-system-architecture.md#event-driven-core)) | in-process `Realtime` broadcaster | back `publish()` with Redis to span replicas |
| Clerk auth + RBAC ([13](./13-security-deployment-scaling.md#rbac)) | single default workspace, no auth | add Clerk middleware + permission checks |
| Encrypted secret store ([13](./13-security-deployment-scaling.md#secrets)) | provider keys from env | envelope-encrypted `provider_credentials` |
| BullMQ workers ([07](./07-orchestration-multiagent.md)) | runs execute in-request | move long runs to workers |

## Not yet started

- Workflow engine + DAG builder ([07](./07-orchestration-multiagent.md), [12](./12-ui-ux.md#3-workflow-builder)) — Phase 5
- Memory / RAG service ([10](./10-memory-rag.md)) — Phase 4
- OpenTelemetry traces/metrics export ([11](./11-observability-cost.md)) — Phase 6
- K8s/Helm deployment ([13](./13-security-deployment-scaling.md#deployment)) — Phase 6

## Run it

See [`mission-control/README.md`](../../mission-control/README.md). Works with zero config via the offline `mock` model; add provider keys to use real models.
