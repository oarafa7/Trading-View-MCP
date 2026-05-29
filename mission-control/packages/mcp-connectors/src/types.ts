import type { ToolSpec, ToolResult } from "@mc/types";

export type HealthStatus = "ok" | "degraded" | "down";

/** Uniform client over an MCP server (or an in-process builtin connector). */
export interface MCPClient {
  readonly id: string;
  readonly name: string;
  connect(): Promise<void>;
  listTools(): Promise<ToolSpec[]>;
  call(tool: string, args: unknown): Promise<ToolResult>;
  health(): HealthStatus;
  close(): Promise<void>;
}

/** Declarative connector definition (see docs/mission-control/08-mcp-integration.md). */
export interface ConnectorConfig {
  id: string;
  name: string;
  transport: "builtin" | "stdio";
  /** stdio transport: process to spawn */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  /** builtin transport: name of a registered builtin factory */
  builtin?: string;
}

export type { ToolSpec, ToolResult };
