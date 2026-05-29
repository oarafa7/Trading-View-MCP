import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

/**
 * Drizzle schema (SQLite for local/dev via better-sqlite3). The same table shapes map to the
 * Postgres schema in docs/mission-control/03-database-schema.md — swap drizzle-orm/sqlite-core
 * for pg-core + a Postgres driver to run this on Postgres. Agents/conversations keep a JSON
 * `data` column (full entity) plus queryable keys; messages and usage_events are fully columnar
 * so chat pagination and cost rollups are real SQL queries.
 */
export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  data: text("data").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  data: text("data").notNull(),
  createdAt: text("created_at").notNull(),
});

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  agentId: text("agent_id"),
  runId: text("run_id"),
  createdAt: text("created_at").notNull(),
});

export const usageEvents = sqliteTable("usage_events", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  runId: text("run_id"),
  agentId: text("agent_id"),
  provider: text("provider").notNull(),
  modelId: text("model_id").notNull(),
  inputTokens: integer("input_tokens").notNull(),
  outputTokens: integer("output_tokens").notNull(),
  cachedTokens: integer("cached_tokens").notNull().default(0),
  reasoningTokens: integer("reasoning_tokens").notNull().default(0),
  costUsd: real("cost_usd").notNull(),
  latencyMs: integer("latency_ms").notNull(),
  ts: text("ts").notNull(),
});

/** Raw DDL mirroring the schema above (used to provision a fresh database on boot). */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL,
  agent_id TEXT, run_id TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages (conversation_id, created_at);
CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, run_id TEXT, agent_id TEXT,
  provider TEXT NOT NULL, model_id TEXT NOT NULL,
  input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
  cached_tokens INTEGER NOT NULL DEFAULT 0, reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL, latency_ms INTEGER NOT NULL, ts TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_ws_ts ON usage_events (workspace_id, ts);
`;
