/**
 * stream/entrypoint.ts — Phase 3.4 + 3.5: the Gateway-protected route clients
 * hit, plus the status endpoint the frontend polls (H7/H8).
 *
 * POST /stream-task pays once ($0.01) to trigger routing + a full stream.
 * The stream itself runs in the background — this responds as soon as a
 * taskId exists, and the caller polls GET /stream-status/:taskId for live
 * progress through commit → stream → reveal → settle.
 */

import "../lib/config.js";
import { createGatewayMiddleware } from "@circle-fin/x402-batching/server";
import { GatewayClient } from "@circle-fin/x402-batching/client";
import express from "express";
import { encodePacked, isAddress, keccak256, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import { routeTask, readErc8004Reputation } from "../agents/broker.js";
import { addresses, usdcToUnits, unitsToUsdc, GATEWAY_TESTNET_FACILITATOR_URL } from "../lib/config.js";
import { publicClient, requireEnv, requirePkEnv } from "../lib/chain.js";
import { runStream } from "./streamLoop.js";
import { getStream, initStream, listStreams, updateStream } from "./state.js";

const erc20BalanceAbi = parseAbi(["function balanceOf(address owner) view returns (uint256)"]);

// Default 3100 (not 3000) so it never collides with the frontend's Next.js dev
// server (which owns :3000) or the provider agents (:3001-:3003). Override with
// ENTRYPOINT_PORT if you need a different one.
const PORT = Number(process.env.ENTRYPOINT_PORT ?? 3100);
const BROKER_PK = requirePkEnv("BROKER_PK");
const BROKER_WALLET_ADDRESS = requireEnv("BROKER_WALLET_ADDRESS");
const MONITOR_URL = process.env.MCP_MONITOR_URL ?? "http://localhost:8000/mcp";
const DEFAULT_BOND_UNITS = BigInt(process.env.DEFAULT_BOND_UNITS ?? "1000000");
const DEFAULT_MAX_CALLS = Number(process.env.DEFAULT_MAX_CALLS ?? 10);
const MAX_CALLS_CAP = 50; // hard ceiling regardless of what the client requests

const streamTaskSchema = z.object({
  taskDescription: z.string().min(10, "taskDescription must be at least 10 characters"),
  clientAddress: z.string().refine(isAddress, "clientAddress must be a valid 0x address"),
  // Must be Circle Agent Marketplace's UPPER_SNAKE_CASE category enum (e.g.
  // FINANCIAL_ANALYSIS) — confirmed live via `circle services search --help`.
  // See broker.ts discoverProviders()'s comment for the full story.
  category: z.string().default("FINANCIAL_ANALYSIS"),
  bondAmountUsdc: z.number().positive().optional(),
  maxCalls: z.number().int().positive().max(MAX_CALLS_CAP).optional(),
  // Test/demo only — overrides routeTask()'s auto-derived prediction instead
  // of faking anything: the commit-reveal-slash flow that follows is fully
  // real either way, this just lets a caller deliberately engineer which
  // outcome it proves. Exists because our real providers report a steady
  // qualityScore/latency, so an organic run essentially never slashes —
  // there was otherwise no way to exercise the real on-chain slash path
  // (as opposed to just the MCP monitor's verdict logic in isolation).
  // See test/smoke.ts Tier 6.
  testOverride: z
    .object({
      predictedQualityScore: z.number().min(0).max(1).optional(),
      predictedLatencyMs: z.number().int().min(0).optional(),
    })
    .optional(),
});

const app = express();
app.use(express.json());

// CORS — the frontend (browser, origin http://localhost:3000) calls this API
// cross-origin; without these headers the browser blocks every read. Zero-dep
// middleware rather than pulling in `cors` (which isn't a direct dependency).
// Open origin is fine for a local demo: the only mutating route (/stream-task)
// is separately x402-protected, so it can't be abused just by being reachable.
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", req.headers.origin ?? "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, X-Payment, X-Payment-Response");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

// MUST pass facilitatorUrl explicitly — createGatewayMiddleware defaults to
// Circle's MAINNET Gateway facilitator otherwise, which has never heard of
// Arc Testnet. See lib/config.ts's GATEWAY_TESTNET_FACILITATOR_URL comment
// for the full story — this exact omission is why a real GatewayClient.pay()
// against /stream-task failed with "No Gateway batching option available
// for network eip155:5042002" the first time it was actually tried.
const gateway = createGatewayMiddleware({
  sellerAddress: BROKER_WALLET_ADDRESS,
  facilitatorUrl: GATEWAY_TESTNET_FACILITATOR_URL,
});

app.post("/stream-task", gateway.require("$0.01"), async (req, res) => {
  const parsed = streamTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { taskDescription, clientAddress, category, bondAmountUsdc, maxCalls, testOverride } = parsed.data;

  try {
    const decision = await routeTask({ taskDescription, category });
    if (testOverride?.predictedQualityScore !== undefined) {
      decision.predictedQualityScore = testOverride.predictedQualityScore;
    }
    if (testOverride?.predictedLatencyMs !== undefined) {
      decision.predictedLatencyMs = testOverride.predictedLatencyMs;
    }

    // taskId scheme agreed with Backend A (H3) — byte-for-byte identical to
    // AthenaCommit.computeTaskId(client, taskDescription, blockNumber).
    const blockNumber = await publicClient.getBlockNumber();
    const taskId = keccak256(
      encodePacked(["address", "string", "uint256"], [clientAddress as `0x${string}`, taskDescription, blockNumber])
    );

    // The routing decision (provider, predicted values) is deliberately NOT
    // seeded here — it stays sealed until the stream is revealed, matching
    // README.md's Live Stream View ("Routing Decision ... shown once
    // revealed"). See streamLoop.ts's sealCommitment/getSealedCommitment.
    initStream(taskId);

    // Fire the stream in the background; caller polls /stream-status/:taskId.
    runStream({
      taskId,
      decision,
      clientAddress: clientAddress as `0x${string}`,
      bondAmountUnits: bondAmountUsdc ? usdcToUnits(bondAmountUsdc) : DEFAULT_BOND_UNITS,
      maxCalls: maxCalls ?? DEFAULT_MAX_CALLS,
      brokerPk: BROKER_PK,
      monitorUrl: MONITOR_URL,
    }).catch((err) => {
      console.error(`Stream ${taskId} failed:`, err);
      updateStream(taskId, { phase: "failed", error: err instanceof Error ? err.message : String(err) });
    });

    // Deliberately minimal response — the routing decision stays sealed until
    // reveal. Poll statusUrl for progress; predicted values, selected
    // provider, and the commit hash/preimage only appear once phase becomes
    // "revealed".
    res.json({
      taskId,
      statusUrl: `/stream-status/${taskId}`,
    });
  } catch (err) {
    console.error("Failed to start stream:", err);
    res.status(502).json({ error: err instanceof Error ? err.message : "routing failed" });
  }
});

app.get("/stream-status/:taskId", (req, res) => {
  const status = getStream(req.params.taskId);
  if (!status) {
    res.status(404).json({ error: "unknown taskId" });
    return;
  }
  res.json(status);
});

app.get("/streams", (_req, res) => {
  res.json(listStreams());
});

// Agent Roster (FRONTEND_README Page 5) — the 4 registered agents from
// shared/addresses.json, each with its live ERC-8004 reputation (real
// getSummary read, same as the router uses) and on-chain USDC balance.
app.get("/agents", async (_req, res) => {
  try {
    const usdc = addresses.contracts.usdc as `0x${string}`;
    const entries = Object.entries(addresses.agents);
    const agents = await Promise.all(
      entries.map(async ([key, a]) => {
        const address = a.address as `0x${string}`;
        const [reputation, balanceUnits] = await Promise.all([
          readErc8004Reputation(address),
          publicClient
            .readContract({ address: usdc, abi: erc20BalanceAbi, functionName: "balanceOf", args: [address] })
            .catch(() => 0n),
        ]);
        return {
          key,
          name: a.name,
          role: a.role,
          address,
          tokenId: a.tokenId,
          custody: a.custody ?? "eoa",
          usdcBalance: unitsToUsdc(balanceUnits),
          reputation: {
            avgQuality: reputation.avgQuality,
            sampleSize: reputation.sampleSize,
          },
          arcscan: `${addresses.explorer.replace(/\/$/, "")}/address/${address}`,
        };
      })
    );
    res.json({ agents });
  } catch (err) {
    console.error("GET /agents failed:", err);
    res.status(502).json({ error: err instanceof Error ? err.message : "failed to load agents" });
  }
});

// Demo trigger (FRONTEND_README Pages 4/6) — lets the browser start a REAL
// on-chain stream without implementing an in-browser x402 payer. The x402
// payment is genuine (a real GatewayClient.pay from TEST_CLIENT_PK); it's
// just initiated here server-side so the frontend can trigger it with a
// plain fetch. The commit-reveal-bond-slash flow that follows is fully real.
// Requires TEST_CLIENT_PK (a funded wallet with a Gateway deposit) in env.
const demoTriggerSchema = z.object({
  taskDescription: z.string().min(10).optional(),
  mode: z.enum(["success", "slash"]).optional(),
});

app.post("/demo/trigger-stream", async (req, res) => {
  const testClientPk = process.env.TEST_CLIENT_PK as `0x${string}` | undefined;
  if (!testClientPk) {
    res.status(501).json({ error: "TEST_CLIENT_PK not set — server-side demo trigger unavailable" });
    return;
  }
  const parsed = demoTriggerSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const mode = parsed.data.mode ?? "success";
  const taskDescription =
    parsed.data.taskDescription ??
    (mode === "slash"
      ? "demo trigger — forced slash case (unmeetable latency prediction)"
      : "demo trigger — success case (organic prediction)");

  try {
    const client = privateKeyToAccount(testClientPk);
    const gateway = new GatewayClient({
      chain: "arcTestnet",
      privateKey: testClientPk,
      ...(process.env.RPC_URL ? { rpcUrl: process.env.RPC_URL } : {}),
    });
    const body: Record<string, unknown> = { taskDescription, clientAddress: client.address };
    if (mode === "slash") body.testOverride = { predictedLatencyMs: 0 };

    const { data } = await gateway.pay<{ taskId: `0x${string}`; statusUrl: string }>(
      `http://localhost:${PORT}/stream-task`,
      { method: "POST", body }
    );
    res.json({ taskId: data.taskId, statusUrl: `/stream-status/${data.taskId}`, mode });
  } catch (err) {
    console.error("POST /demo/trigger-stream failed:", err);
    res.status(502).json({ error: err instanceof Error ? err.message : "demo trigger failed" });
  }
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, contract: addresses.contracts.athenaCommit, broker: BROKER_WALLET_ADDRESS });
});

app.listen(PORT, () => {
  console.log(`Athena entrypoint listening on :${PORT}`);
  console.log(`  POST /stream-task            — client pays $0.01 to start a stream`);
  console.log(`  GET  /stream-status/:taskId  — live progress (H7/H8)`);
  console.log(`  GET  /streams                — session list for Dashboard`);
});
