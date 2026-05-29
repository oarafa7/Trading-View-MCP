import type { ToolSpec, ToolResult } from "@mc/types";
import type { MCPClient, HealthStatus } from "./types.js";

export interface BuiltinTool {
  spec: ToolSpec;
  handler: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

/** An in-process connector — for offline demos/tests and platform-native tools. */
export class BuiltinConnector implements MCPClient {
  constructor(
    readonly id: string,
    readonly name: string,
    private tools: BuiltinTool[],
  ) {}

  async connect(): Promise<void> {}
  health(): HealthStatus {
    return "ok";
  }
  async close(): Promise<void> {}

  async listTools(): Promise<ToolSpec[]> {
    return this.tools.map((t) => t.spec);
  }

  async call(tool: string, args: unknown): Promise<ToolResult> {
    const t = this.tools.find((x) => x.spec.name === tool);
    if (!t) return { ok: false, content: `Unknown tool "${tool}"`, isError: true };
    try {
      const content = await t.handler((args ?? {}) as Record<string, unknown>);
      return { ok: true, content, isError: false };
    } catch (err) {
      return { ok: false, content: err instanceof Error ? err.message : String(err), isError: true };
    }
  }
}

/** A demo "utility" connector: a no-key tool surface to exercise the tool-calling loop + HITL. */
export function createUtilityConnector(): BuiltinConnector {
  return new BuiltinConnector("conn_utility", "Utility", [
    {
      spec: { name: "get_time", description: "Get the current UTC time (ISO 8601).", parameters: { type: "object", properties: {} } },
      handler: () => ({ now: new Date().toISOString() }),
    },
    {
      spec: {
        name: "add",
        description: "Add two numbers.",
        parameters: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] },
      },
      handler: (args) => ({ sum: Number(args.a ?? 0) + Number(args.b ?? 0) }),
    },
    {
      spec: {
        name: "send_notification",
        description: "Send a notification message (side-effecting — gate behind approval).",
        parameters: { type: "object", properties: { message: { type: "string" } }, required: ["message"] },
      },
      handler: (args) => ({ sent: true, message: String(args.message ?? "") }),
    },
  ]);
}
