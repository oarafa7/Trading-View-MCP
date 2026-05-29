# Mission Control — Monorepo

Implementation of the [AI Mission Control architecture blueprint](../docs/mission-control/). This is **Phase 0 + Phase 1** of the [roadmap](../docs/mission-control/14-roadmap.md): the monorepo foundation plus a working **streaming-chat vertical slice** across multiple LLM providers.

> Lives in its own directory so it coexists with the existing TradingView MCP without breaking it. A later phase hoists it to the repo root and absorbs the TradingView MCP as `packages/tradingview-mcp`.

## What works today

- **Provider abstraction layer** (`packages/providers`) with a unified streaming contract and adapters for **OpenAI / Groq / OpenRouter / Together** (one OpenAI-compatible base), **Anthropic**, **Ollama** (local), and a **mock** provider for offline use. Normalized stream events, token counting, cost computation, shared error taxonomy.
- **Agent runtime** (`packages/agent-core`) that runs an agent turn and emits normalized events + a usage/cost event.
- **Gateway** (`apps/gateway`, Fastify): REST for agents/models/conversations + **SSE streaming chat** at `POST /v1/conversations/:id/messages`, usage rollups. In-memory store (same surface the Postgres repo will implement).
- **Web** (`apps/web`, Next.js): dark-mode Mission Control chat console that streams responses live.

## Quick start

```bash
cd mission-control
pnpm install
pnpm -r build            # build the packages

# Terminal 1 — gateway (works with zero config via the "mock" model)
pnpm --filter @mc/gateway dev

# Terminal 2 — web
pnpm --filter @mc/web dev
# open http://localhost:3000
```

To use real models, copy `.env.example` to `.env` (or export vars) and set the provider keys you have. The seeded agents map to GPT-4o, Claude 3.5 Sonnet, and Llama 3.1 (Ollama); the **Mission Assistant** uses the mock model so it streams with no keys.

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
packages/types        zod schemas — the shared contract hub
packages/providers    provider abstraction layer + adapters
packages/agent-core   agent runtime, ids
apps/gateway          Fastify REST + SSE
apps/web              Next.js Mission Control UI
```

## Scripts

- `pnpm -r build` — build all packages
- `pnpm test` / `./node_modules/.bin/vitest run` — run tests
- `pnpm typecheck` — typecheck all
- `pnpm --filter @mc/gateway dev` — run the gateway with reload

## Not yet implemented (next phases)

MCP connector framework (incl. TradingView), Postgres/Drizzle persistence, Clerk auth + RBAC, WebSocket live grid, workflows, RAG. See the [roadmap](../docs/mission-control/14-roadmap.md).
