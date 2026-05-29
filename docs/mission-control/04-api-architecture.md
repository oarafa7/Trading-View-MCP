# 04 — API Architecture

Two surfaces: a **REST API** for CRUD + commands, and a **realtime API** (SSE for token streams, WS for live state). All under `/v1`. Auth via Clerk session/JWT; every request resolves to a `(user, workspace, permissions)` context.

## Conventions

- **Versioned** under `/v1`; breaking changes bump the prefix.
- **Resource-oriented** REST, plural nouns. Commands that aren't pure CRUD use a sub-path verb (`POST /runs/:id/approve`).
- **Idempotency:** mutating POSTs accept `Idempotency-Key` header; gateway dedupes via Redis for 24h.
- **Pagination:** cursor-based — `?limit=&cursor=`, response `{ data, nextCursor }`.
- **Filtering/sorting:** `?filter[status]=running&sort=-started_at`.
- **Rate limits:** token-bucket per workspace + per route class; headers `X-RateLimit-Limit/Remaining/Reset` (see [13](./13-security-deployment-scaling.md#rate-limiting)).
- **Tracing:** every response carries `X-Trace-Id`; client echoes it in bug reports.

## Error model (RFC 9457 problem+json)

```jsonc
{
  "type": "https://errors.mc.dev/provider_unavailable",
  "title": "Provider temporarily unavailable",
  "status": 503,
  "detail": "anthropic returned 529 after 3 retries; failed over to openai:gpt-4o",
  "code": "PROVIDER_UNAVAILABLE",
  "traceId": "...",
  "retryable": true
}
```

Stable `code` enum drives client handling. Error taxonomy is shared with the provider layer ([05](./05-provider-abstraction.md#error-taxonomy)).

## REST resource map

| Resource | Methods | Notes |
|----------|---------|-------|
| `/v1/workspaces` `/:id` | GET, PATCH | current tenant |
| `/v1/members` `/:id` | GET, POST, PATCH, DELETE | invites, role assignment |
| `/v1/roles` `/:id` | CRUD | RBAC definitions |
| `/v1/credentials` `/:id` | GET (masked), POST, PATCH, DELETE | secret write-only; never returns plaintext |
| `/v1/providers` | GET | static provider catalog + capabilities |
| `/v1/models` `/:id` | CRUD, `POST /:id/test` | register/enable models; test does a 1-token ping |
| `/v1/agents` `/:id` | CRUD | agent definitions |
| `/v1/agents/:id/tools` | GET, PUT | grant/revoke connector tools |
| `/v1/connectors` `/:id` | CRUD, `POST /:id/health`, `GET /:id/tools` | MCP connectors + capability discovery |
| `/v1/conversations` `/:id` | CRUD | chat threads (single or multi-agent) |
| `/v1/conversations/:id/messages` | GET, **POST (SSE)** | post message → stream response |
| `/v1/runs` `/:id` | GET, `POST /:id/cancel`, `POST /:id/approve`, `POST /:id/reject` | run control + HITL gates |
| `/v1/workflows` `/:id` | CRUD, `POST /:id/run` | DAG definitions + manual trigger |
| `/v1/workflow-runs` `/:id` | GET, `POST /:id/cancel` | executions |
| `/v1/tasks` `/:id` | CRUD, `POST /:id/assign` | assignable work items |
| `/v1/knowledge/sources` `/:id` | CRUD, `POST` upload | RAG ingest (multipart → object storage → ingest job) |
| `/v1/memory` | GET `?agentId=&scope=&q=` | memory viewer queries |
| `/v1/usage` | GET `?groupBy=agent|model|day&from=&to=` | cost/token rollups |
| `/v1/traces` `/:id` | GET | observability drill-down |
| `/v1/health` | GET | liveness/readiness; aggregates provider + connector health |

## Realtime API

### SSE — token streaming (per request)
`POST /v1/conversations/:id/messages` with `Accept: text/event-stream` returns a stream of normalized events:

```
event: token       data: {"delta":"Hel"}
event: tool_call   data: {"id":"tc_..","name":"data_get_ohlcv","args":{...}}
event: awaiting_approval data: {"toolCallId":"tc_.."}
event: tool_result data: {"id":"tc_..","ok":true}
event: usage       data: {"inputTokens":812,"outputTokens":230,"costUsd":0.0041}
event: done        data: {"runId":"run_..","status":"completed"}
event: error       data: {"code":"PROVIDER_UNAVAILABLE","retryable":true}
```

SSE is chosen for the **single-response token stream** (simple, proxy-friendly, auto-reconnect). See [09](./09-streaming-websockets.md).

### WebSocket — workspace live state (persistent)
`WSS /v1/realtime?workspace=ws_...` — a multiplexed channel for everything that isn't tied to one request:

- `agent.status_changed`, `run.started/completed/failed` (powers the live agent grid)
- `workflow.step_*` (workflow builder live view)
- `usage.recorded` (cost ticker)
- `connector.health_changed`, `provider.health_changed` (infra panel)
- `presence.*` (who's viewing what — multi-user)

Client subscribes to topics: `{ "op": "subscribe", "topics": ["agents", "workflows", "usage"] }`. The server is backed by the Redis Streams bus so any gateway replica serves any socket.

## Why this split

REST gives cacheable, idempotent, well-understood CRUD. SSE handles the high-frequency, unidirectional token stream of a single completion without WS overhead. WS handles bidirectional, long-lived, fan-out workspace state. Each tool is used where it's strongest rather than forcing one transport to do everything.
