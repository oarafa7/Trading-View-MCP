import { fileURLToPath } from "node:url";
import { ConnectorManager, createUtilityConnector } from "@mc/mcp-connectors";

/**
 * Build the connector pool. The "utility" builtin works offline. The TradingView MCP from this
 * repo is wired as a real stdio connector — it connects if its server can start (its deps are
 * installed and, for live tools, TradingView Desktop is running); otherwise it reports "down".
 * Demonstrates the connector model end-to-end without any bespoke integration code.
 */
export function buildConnectors(): ConnectorManager {
  const mgr = new ConnectorManager();
  mgr.register(createUtilityConnector());

  // repo root = mission-control/apps/gateway/src -> up 4
  const tvEntry = process.env.TRADINGVIEW_MCP_ENTRY ?? fileURLToPath(new URL("../../../../src/server.js", import.meta.url));
  const tvCwd = process.env.TRADINGVIEW_MCP_CWD ?? fileURLToPath(new URL("../../../../", import.meta.url));
  mgr.registerStdio({
    id: "conn_tradingview",
    name: "TradingView",
    transport: "stdio",
    command: process.env.TRADINGVIEW_MCP_CMD ?? "node",
    args: [tvEntry],
    cwd: tvCwd,
  });

  return mgr;
}
