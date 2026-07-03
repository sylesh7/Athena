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
import express from "express";
import { encodePacked, isAddress, keccak256 } from "viem";
import { z } from "zod";
import { routeTask } from "../agents/broker.js";
import { addresses, usdcToUnits } from "../lib/config.js";
import { publicClient, requireEnv, requirePkEnv } from "../lib/chain.js";
import { runStream } from "./streamLoop.js";
import { getStream, initStream, listStreams, updateStream } from "./state.js";

const PORT = Number(process.env.ENTRYPOINT_PORT ?? 3000);
const BROKER_PK = requirePkEnv("BROKER_PK");
const BROKER_WALLET_ADDRESS = requireEnv("BROKER_WALLET_ADDRESS");
const MONITOR_URL = process.env.MCP_MONITOR_URL ?? "http://localhost:8000/mcp";
const DEFAULT_BOND_UNITS = BigInt(process.env.DEFAULT_BOND_UNITS ?? "1000000");
const DEFAULT_MAX_CALLS = Number(process.env.DEFAULT_MAX_CALLS ?? 10);
const MAX_CALLS_CAP = 50; // hard ceiling regardless of what the client requests

const streamTaskSchema = z.object({
  taskDescription: z.string().min(10, "taskDescription must be at least 10 characters"),
  clientAddress: z.string().refine(isAddress, "clientAddress must be a valid 0x address"),
  category: z.string().default("Financial Analysis"),
  bondAmountUsdc: z.number().positive().optional(),
  maxCalls: z.number().int().positive().max(MAX_CALLS_CAP).optional(),
});

const app = express();
app.use(express.json());

const gateway = createGatewayMiddleware({ sellerAddress: BROKER_WALLET_ADDRESS });

app.post("/stream-task", gateway.require("$0.01"), async (req, res) => {
  const parsed = streamTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { taskDescription, clientAddress, category, bondAmountUsdc, maxCalls } = parsed.data;

  try {
    const decision = await routeTask({ taskDescription, category });

    // taskId scheme agreed with Backend A (H3) — byte-for-byte identical to
    // AthenaCommit.computeTaskId(client, taskDescription, blockNumber).
    const blockNumber = await publicClient.getBlockNumber();
    const taskId = keccak256(
      encodePacked(["address", "string", "uint256"], [clientAddress as `0x${string}`, taskDescription, blockNumber])
    );

    initStream(taskId, {
      selectedProviderUrl: decision.selectedProvider.url,
      predictedQualityScore: decision.predictedQualityScore,
      predictedLatencyMs: decision.predictedLatencyMs,
    });

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

    res.json({
      taskId,
      selectedProvider: decision.selectedProvider.url,
      predictedQualityScore: decision.predictedQualityScore,
      predictedLatencyMs: decision.predictedLatencyMs,
      confidenceScore: decision.confidenceScore,
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

app.get("/health", (_req, res) => {
  res.json({ ok: true, contract: addresses.contracts.athenaCommit, broker: BROKER_WALLET_ADDRESS });
});

app.listen(PORT, () => {
  console.log(`Athena entrypoint listening on :${PORT}`);
  console.log(`  POST /stream-task            — client pays $0.01 to start a stream`);
  console.log(`  GET  /stream-status/:taskId  — live progress (H7/H8)`);
  console.log(`  GET  /streams                — session list for Dashboard`);
});
