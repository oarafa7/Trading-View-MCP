# AI Mission Control — Architecture Blueprint

> Production-grade control plane to connect, orchestrate, monitor, and manage AI agents across many providers (OpenAI, Anthropic, Gemini, Ollama, OpenRouter, Groq, Together, Hugging Face) with MCP tools, memory/RAG, real-time monitoring, cost tracking, and multi-agent workflows.

This directory is the **design blueprint** for the platform. It is documentation only — no application code ships with this set. Implementation proceeds in later phases against these specs.

## Reading order

| # | Document | Covers |
|---|----------|--------|
| 00 | [Overview](./00-overview.md) | Vision, principles, the 13 subsystems, glossary |
| 01 | [System Architecture](./01-system-architecture.md) | Components, topology, event-driven core |
| 02 | [Monorepo Structure](./02-monorepo-structure.md) | Folder tree, packages, build graph |
| 03 | [Database Schema](./03-database-schema.md) | Postgres schema, ER diagram, indexes |
| 04 | [API Architecture](./04-api-architecture.md) | REST + SSE/WS, error model, versioning |
| 05 | [Provider Abstraction](./05-provider-abstraction.md) | Unified LLM contract, streaming, failover |
| 06 | [Agent Lifecycle](./06-agent-lifecycle.md) | Agent schema, state machine, HITL |
| 07 | [Orchestration & Multi-Agent](./07-orchestration-multiagent.md) | Graph model, routing, collaboration |
| 08 | [MCP Integration](./08-mcp-integration.md) | Connector framework, catalog, sandboxing |
| 09 | [Streaming & WebSockets](./09-streaming-websockets.md) | SSE/WS, concurrency, presence, resume |
| 10 | [Memory & RAG](./10-memory-rag.md) | Short/long-term memory, vector pipeline |
| 11 | [Observability & Cost](./11-observability-cost.md) | Logs/traces/metrics, token accounting |
| 12 | [UI / UX](./12-ui-ux.md) | Dashboard IA, panels, design language |
| 13 | [Security, Deployment & Scaling](./13-security-deployment-scaling.md) | Secrets, RBAC, K8s, scaling, failover |
| 14 | [Roadmap](./14-roadmap.md) | Phased delivery plan |
| — | [Implementation Status](./IMPLEMENTATION-STATUS.md) | What's actually built in `/mission-control` vs the blueprint |

## Deliverable traceability

The original request listed 15 deliverables. Each maps to a section here:

| # | Requested deliverable | Where |
|---|----------------------|-------|
| 1 | Full system architecture | [01](./01-system-architecture.md) |
| 2 | Folder structure | [02](./02-monorepo-structure.md) |
| 3 | Database schema | [03](./03-database-schema.md) |
| 4 | API architecture | [04](./04-api-architecture.md) |
| 5 | Agent lifecycle design | [06](./06-agent-lifecycle.md) |
| 6 | WebSocket/event architecture | [09](./09-streaming-websockets.md), [01](./01-system-architecture.md#event-driven-core) |
| 7 | MCP integration architecture | [08](./08-mcp-integration.md) |
| 8 | UI/UX layout | [12](./12-ui-ux.md) |
| 9 | Multi-agent workflow logic | [07](./07-orchestration-multiagent.md) |
| 10 | Example code | Interface sketches in [05](./05-provider-abstraction.md), [06](./06-agent-lifecycle.md), [08](./08-mcp-integration.md) |
| 11 | Production deployment strategy | [13](./13-security-deployment-scaling.md#deployment) |
| 12 | Scaling strategy | [13](./13-security-deployment-scaling.md#scaling) |
| 13 | Security architecture | [13](./13-security-deployment-scaling.md#security) |
| 14 | Token accounting system | [11](./11-observability-cost.md#token--cost-accounting) |
| 15 | Streaming response architecture | [09](./09-streaming-websockets.md) |

## Recommended stack (summary)

- **Frontend:** Next.js 15 (App Router) · TypeScript · Tailwind · shadcn/ui · Framer Motion. Dark-mode-first.
- **Gateway/Orchestration:** Node + Fastify (TypeScript) — provider layer, agent runtime, MCP clients, SSE/WS.
- **AI/RAG:** FastAPI (Python) — embeddings + retrieval (optional phase).
- **Data:** PostgreSQL (Drizzle ORM) · Redis (queues/pub-sub/rate-limit) · Qdrant (vectors).
- **Events/Queue:** BullMQ + Redis Streams.
- **Auth:** Clerk + RBAC.
- **Infra:** pnpm + Turborepo · Docker · Kubernetes-ready.

The existing **TradingView MCP** in this repo is repackaged as `packages/tradingview-mcp` and used as a first-class connector example throughout.
