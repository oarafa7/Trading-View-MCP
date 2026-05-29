import { describe, it, expect } from "vitest";
import { createUtilityConnector, ConnectorManager } from "@mc/mcp-connectors";

describe("BuiltinConnector (utility)", () => {
  it("lists its tools", async () => {
    const c = createUtilityConnector();
    const tools = await c.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["add", "get_time", "send_notification"]);
  });

  it("executes tools and reports errors", async () => {
    const c = createUtilityConnector();
    const add = await c.call("add", { a: 2, b: 3 });
    expect(add.ok).toBe(true);
    expect((add.content as { sum: number }).sum).toBe(5);

    const unknown = await c.call("nope", {});
    expect(unknown.ok).toBe(false);
    expect(unknown.isError).toBe(true);
  });
});

describe("ConnectorManager", () => {
  it("connects, caches tools, routes calls and reports health", async () => {
    const mgr = new ConnectorManager();
    mgr.register(createUtilityConnector());
    await mgr.connectAll();

    expect(mgr.toolsFor("conn_utility").length).toBe(3);
    expect(mgr.toolSpec("conn_utility", "get_time")?.name).toBe("get_time");

    const res = await mgr.call("conn_utility", "send_notification", { message: "hi" });
    expect(res.ok).toBe(true);

    const health = mgr.health();
    expect(health[0]).toMatchObject({ id: "conn_utility", status: "ok", toolCount: 3 });

    const missing = await mgr.call("conn_nope", "x", {});
    expect(missing.ok).toBe(false);
  });
});
