import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ToolSpec, ToolResult } from "@mc/types";
import type { MCPClient, HealthStatus, ConnectorConfig } from "./types.js";

/**
 * Talks to any MCP server over stdio (the standard transport). This is how external connectors —
 * including this repo's TradingView MCP — plug in: point `command`/`args` at the server process.
 */
export class StdioMCPConnector implements MCPClient {
  readonly id: string;
  readonly name: string;
  private client?: Client;
  private status: HealthStatus = "down";

  constructor(private cfg: ConnectorConfig) {
    this.id = cfg.id;
    this.name = cfg.name;
  }

  async connect(): Promise<void> {
    if (!this.cfg.command) throw new Error(`connector ${this.id}: stdio transport requires a command`);
    const transport = new StdioClientTransport({
      command: this.cfg.command,
      args: this.cfg.args ?? [],
      env: { ...(process.env as Record<string, string>), ...(this.cfg.env ?? {}) },
      cwd: this.cfg.cwd,
    });
    this.client = new Client({ name: "mission-control", version: "0.1.0" }, { capabilities: {} });
    await this.client.connect(transport);
    this.status = "ok";
  }

  async listTools(): Promise<ToolSpec[]> {
    if (!this.client) throw new Error(`connector ${this.id} not connected`);
    const res = await this.client.listTools();
    return res.tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: (t.inputSchema ?? { type: "object", properties: {} }) as Record<string, unknown>,
    }));
  }

  async call(tool: string, args: unknown): Promise<ToolResult> {
    if (!this.client) return { ok: false, content: `connector ${this.id} not connected`, isError: true };
    try {
      const res = await this.client.callTool({ name: tool, arguments: (args ?? {}) as Record<string, unknown> });
      const isError = Boolean((res as { isError?: boolean }).isError);
      return { ok: !isError, content: (res as { content?: unknown }).content ?? res, isError };
    } catch (err) {
      this.status = "degraded";
      return { ok: false, content: err instanceof Error ? err.message : String(err), isError: true };
    }
  }

  health(): HealthStatus {
    return this.status;
  }

  async close(): Promise<void> {
    await this.client?.close().catch(() => {});
    this.status = "down";
  }
}
