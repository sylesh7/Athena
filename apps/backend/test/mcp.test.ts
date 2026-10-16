// The MCP audit lens, exercised with the real MCP SDK client over Streamable HTTP against a stub API. Proves: nine read-only
// tools and no write tool; verify_decision does its OWN SHA-256 (and flags a tampered record even if the API claims a match);
// bad input and an unreachable API come back as clean tool errors.
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const MCP_PORT = 18230;
const good = Buffer.from('{"schema":"athena.decision.v1","kind":"PAY_NOW"}', "utf8");
const goodHash = `0x${createHash("sha256").update(good).digest("hex")}`;
const ID_OK = "0x" + "a".repeat(64);
const ID_TAMPERED = "0x" + "b".repeat(64);
let stub: Server;
let client: Client;

const callText = async (name: string, args: Record<string, unknown> = {}) => {
  const r = await client.callTool({ name, arguments: args }) as { isError?: boolean; content: Array<{ text: string }> };
  return { isError: Boolean(r.isError), text: r.content[0]!.text };
};

beforeAll(async () => {
  stub = createServer((req, res) => {
    const send = (code: number, body: unknown) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    const url = new URL(req.url!, "http://x");
    if (url.pathname === `/decisions/${ID_OK}/verify`) return send(200, { recordBytes: "0x" + good.toString("hex"), onchainDecisionHash: goodHash, recomputedSha256: goodHash, match: true, revealed: true, revealTx: "0xreveal", revealedBytesEqual: true });
    // a tampered record: the stored bytes differ from what was committed, but a dishonest API still claims "match: true"
    if (url.pathname === `/decisions/${ID_TAMPERED}/verify`) return send(200, { recordBytes: "0x" + Buffer.from('{"kind":"PAY_NOW","amount":"999"}').toString("hex"), onchainDecisionHash: goodHash, recomputedSha256: goodHash, match: true, revealed: true, revealTx: "0xr", revealedBytesEqual: true });
    if (url.pathname === `/decisions/${ID_OK}`) return send(200, { state: "executed", revealed: true, explorer: { commit: "https://x/c" }, reviews: [], record: { kind: "PAY_NOW", subject: { obligation: { payee: "Hosting Co" } }, action: { amount: "100000000" }, saw: { block: "1" }, forecast: {}, rule: { checks: [{ name: "budget", passed: true }] }, planner: { rationale: "due tomorrow; cash covers it" } } });
    if (url.pathname === "/payees/vendor%3Ahosting") return send(200, { slug: "vendor:hosting", name: "Hosting Co", status: "active", category: "VENDOR", risk_tier: "low", per_tx_cap: "0", scorecard: { score: 100 }, addressHistory: [] });
    if (url.pathname === "/obligations") return send(200, { items: [{ status: url.searchParams.get("status") }] });
    if (["/treasury/overview", "/treasury/forecast", "/invoices", "/escalations", "/metrics"].includes(url.pathname)) return send(200, { path: url.pathname, status: url.searchParams.get("status") });
    return send(404, { error: { code: "not_found" } });
  });
  await new Promise<void>((r) => stub.listen(18231, "127.0.0.1", r));
  process.env.ATHENA_API_URL = "http://127.0.0.1:18231";
  process.env.MCP_PORT = String(MCP_PORT);
  await import("../src/mcp/server.js");
  await new Promise((r) => setTimeout(r, 500));
  client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${MCP_PORT}/mcp`)) as never);
}, 60_000);

afterAll(async () => { await client?.close(); stub?.close(); });

describe("MCP audit lens (Phase 41)", () => {
  it("exposes exactly the nine read-only tools and nothing that can write", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["explain_decision", "forecast", "list_escalations", "list_obligations", "metrics", "review_queue", "treasury_overview", "vendor_scorecard", "verify_decision"]);
    for (const t of tools) {
      expect(t.annotations?.readOnlyHint, t.name).toBe(true);
      expect(t.annotations?.destructiveHint, t.name).toBe(false);
    }
    expect(tools.some((t) => /pay|approve|execute|commit|reveal|write|send|create|delete/i.test(t.name))).toBe(false);
  });

  it("verify_decision recomputes the hash itself and reports VERIFIED for an honest record", async () => {
    const r = await callText("verify_decision", { decisionId: ID_OK });
    const j = JSON.parse(r.text);
    expect(r.isError).toBe(false);
    expect(j).toMatchObject({ independentMatch: true, serverReportedMatch: true, verdict: "VERIFIED", recomputedHere: goodHash, committedOnChain: goodHash });
  });

  it("verify_decision catches a tampered record even when the API claims it matches", async () => {
    const j = JSON.parse((await callText("verify_decision", { decisionId: ID_TAMPERED })).text);
    expect(j.serverReportedMatch).toBe(true); // the lying API
    expect(j.independentMatch).toBe(false); // our own SHA-256 disagrees
    expect(j.verdict).toContain("MISMATCH");
  });

  it("explain_decision returns the reasoning, rule checks and explorer links", async () => {
    const j = JSON.parse((await callText("explain_decision", { decisionId: ID_OK })).text);
    expect(j.kind).toBe("PAY_NOW");
    expect(j.planner.rationale).toContain("due tomorrow");
    expect(j.rule.checks[0].name).toBe("budget");
    expect(j.explorer.commit).toBe("https://x/c");
  });

  it("filters and lookups pass through (status filter, vendor slug)", async () => {
    expect(JSON.parse((await callText("list_obligations", { status: "held" })).text).items[0].status).toBe("held");
    expect(JSON.parse((await callText("vendor_scorecard", { payee: "vendor:hosting" })).text)).toMatchObject({ slug: "vendor:hosting", scorecard: { score: 100 } });
    expect(JSON.parse((await callText("metrics")).text).path).toBe("/metrics");
  });

  it("rejects malformed ids at the schema boundary, and surfaces API errors as tool errors (not crashes)", async () => {
    const bad = await client.callTool({ name: "verify_decision", arguments: { decisionId: "not-a-hash" } }) as { isError?: boolean; content: Array<{ text: string }> };
    expect(bad.isError).toBe(true);
    const missing = await callText("explain_decision", { decisionId: "0x" + "c".repeat(64) });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain("404");
  });
});
