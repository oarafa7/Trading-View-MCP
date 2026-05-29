# Mission Control — Monorepo

Implementation of the [AI Mission Control architecture blueprint](../docs/mission-control/). Covers the monorepo foundation, a streaming-chat slice across multiple LLM providers, the **MCP connector framework + tool-calling loop with human-in-the-loop approvals**, **realtime monitoring** (live Mission view over WebSocket), a **multi-agent workflow engine**, a **memory/RAG layer**, **auth + RBAC**, and **SQLite/Drizzle persistence** (state survives restarts).

See [IMPLEMENTATION-STATUS.md](../docs/mission-control/IMPLEMENTATION-STATUS.md) for a blueprint-vs-built map.

> Lives in its own directory so it coexists with the existing TradingView MCP without breaking it. A later phase hoists it to the repo root and absorbs the TradingView MCP as `packages/tradingview-mcp`.

## What works today

- **Provider abstraction layer** (`packages/providers`) with a unified streaming contract and adapters for **OpenAI / Groq / OpenRouter / Together** (one OpenAI-compatible base), **Anthropic**, **Ollama** (local), and a **mock** provider for offline use. Normalized stream events, token counting, cost computation, shared error taxonomy.
- **Agent runtime** (`packages/agent-core`) that runs an agent turn, drives the **tool-calling loop** (with HITL approval gates and an iteration cap), and emits normalized events + usage/cost events.
- **MCP connector framework** (`packages/mcp-connectors`): uniform client over MCP servers — a `stdio` transport (any MCP server, including this repo's TradingView MCP) plus in-process `builtin` connectors. A `ConnectorManager` connects, discovers tools, routes calls, and reports health (failures isolated per connector).
- **Gateway** (`apps/gateway`, Fastify): REST for agents/models/conversations/connectors + **SSE streaming chat** at `POST /v1/conversations/:id/messages`, **HITL approvals** at `POST /v1/runs/:runId/approvals/:toolCallId`, usage rollups. RBAC-guarded; backed by SQLite (see Persistence below).
- **Realtime monitoring** (`apps/gateway` `GET /v1/realtime`, WebSocket): broadcasts `agent.status_changed`, `run.started/completed`, and `usage.recorded` to subscribed dashboards (in-process broadcaster; the Redis-backed swap is documented).
- **Workflow engine** (`packages/agent-core` `WorkflowEngine`): executes a graph of agent/tool nodes, threading each node's output into later prompts via `{{nodeId}}` templates, with conditional edges. Gateway runs them at `POST /v1/workflows/:id/run` (SSE, node-level progress) and broadcasts `workflow.*` events.
- **Memory / RAG** (`packages/memory`): chunking + local feature-hashing embeddings + an in-memory cosine vector store behind a `MemoryService`. Agents with long-term memory get relevant chunks retrieved and injected into context (emitting a `retrieval` event). Gateway: `GET/POST /v1/knowledge`, `POST /v1/knowledge/search`. (Swap the embedder for a provider `embed()` and the store for Qdrant in production.)
- **Auth + RBAC** (`packages/auth`): roles (owner/admin/operator/viewer) with a permission matrix and a pluggable `AuthProvider` (`DevAuthProvider` maps `dev-<role>` bearer tokens to roles). The gateway resolves a principal per request and guards mutating routes; `GET /v1/me` returns the caller. Zero-config stays open (no token → owner in dev); set `AUTH_REQUIRED=true` to enforce. Swap in a `ClerkAuthProvider` for production — the RBAC layer is unchanged.
- **Persistence** (`packages/db`): Drizzle schema + SQLite (`better-sqlite3`, synchronous). The gateway store is a write-through cache — agents, conversations, messages, and usage events are loaded on boot and persisted on every write, so **state survives restarts**. Same Drizzle schema runs on Postgres (swap `sqlite-core` for `pg-core`). DB path via `DB_PATH` (default `mc.db`).
- **Web** (`apps/web`, Next.js): four views — **Chat** (live stream, tool-call chips, Approve/Reject, retrieval chip), live **Mission** (agent grid, KPIs, connector health, cost-by-model) over WebSocket, **Workflows** (graph + live per-node progress), and **Knowledge** (document ingest + RAG retrieval playground).

## Quick start (one command)

```bash
cd mission-control
pnpm install
pnpm dev                 # builds packages, then starts gateway (:4000) + web (:3000)
# open http://localhost:3000
```

`pnpm dev` runs both apps together (it builds the workspace packages first via Turborepo).
Prefer separate terminals? Use `pnpm dev:gateway` and `pnpm dev:web`.

**Works with zero config** via the offline `mock` model and a default owner principal — no API keys needed. To use real models, copy `.env.example` to `.env` and set the provider keys you have (the seeded agents map to GPT-4o, Claude 3.5 Sonnet, and Llama 3.1/Ollama; the **Mission Assistant** uses the mock model so it always streams).

## Test it (5-minute tour)

Open http://localhost:3000 and:

1. **Chat** — message the **Mission Assistant**. Try `summarize our risk policy` (watch the 🔎 retrieval chip — that's RAG), `please call get_time` (a tool runs), or `please send_notification hi` (a gated tool → **Approve/Reject** appears).
2. **Mission** — live agent grid, spend ticker, connector health, and cost-by-model, updating over WebSocket as you chat in another tab.
3. **Workflows** — run **Daily Brief**; watch nodes light up (agent → tool → agent) with streamed output.
4. **Knowledge** — add a document, then use the **retrieval playground** to see ranked chunks.
5. **Role switcher** (top-right) — switch to `viewer` and notice writes are blocked (RBAC); `owner`/`operator` can act.
6. **Persistence** — restart the gateway; your conversations, agents, and usage are still there.

Run `pnpm test` for the unit suite (28 tests).

## Deploy (get a public URL)

The app is packaged as a **single Docker container** that serves the UI, REST API, SSE, and
WebSocket on one port (the web UI is built as a same-origin static export and served by the
gateway). So any container host gives you one public URL for the whole thing.

**Render (one blueprint, free tier)** — a [`render.yaml`](../render.yaml) is included:
1. Push this branch to GitHub (done).
2. In Render → **New → Blueprint** → connect this repo → it reads `render.yaml` → **Apply**.
3. Render builds `mission-control/Dockerfile` and gives you `https://<name>.onrender.com`.
4. (Optional) add provider keys (`OPENAI_API_KEY`, …) in the dashboard for real models — the
   offline `mock` model works with none.

**Run the production container locally:**
```bash
cd mission-control
docker build -t mission-control -f Dockerfile .
docker run -p 4000:4000 -e PORT=4000 mission-control
# open http://localhost:4000
```

**Other hosts:** the same Dockerfile deploys to Railway (`railway up`), Fly (`fly launch`),
or Google Cloud Run. They inject `PORT`; the gateway honors it. For durable data across
redeploys, mount a volume and point `DB_PATH` at it (SQLite); otherwise data is ephemeral.

> Vercel note: Vercel hosts the static UI fine, but the gateway needs a long-lived process
> (WebSocket + SQLite + MCP child processes), so deploy the **container** to a process host
> rather than splitting them.

## Try the API directly

```bash
curl -s localhost:4000/v1/health
CID=$(curl -s -X POST localhost:4000/v1/conversations -d '{}' -H 'content-type: application/json' | jq -r .id)
curl -sN -X POST localhost:4000/v1/conversations/$CID/messages \
  -H 'content-type: application/json' -d '{"content":"hello mission control"}'
curl -s "localhost:4000/v1/usage?groupBy=agent"
```

## Layout

```
packages/types          zod schemas — the shared contract hub
packages/providers      provider abstraction layer + adapters
packages/agent-core     agent runtime, tool loop, workflow engine
packages/mcp-connectors MCP connector framework (stdio + builtin)
packages/memory         chunking, embeddings, vector store, RAG
packages/auth           roles, permissions, pluggable auth provider
packages/db             Drizzle schema + SQLite repository (persistence)
apps/gateway            Fastify REST + SSE + WebSocket + RBAC + persistence
apps/web                Next.js Mission Control UI (Chat/Mission/Workflows/Knowledge)
```

## Scripts

- `pnpm -r build` — build all packages
- `pnpm test` / `./node_modules/.bin/vitest run` — run tests
- `pnpm typecheck` — typecheck all
- `pnpm --filter @mc/gateway dev` — run the gateway with reload

## Tools & HITL demo (no keys needed)

The **Mission Assistant** is granted the builtin `Utility` connector's tools. The mock model triggers a tool call when you name a tool:

```bash
CID=$(curl -s -X POST localhost:4000/v1/conversations -d '{}' -H 'content-type: application/json' | jq -r .id)
# auto-approved tool
curl -sN -X POST localhost:4000/v1/conversations/$CID/messages -H 'content-type: application/json' \
  -d '{"content":"please call get_time"}'
# HITL: this streams an awaiting_approval event; approve it from another shell:
#   curl -X POST localhost:4000/v1/runs/<runId>/approvals/<toolCallId> -d '{"decision":"approve"}' -H 'content-type: application/json'
curl -sN -X POST localhost:4000/v1/conversations/$CID/messages -H 'content-type: application/json' \
  -d '{"content":"please send_notification hello team"}'
curl -s localhost:4000/v1/connectors   # connector health + discovered tools
```

The TradingView MCP from this repo is registered as `conn_tradingview` (stdio). It connects if its server can start; otherwise it reports `down` — the manager isolates the failure.

## Not yet implemented (next phases)

Remaining infra swaps — Postgres (currently SQLite via the same Drizzle schema), Qdrant (currently in-memory vectors), the Clerk identity provider (RBAC is built), BullMQ workers — plus a drag-and-drop workflow builder, OpenTelemetry export, and K8s/Helm. The runtime interfaces already exist; see [IMPLEMENTATION-STATUS](../docs/mission-control/IMPLEMENTATION-STATUS.md) for the swap paths and the [roadmap](../docs/mission-control/14-roadmap.md).
