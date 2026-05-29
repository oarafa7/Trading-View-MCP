# Implementation Status

Maps the [blueprint](./README.md) to what's actually built in [`/mission-control`](../../mission-control/). Phases refer to the [roadmap](./14-roadmap.md).

## Built & verified (Phases 0–5)

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
| Workflow engine (multi-agent) | [07](./07-orchestration-multiagent.md) | `agent-core/workflow.ts` `WorkflowEngine` — graph of agent/tool nodes, state threading via `{{node}}` templates, conditional edges | unit tests; live SSE run (agent→tool→agent) |
| Memory + RAG | [10](./10-memory-rag.md) | `packages/memory` — chunking, embeddings, vector store, `MemoryService`; retrieval injected into agent runs (`retrieval` event) | unit tests; live ingest/search + retrieval in chat |
| Auth + RBAC | [13](./13-security-deployment-scaling.md#rbac) | `packages/auth` — roles (owner/admin/operator/viewer), permission matrix, pluggable `AuthProvider` (DevAuthProvider); gateway preHandler + per-route permission guards + `/v1/me` | unit tests; live (viewer→403, operator runs but can't author agents, owner default) |
| Token + cost / observability data | [11](./11-observability-cost.md) | `usage_events` + rollups + `/v1/connectors` health | live rollups, Mission panels |
| Mission Control UI | [12](./12-ui-ux.md) | `apps/web` — Chat (stream + tool chips + approvals + retrieval), live **Mission**, **Workflows**, and **Knowledge** (ingest + RAG playground) views | `next build`; all routes serve 200 |

Test/typecheck snapshot: **24 tests across 6 suites**, all 8 packages typecheck, web builds.

## Substituted for the slice (documented, swappable)

| Blueprint target | Current slice | Swap path |
|------------------|--------------|-----------|
| PostgreSQL + Drizzle ([03](./03-database-schema.md)) | in-memory `MemoryStore` mirroring the repository surface | implement the same methods over Drizzle |
| Redis Streams fan-out ([01](./01-system-architecture.md#event-driven-core)) | in-process `Realtime` broadcaster | back `publish()` with Redis to span replicas |
| Clerk identity ([13](./13-security-deployment-scaling.md#rbac)) | `DevAuthProvider` (bearer→role); RBAC fully enforced | implement `ClerkAuthProvider.authenticate()` (verify Clerk JWT → map org role to RoleName); RBAC layer is unchanged |
| Qdrant + provider embeddings ([10](./10-memory-rag.md)) | in-memory vector store + local feature-hashing embeddings | point `MemoryService` at Qdrant; swap `embed` for a provider `embed()` call |
| Encrypted secret store ([13](./13-security-deployment-scaling.md#secrets)) | provider keys from env | envelope-encrypted `provider_credentials` |
| BullMQ workers ([07](./07-orchestration-multiagent.md)) | runs execute in-request | move long runs to workers |

## Not yet started

- Production data plumbing: PostgreSQL + Drizzle, Qdrant, BullMQ workers (interfaces exist; see the substitution table above). RBAC is built; only the Clerk identity provider is pending.
- Drag-and-drop workflow builder UI + triggers/parallel/router nodes ([12](./12-ui-ux.md#3-workflow-builder)) — the engine + a run view exist; authoring is still JSON-seeded
- OpenTelemetry traces/metrics export ([11](./11-observability-cost.md))
- K8s/Helm deployment ([13](./13-security-deployment-scaling.md#deployment))

## Run it

See [`mission-control/README.md`](../../mission-control/README.md). Works with zero config via the offline `mock` model; add provider keys to use real models.
