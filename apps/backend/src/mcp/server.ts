// Streamable-HTTP MCP endpoint for the audit lens. Stateless (a fresh server+transport per request), read-only, and it only
// talks to the public API — no database access, no keys.  Run:  pnpm mcp   →  http://localhost:3200/mcp
//
// Claude Code:  claude mcp add --transport http athena http://localhost:3200/mcp
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./tools.js";

const apiBase = process.env.ATHENA_API_URL ?? "http://localhost:3100";
const port = Number(process.env.MCP_PORT ?? 3200);
const readToken = process.env.MCP_API_READ_TOKEN;

const app = express();
app.use(express.json({ limit: "1mb" }));

app.post("/mcp", async (req, res) => {
  const server = createMcpServer({ apiBase, ...(readToken ? { readToken } : {}) });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined } as never); // stateless
  res.on("close", () => { void transport.close(); void server.close(); });
  try {
    await server.connect(transport as never);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: String(err) }, id: null });
  }
});
// Stateless mode has no standalone SSE stream or session teardown.
app.get("/mcp", (_req, res) => res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed (stateless server)" }, id: null }));
app.delete("/mcp", (_req, res) => res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed (stateless server)" }, id: null }));
app.get("/health", (_req, res) => res.json({ ok: true, api: apiBase }));

app.listen(port, () => console.log(`Athena MCP audit lens on :${port}/mcp → API ${apiBase} (read-only)`));
