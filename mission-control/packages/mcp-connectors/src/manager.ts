import type { ToolSpec, ToolResult } from "@mc/types";
import type { MCPClient, HealthStatus, ConnectorConfig } from "./types.js";
import { StdioMCPConnector } from "./stdio.js";

export interface ConnectorHealth {
  id: string;
  name: string;
  status: HealthStatus;
  toolCount: number;
}

/**
 * Owns the pool of connectors: connects them, discovers their tools (cached), and routes
 * tool calls. Connection failures are isolated — one bad connector never takes down the rest.
 */
export class ConnectorManager {
  private clients = new Map<string, MCPClient>();
  private toolCache = new Map<string, ToolSpec[]>();

  register(client: MCPClient): void {
    this.clients.set(client.id, client);
  }

  registerStdio(cfg: ConnectorConfig): void {
    this.register(new StdioMCPConnector(cfg));
  }

  has(id: string): boolean {
    return this.clients.has(id);
  }

  get(id: string): MCPClient | undefined {
    return this.clients.get(id);
  }

  /** Connect every registered connector and discover its tools. Failures are caught per connector. */
  async connectAll(log: (msg: string) => void = () => {}): Promise<void> {
    await Promise.all(
      [...this.clients.values()].map(async (c) => {
        try {
          await c.connect();
          const tools = await c.listTools();
          this.toolCache.set(c.id, tools);
          log(`connector ${c.id} ready (${tools.length} tools)`);
        } catch (err) {
          this.toolCache.set(c.id, []);
          log(`connector ${c.id} failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }),
    );
  }

  toolsFor(connectorId: string): ToolSpec[] {
    return this.toolCache.get(connectorId) ?? [];
  }

  toolSpec(connectorId: string, toolName: string): ToolSpec | undefined {
    return this.toolsFor(connectorId).find((t) => t.name === toolName);
  }

  async call(connectorId: string, tool: string, args: unknown): Promise<ToolResult> {
    const client = this.clients.get(connectorId);
    if (!client) return { ok: false, content: `Unknown connector "${connectorId}"`, isError: true };
    return client.call(tool, args);
  }

  health(): ConnectorHealth[] {
    return [...this.clients.values()].map((c) => ({
      id: c.id,
      name: c.name,
      status: c.health(),
      toolCount: this.toolsFor(c.id).length,
    }));
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.clients.values()].map((c) => c.close().catch(() => {})));
  }
}
