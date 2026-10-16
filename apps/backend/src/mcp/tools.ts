// Phase 41 — the audit lens. A READ-ONLY MCP server so a reviewer (or another agent) can ask "why did Athena pay Northwind early?"
// from Claude Desktop / Claude Code and get answers backed by the committed decision records and the chain. There is no tool
// that writes: writes go through the validated paths in the API and the worker, never through a tool. Every tool is a thin
// wrapper over a public GET endpoint, so this server can run anywhere and needs no credentials.
import { createHash } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export interface McpDeps {
  apiBase: string;
  fetchImpl?: typeof fetch;
  /** Optional read token if the API is ever put behind auth. */
  readToken?: string;
}

const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "expected a 0x-prefixed 32-byte hex id");

export function createMcpServer(deps: McpDeps): McpServer {
  const f = deps.fetchImpl ?? fetch;
  const get = async (path: string): Promise<unknown> => {
    const res = await f(`${deps.apiBase.replace(/\/$/, "")}${path}`, {
      headers: deps.readToken ? { authorization: `Bearer ${deps.readToken}` } : {}, signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text);
  };
  const out = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });
  const err = (e: unknown) => ({ isError: true, content: [{ type: "text" as const, text: String(e instanceof Error ? e.message : e) }] });
  const ro = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
  const wrap = <A>(fn: (a: A) => Promise<unknown>) => async (a: A) => { try { return out(await fn(a)); } catch (e) { return err(e); } };

  const server = new McpServer({ name: "athena-treasury", version: "1.0.0" });

  server.registerTool("treasury_overview", { description: "Latest treasury snapshot: balances (balance/reserved/free/floor), budgets with remaining, yield positions, Gateway balances, internal wallets.", annotations: ro },
    wrap(async () => get("/treasury/overview")));

  server.registerTool("forecast", { description: "Latest 30-day cash forecast (base and stress): daily balances, minima, shortfalls, runway.", annotations: ro },
    wrap(async () => get("/treasury/forecast")));

  server.registerTool("list_obligations", { description: "Accounts-payable obligations with status and planned dates. Optional status filter: open | scheduled | held | escalated | paid | cancelled.",
    inputSchema: { status: z.enum(["open", "scheduled", "held", "escalated", "paid", "cancelled"]).optional(), limit: z.number().int().min(1).max(200).optional() }, annotations: ro },
    wrap(async ({ status, limit }: { status?: string | undefined; limit?: number | undefined }) => get(`/obligations?${new URLSearchParams({ ...(status ? { status } : {}), ...(limit ? { limit: String(limit) } : {}) })}`)));

  server.registerTool("explain_decision", { description: "Explain ONE decision from its committed record: what it saw (snapshot hash, spendable, budget), the forecast it ran, the policy checks it passed, the planner's rationale, the action, and its on-chain state and transactions.",
    inputSchema: { decisionId: hex32 }, annotations: ro },
    wrap(async ({ decisionId }: { decisionId: string }) => {
      const d = (await get(`/decisions/${decisionId}`)) as { record?: { planner?: unknown; rule?: unknown; saw?: unknown; forecast?: unknown; action?: unknown; subject?: unknown; kind?: string }; state?: string; revealed?: boolean; explorer?: unknown; reviews?: unknown };
      return { decisionId, kind: d.record?.kind, state: d.state, revealed: d.revealed, subject: d.record?.subject, action: d.record?.action, saw: d.record?.saw, forecast: d.record?.forecast, rule: d.record?.rule, planner: d.record?.planner, reviews: d.reviews, explorer: d.explorer };
    }));

  server.registerTool("verify_decision", { description: "Independently verify a decision: recompute SHA-256 of the stored record bytes here and compare it with the hash committed on-chain (and with the bytes the contract emitted at reveal). Reports match/mismatch for each check.",
    inputSchema: { decisionId: hex32 }, annotations: ro },
    wrap(async ({ decisionId }: { decisionId: string }) => {
      const v = (await get(`/decisions/${decisionId}/verify`)) as { recordBytes: string; onchainDecisionHash: string; recomputedSha256: string; match: boolean; revealed: boolean; revealTx: string | null; revealedBytesEqual: boolean | null };
      // Don't trust the server's own arithmetic: hash the bytes ourselves.
      const local = `0x${createHash("sha256").update(Buffer.from(v.recordBytes.slice(2), "hex")).digest("hex")}`;
      return {
        decisionId,
        committedOnChain: v.onchainDecisionHash,
        recomputedHere: local,
        independentMatch: local.toLowerCase() === v.onchainDecisionHash.toLowerCase(),
        serverReportedMatch: v.match,
        revealed: v.revealed,
        revealedBytesEqualStoredBytes: v.revealedBytesEqual,
        revealTx: v.revealTx,
        verdict: local.toLowerCase() === v.onchainDecisionHash.toLowerCase() && (v.revealedBytesEqual ?? true) ? "VERIFIED" : "MISMATCH — do not trust this record",
      };
    }));

  server.registerTool("list_escalations", { description: "Payments the contract sent to a human (over a limit/budget/floor), pending or resolved, with the agent's reasoning.",
    inputSchema: { status: z.enum(["pending", "approved", "rejected", "expired", "cancelled"]).optional() }, annotations: ro },
    wrap(async ({ status }: { status?: string | undefined }) => get(`/escalations${status ? `?status=${status}` : ""}`)));

  server.registerTool("review_queue", { description: "Invoices held for a human, with the reason (duplicate, mismatch, payee_address_changed, unknown_vendor, amount_unparseable, …).", annotations: ro },
    wrap(async () => get("/invoices?status=held")));

  server.registerTool("vendor_scorecard", { description: "A vendor's scorecard (0–100), its components, cap, risk tier and payout-address history. Accepts the slug (e.g. vendor:hosting) or id.",
    inputSchema: { payee: z.string().min(2) }, annotations: ro },
    wrap(async ({ payee }: { payee: string }) => {
      const p = (await get(`/payees/${encodeURIComponent(payee)}`)) as Record<string, unknown>;
      return { slug: p.slug, name: p.name, status: p.status, category: p.category, riskTier: p.risk_tier, perTxCap: p.per_tx_cap, scorecard: p.scorecard, addressHistory: p.addressHistory };
    }));

  server.registerTool("metrics", { description: "Traction metrics: USDC paid/received, decisions made vs escalated, human agreement, duplicates caught, payee changes intercepted, funds under management, yield, cross-chain payouts, on-chain reveals.", annotations: ro },
    wrap(async () => get("/metrics")));

  return server;
}
