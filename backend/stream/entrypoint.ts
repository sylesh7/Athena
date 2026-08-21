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
import { addresses, usdcToUnits, unitsToUsdc, athenaCommitAbi, GATEWAY_TESTNET_FACILITATOR_URL } from "../lib/config.js";
import { publicClient, requireEnv, requirePkEnv } from "../lib/chain.js";
import { runStream } from "./streamLoop.js";
import { getStream, initStream, listStreams, updateStream } from "./state.js";
import { screenAddress } from "../lib/compliance.js";
import { pushLog, getLogs } from "../lib/logBuffer.js";

const erc20BalanceAbi = parseAbi(["function balanceOf(address owner) view returns (uint256)"]);

// Default 3100 (not 3000) so it never collides with the frontend's Next.js dev
// server (which owns :3000) or the provider agents (:3001-:3003). Override with
// ENTRYPOINT_PORT if you need a different one. PORT takes priority when set —
// Railway/Render/Heroku-style hosts inject it and expect the app to bind there.
const PORT = Number(process.env.PORT ?? process.env.ENTRYPOINT_PORT ?? 3100);
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

// v2: real-time compliance gate via Circle's Compliance Engine — screen the
// paying client's address BEFORE the x402 Gateway middleware ever charges
// it, so a denied address is never billed for a stream it can't start.
// Fails CLOSED on a genuine API/network error: a screening check that
// silently lets everything through when it can't reach Circle is worse than
// no check at all (see lib/compliance.ts). Body is already parsed here —
// express.json() runs as global middleware ahead of every route.
async function complianceGate(req: express.Request, res: express.Response, next: express.NextFunction) {
  const parsed = streamTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { clientAddress } = parsed.data;

  try {
    const screening = await screenAddress(clientAddress);
    if (screening.result !== "APPROVED") {
      pushLog(
        "compliance",
        "warn",
        `Rejected stream request from ${clientAddress} — compliance screening returned ${screening.result}`
      );
      res.status(403).json({ error: "compliance screening denied", screening });
      return;
    }
    pushLog("compliance", "info", `Client ${clientAddress} passed compliance screening (${screening.id})`);
    next();
  } catch (err) {
    console.error(`Compliance screening failed for ${clientAddress}:`, err);
    pushLog(
      "compliance",
      "error",
      `Compliance screening unavailable for ${clientAddress} — rejecting stream request — ${err instanceof Error ? err.message : String(err)}`
    );
    res.status(503).json({ error: "compliance screening unavailable — try again shortly" });
  }
}

