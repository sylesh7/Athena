/**
 * stream/streamLoop.ts — Phase 3.2: the stream loop.
 *
 * Two corrections vs. the original BACKEND_B_README pseudocode, made after
 * inspecting the real published packages instead of guessing:
 *
 * 1. `@circle-fin/x402-batching/client`'s `GatewayClient` takes
 *    `{ chain: 'arcTestnet', privateKey }`, not `{ walletAddress, chain }`,
 *    and the paid-fetch method is `.pay(url)`, not `.fetchWithPayment(url, opts)`.
 *    Verified against the published .d.ts for v3.2.0.
 *
 * 2. AthenaCommit.sol's actual deployed `reveal()` takes
 *    `(taskId, predictionMet, revealedHash, deliverableHash)` and settles any
 *    linked ERC-8183 job atomically inside the same call (`_settleERC8183`).
 *    There is no separate `ERC8183.complete()/reject()` call to make from
 *    here — the earlier README sample assumed a contract shape that predates
 *    what Backend A actually shipped.
 */

import { randomUUID, webcrypto } from "node:crypto";
import { parseAbi, type Hex } from "viem";
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { addresses, athenaCommitAbi } from "../lib/config.js";
import { publicClient, walletClientFromPk } from "../lib/chain.js";
import { recordCallResult, getFinalVerdict } from "../mcp-monitor/client.js";
import { updateStream } from "./state.js";
import type { RoutingDecision } from "../agents/broker.js";

const erc20ApproveAbi = parseAbi(["function approve(address spender, uint256 amount) external returns (bool)"]);

const ZERO_BYTES32 = ("0x" + "0".repeat(64)) as Hex;

export interface StreamConfig {
  taskId: Hex;
  decision: RoutingDecision;
  clientAddress: `0x${string}`;
  bondAmountUnits: bigint; // 6-decimal USDC units
  maxCalls: number;
  brokerPk: Hex;
  monitorUrl: string;
  erc8183JobId?: Hex; // omit / ZERO_BYTES32 to skip ERC-8183
}

export interface StreamResult {
  predictionMet: boolean;
  commitTxHash: Hex;
  revealTxHash: Hex;
  callsCompleted: number;
}

async function sha256Hex(input: string): Promise<Hex> {
  const digest = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return ("0x" + Buffer.from(digest).toString("hex")) as Hex;
}

export async function runStream(config: StreamConfig): Promise<StreamResult> {
  const broker = walletClientFromPk(config.brokerPk);
  const athenaCommit = addresses.contracts.athenaCommit as `0x${string}`;

  // 1. Structured, falsifiable decision object — deterministic, not LLM prose.
  const decisionObj = {
    taskId: config.taskId,
    selectedProvider: config.decision.selectedProvider.address,
    selectedProviderUrl: config.decision.selectedProvider.url,
    predictedQualityScore: config.decision.predictedQualityScore,
    predictedLatencyMs: config.decision.predictedLatencyMs,
    confidenceScore: config.decision.confidenceScore,
    nonce: randomUUID(),
    timestamp: Date.now(),
  };

  // 2. SHA-256 of the canonical JSON. A sorted-keys array as the
  // JSON.stringify replacer both whitelists and orders the output, so this
  // is deterministic regardless of the object's insertion order.
  const canonicalJson = JSON.stringify(decisionObj, Object.keys(decisionObj).sort());
  const commitHash = await sha256Hex(canonicalJson);

  // 3. Approve the bond, then commit() before anything streams.
  updateStream(config.taskId, {
    phase: "committing",
    selectedProviderUrl: config.decision.selectedProvider.url,
    predictedQualityScore: config.decision.predictedQualityScore,
    predictedLatencyMs: config.decision.predictedLatencyMs,
  });

  const approveTx = await broker.writeContract({
    address: addresses.contracts.usdc as `0x${string}`,
    abi: erc20ApproveAbi,
    functionName: "approve",
    args: [athenaCommit, config.bondAmountUnits],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveTx });

  const commitTxHash = await broker.writeContract({
    address: athenaCommit,
    abi: athenaCommitAbi,
    functionName: "commit",
    args: [config.taskId, commitHash, config.bondAmountUnits, config.clientAddress, config.erc8183JobId ?? ZERO_BYTES32],
  });
  await publicClient.waitForTransactionReceipt({ hash: commitTxHash });

  updateStream(config.taskId, { phase: "streaming", commitTxHash, bondStatus: "posted" });

  // 4. Stream loop — GatewayClient.pay() per call. The buyer doesn't specify
  // an amount; it's negotiated from the 402 challenge the provider's
  // gateway.require(...) middleware issues.
  const gatewayClient = new GatewayClient({
    chain: "arcTestnet",
    privateKey: config.brokerPk,
    ...(process.env.RPC_URL ? { rpcUrl: process.env.RPC_URL } : {}),
  });

  let callsCompleted = 0;
  for (let i = 0; i < config.maxCalls; i++) {
    const startTime = Date.now();
    try {
      const result = await gatewayClient.pay<{ qualityScore?: number }>(
        `${config.decision.selectedProvider.url}?call=${i}`
      );
      const latencyMs = Date.now() - startTime;
      const qualityScore = result.data.qualityScore ?? 1.0;

      const verdict = await recordCallResult(config.monitorUrl, {
        task_id: config.taskId,
        call_number: i,
        quality_score: qualityScore,
        latency_ms: latencyMs,
        predicted_quality: config.decision.predictedQualityScore,
        predicted_latency_ms: config.decision.predictedLatencyMs,
      });

      callsCompleted++;
      updateStream(config.taskId, { callsCompleted, lastQualityScore: qualityScore, lastLatencyMs: latencyMs });

      if (verdict.verdict === "slash") {
        console.log(
          `Stream ${config.taskId} stopping at call ${i} — ${verdict.consecutive_failures} consecutive misses`
        );
        break;
      }
    } catch (err) {
      console.error(`Stream ${config.taskId} call ${i} failed:`, err);
      break;
    }
  }

  // 5. Final verdict from the MCP monitor, then reveal on-chain. The hash
  // check in reveal() proves this decision object is the exact one committed
  // before the stream ran — Athena couldn't have adjusted its prediction
  // after seeing results.
  const { prediction_met } = await getFinalVerdict(config.monitorUrl, config.taskId);
  updateStream(config.taskId, { phase: "revealed" });

  const revealTxHash = await broker.writeContract({
    address: athenaCommit,
    abi: athenaCommitAbi,
    functionName: "reveal",
    args: [config.taskId, prediction_met, commitHash, ZERO_BYTES32],
  });
  await publicClient.waitForTransactionReceipt({ hash: revealTxHash });

  updateStream(config.taskId, {
    phase: "settled",
    revealTxHash,
    predictionMet: prediction_met,
    bondStatus: prediction_met ? "released" : "slashed",
  });

  return { predictionMet: prediction_met, commitTxHash, revealTxHash, callsCompleted };
}