app.post("/stream-task", complianceGate, gateway.require("$0.01"), async (req, res) => {
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

// Evidence page (v2): live structured logs from this process, real on-chain
// events read directly from AthenaCommit, live reachability of every service
// Athena actually depends on, and a standalone compliance-screening demo.

// GET /logs — returns the in-memory ring buffer (see lib/logBuffer.ts). This
// process's own real console activity, not synthetic sample data. `sinceId`
// lets a polling frontend fetch only what's new.
app.get("/logs", (req, res) => {
  const sinceId = req.query.sinceId ? Number(req.query.sinceId) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  res.json({ logs: getLogs({ sinceId, limit }) });
});

// GET /onchain-events — real Committed/Revealed events read directly from
// AthenaCommit via eth_getLogs, not derived from in-memory stream state. This
// is the tamper-evident record: it's true regardless of whether this process
// has restarted since a given stream ran.
const onchainEventsSchema = z.object({
  fromBlock: z.coerce.bigint().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

app.get("/onchain-events", async (req, res) => {
  const parsed = onchainEventsSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const athenaCommit = addresses.contracts.athenaCommit as `0x${string}`;
    const latestBlock = await publicClient.getBlockNumber();
    // Default lookback window keeps this fast on a long-lived testnet
    // deployment without needing an indexer — 50k blocks is comfortably more
    // than Athena's entire demo history on Arc Testnet's block time.
    const fromBlock = parsed.data.fromBlock ?? (latestBlock > 50_000n ? latestBlock - 50_000n : 0n);

    const [committedLogs, revealedLogs] = await Promise.all([
      publicClient.getContractEvents({
        address: athenaCommit,
        abi: athenaCommitAbi,
        eventName: "Committed",
        fromBlock,
        toBlock: latestBlock,
      }),
      publicClient.getContractEvents({
        address: athenaCommit,
        abi: athenaCommitAbi,
        eventName: "Revealed",
        fromBlock,
        toBlock: latestBlock,
      }),
    ]);

    const events = [
      ...committedLogs.map((log) => ({
        type: "Committed" as const,
        taskId: (log.args as any).taskId as string,
        blockNumber: log.blockNumber?.toString(),
        txHash: log.transactionHash,
        broker: (log.args as any).broker as string,
        client: (log.args as any).client as string,
        commitHash: (log.args as any).commitHash as string,
        bondAmount: ((log.args as any).bondAmount as bigint)?.toString(),
      })),
      ...revealedLogs.map((log) => ({
        type: "Revealed" as const,
        taskId: (log.args as any).taskId as string,
        blockNumber: log.blockNumber?.toString(),
        txHash: log.transactionHash,
        broker: (log.args as any).broker as string,
        predictionMet: (log.args as any).predictionMet as boolean,
        slashed: (log.args as any).slashed as boolean,
      })),
    ].sort((a, b) => Number(BigInt(a.blockNumber ?? 0) - BigInt(b.blockNumber ?? 0)));

    const limit = parsed.data.limit ?? 100;
    const limited = events.slice(-limit);
    res.json({
      events: limited,
      fromBlock: fromBlock.toString(),
      toBlock: latestBlock.toString(),
      explorerBase: `${addresses.explorer.replace(/\/$/, "")}/tx/`,
    });
  } catch (err) {
    console.error("GET /onchain-events failed:", err);
    res.status(502).json({ error: err instanceof Error ? err.message : "failed to read on-chain events" });
  }
});

// GET /system-health — live reachability of every real service Athena
// depends on, checked right now (not cached, not assumed). A provider is
// "up" only if its own /health route actually answers; the MCP monitor is
// "up" only if its streamable-http port actually accepts a connection.
async function pingHttp(
  url: string,
  opts: { timeoutMs?: number; anyResponseIsUp?: boolean } = {}
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const { timeoutMs = 3000, anyResponseIsUp = false } = opts;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return { ok: anyResponseIsUp ? true : res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

app.get("/system-health", async (_req, res) => {
  const providerPorts: Record<string, number> = {
    provider1: Number(process.env.PROVIDER1_PORT ?? 3001),
    provider2: Number(process.env.PROVIDER2_PORT ?? 3002),
    provider3: Number(process.env.PROVIDER3_PORT ?? 3003),
  };

  const [provider1, provider2, provider3, monitor, chain] = await Promise.all([
    pingHttp(`http://localhost:${providerPorts.provider1}/health`),
    pingHttp(`http://localhost:${providerPorts.provider2}/health`),
    pingHttp(`http://localhost:${providerPorts.provider3}/health`),
    // FastMCP's streamable-http endpoint rejects a bare GET (wrong protocol —
    // it correctly answers 406 since we're not speaking the MCP handshake),
    // but a real HTTP response of any status proves the process is up and
    // listening — an ECONNREFUSED/timeout below means it genuinely isn't.
    pingHttp(MONITOR_URL, { anyResponseIsUp: true }),
    publicClient
      .getBlockNumber()
      .then((blockNumber) => ({ ok: true, blockNumber: blockNumber.toString() }))
      .catch((err) => ({ ok: false, error: err instanceof Error ? err.message : String(err) })),
  ]);

  res.json({
    checkedAt: new Date().toISOString(),
    services: {
      entrypoint: { ok: true, port: PORT },
      provider1: { ...provider1, port: providerPorts.provider1 },
      provider2: { ...provider2, port: providerPorts.provider2 },
      provider3: { ...provider3, port: providerPorts.provider3 },
      mcpMonitor: { ...monitor, url: MONITOR_URL },
      arcTestnetRpc: chain,
    },
  });
});

// GET /compliance/:address — standalone demo of the v2 compliance feature,
// so the Evidence page can screen any address live without spinning up a
// full stream.
app.get("/compliance/:address", async (req, res) => {
  if (!isAddress(req.params.address)) {
    res.status(400).json({ error: "invalid address" });
    return;
  }
  try {
    const screening = await screenAddress(req.params.address);
    res.json(screening);
  } catch (err) {
    console.error(`GET /compliance/${req.params.address} failed:`, err);
    res.status(502).json({ error: err instanceof Error ? err.message : "screening failed" });
  }
});

app.listen(PORT, () => {
  console.log(`Athena entrypoint listening on :${PORT}`);
  console.log(`  POST /stream-task            — client pays $0.01 to start a stream`);
  console.log(`  GET  /stream-status/:taskId  — live progress (H7/H8)`);
  console.log(`  GET  /streams                — session list for Dashboard`);
  console.log(`  GET  /logs                   — live backend activity feed`);
  console.log(`  GET  /onchain-events         — real Committed/Revealed events`);
  console.log(`  GET  /system-health          — live reachability of all services`);
  console.log(`  GET  /compliance/:address    — Circle Compliance Engine screening demo`);
});
