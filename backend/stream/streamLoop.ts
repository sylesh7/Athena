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
 *    what Backend A actually shipped. The rest of the ERC-8183 lifecycle
 *    (createJob/setBudget/fund/submit) DOES need real calls from here — see
 *    ../lib/erc8183.ts and the createAndFundJob()/submitDeliverable() calls
 *    below.
 */

import { randomUUID, webcrypto } from "node:crypto";
import { parseAbi, type Hex } from "viem";
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { payProvider3OnBase } from "../cctp/crossChainPayout.js";
import { addresses, athenaCommitAbi } from "../lib/config.js";
import { publicClient, walletClientFromPk } from "../lib/chain.js";
import { recordCallResult, getFinalVerdict } from "../mcp-monitor/client.js";
import { postStreamReputation } from "../lib/reputation.js";
import { createAndFundJob, submitDeliverable } from "../lib/erc8183.js";
import { updateStream, sealCommitment, getSealedCommitment } from "./state.js";
import type { CallRecord } from "./state.js";
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

// Authoritative field list for the sealed decision object below (sorted).
// AthenaCommit.sol's NatSpec comment points here instead of re-enumerating
// fields — they drifted out of sync once already. backend/test/smoke.ts
// locks this exact array; the runtime assertion right after decisionObj is
// constructed catches a silent edit to one without the other immediately,
// rather than waiting for `npm test` to notice.
export const DECISION_PREIMAGE_FIELDS = [
  "confidenceScore",
  "nonce",
  "predictedLatencyMs",
  "predictedQualityScore",
  "selectedProvider",
  "selectedProviderUrl",
  "taskId",
  "timestamp",
] as const;

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

  const actualFields = Object.keys(decisionObj).sort();
  if (JSON.stringify(actualFields) !== JSON.stringify(DECISION_PREIMAGE_FIELDS)) {
    throw new Error(
      `decisionObj's fields (${actualFields.join(", ")}) no longer match DECISION_PREIMAGE_FIELDS ` +
        `(${DECISION_PREIMAGE_FIELDS.join(", ")}) — update both together, and update the pointer in ` +
        `AthenaCommit.sol's commit() NatSpec if the change is intentional.`
    );
  }

  // 2. SHA-256 of the canonical JSON. A sorted-keys array as the
  // JSON.stringify replacer both whitelists and orders the output, so this
  // is deterministic regardless of the object's insertion order.
  const canonicalJson = JSON.stringify(decisionObj, actualFields);
  const commitHash = await sha256Hex(canonicalJson);

  // Seal the preimage — kept out of the public StreamStatus (and therefore
  // out of GET /stream-status/:taskId) until reveal. This is what makes the
  // hash externally verifiable later: anyone can pull decisionPreimage once
  // revealed, rehash it themselves, and diff against the on-chain commitHash.
  sealCommitment(config.taskId, commitHash, canonicalJson);

  // 3. Approve the bond, then commit() before anything streams. Note: the
  // routing decision (provider, predicted values) is deliberately NOT
  // included in this update — it stays sealed until reveal, matching
  // README.md's Live Stream View ("Routing Decision ... shown once revealed").
  updateStream(config.taskId, { phase: "committing" });

  // README.md step 3: "Posts USDC bond into ERC-8183 escrow (Athena =
  // evaluator role)." Auto-create the job unless the caller already passed
  // one explicitly. This makes real on-chain calls as both the broker
  // (client role, its own key) and the provider (provider role, via Circle's
  // Transaction API — see lib/erc8183.ts) — deliberately non-fatal: ERC-8183
  // is real but secondary to the core commit-reveal-bond flow, which must
  // keep working even if Circle's API has an issue or a provider lacks a
  // walletId.
  let erc8183JobId: Hex = config.erc8183JobId ?? ZERO_BYTES32;
  if (erc8183JobId === ZERO_BYTES32) {
    try {
      erc8183JobId = await createAndFundJob({
        brokerPk: config.brokerPk,
        providerAddress: config.decision.selectedProvider.address,
        description: `Athena stream ${config.taskId}`,
        bondAmountUnits: config.bondAmountUnits,
      });
    } catch (err) {
      console.error(`ERC-8183 job creation failed for stream ${config.taskId} — continuing without it:`, err);
    }
  }

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
    args: [config.taskId, commitHash, config.bondAmountUnits, config.clientAddress, erc8183JobId],
  });
  await publicClient.waitForTransactionReceipt({ hash: commitTxHash });

  updateStream(config.taskId, {
    phase: "streaming",
    commitTxHash,
    bondStatus: "posted",
    erc8183JobId: erc8183JobId !== ZERO_BYTES32 ? erc8183JobId : null,
  });

  // 4. Stream loop — GatewayClient.pay() per call. The buyer doesn't specify
  // an amount; it's negotiated from the 402 challenge the provider's
  // gateway.require(...) middleware issues.
  const gatewayClient = new GatewayClient({
    chain: "arcTestnet",
    privateKey: config.brokerPk,
    ...(process.env.RPC_URL ? { rpcUrl: process.env.RPC_URL } : {}),
  });

  let callsCompleted = 0;
  // Safe to expose live, unlike the sealed decision object above — these are
  // already-observed facts about calls that already happened, not the sealed
  // prediction they're compared against. Per FRONTEND_README.md's own spec,
  // the call-by-call feed (quality, latency, MCP verdict) is meant to stream
  // live; only which provider was chosen and the exact predicted numbers stay
  // sealed until reveal.
  const callHistory: CallRecord[] = [];
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
      callHistory.push({
        callNumber: i,
        qualityScore,
        latencyMs,
        qualityMet: qualityScore >= config.decision.predictedQualityScore,
        latencyMet: latencyMs <= config.decision.predictedLatencyMs,
      });
      updateStream(config.taskId, {
        callsCompleted,
        lastQualityScore: qualityScore,
        lastLatencyMs: latencyMs,
        callHistory: [...callHistory],
      });

      if (verdict.verdict === "slash") {
        console.log(
          `Stream ${config.taskId} stopping at call ${i} — ${verdict.consecutive_failures} consecutive misses`
        );
        break;
      }
    } catch (err) {
      // A call that errors out entirely (network hiccup, upstream rate
      // limit, Gateway payment failure) must still be reported to the
      // monitor as a miss — without this, breaking the loop silently means
      // `get_final_verdict()` only ever sees the calls that succeeded in
      // being recorded, so a stream that failed outright after 2 misses
      // (never reaching the 3-consecutive-misses threshold because the 3rd
      // call never got recorded at all) would settle as predictionMet=true —
      // a real provider/network failure reported as a met prediction.
      // quality_score=0 guarantees this counts as a miss regardless of what
      // was predicted; latency_ms is the real elapsed time, not a fabricated
      // sentinel.
      const latencyMs = Date.now() - startTime;
      console.error(`Stream ${config.taskId} call ${i} failed:`, err);
      try {
        await recordCallResult(config.monitorUrl, {
          task_id: config.taskId,
          call_number: i,
          quality_score: 0,
          latency_ms: latencyMs,
          predicted_quality: config.decision.predictedQualityScore,
          predicted_latency_ms: config.decision.predictedLatencyMs,
        });
      } catch (monitorErr) {
        console.error(`Stream ${config.taskId} also failed to report call ${i}'s failure to the monitor:`, monitorErr);
      }
      callHistory.push({
        callNumber: i,
        qualityScore: 0,
        latencyMs,
        qualityMet: false,
        latencyMet: false,
      });
      updateStream(config.taskId, { callHistory: [...callHistory] });
      break;
    }
  }

  // 5. Final verdict from the MCP monitor, then reveal on-chain.
  //
  // What reveal()'s on-chain hash check actually proves, and what it doesn't:
  // AthenaCommit.sol's `revealedHash != c.commitHash` check (line 190) only
  // proves that whatever bytes32 we pass here matches whatever bytes32 we
  // passed at commit() time — the contract never sees decisionPreimage, only
  // two hash values it compares to each other. The real tamper-evidence comes
  // from decisionPreimage being published below (once revealed) via
  // GET /stream-status/:taskId: anyone — frontend, a judge, an auditor — can
  // independently recompute SHA-256(decisionPreimage) and diff it against
  // getCommitment(taskId).commitHash read directly on-chain. That's the
  // actual proof; the on-chain check alone is not.
  const { prediction_met } = await getFinalVerdict(config.monitorUrl, config.taskId);

  // If a real ERC-8183 job is linked, the provider must submit() before
  // AthenaCommit.reveal() can complete()/reject() it (job must be in the
  // "Submitted" state) — see lib/erc8183.ts. The deliverable hash represents
  // the actual call-by-call data delivered this stream, not a placeholder.
  // Non-fatal by design: reveal()'s own _settleERC8183 already tolerates a
  // job that was never submitted (emits ERC8183Settled(settled=false)
  // instead of reverting), so a submit() failure here must not block reveal.
  let deliverableHash: Hex = ZERO_BYTES32;
  if (erc8183JobId !== ZERO_BYTES32) {
    deliverableHash = await sha256Hex(JSON.stringify(callHistory));
    try {
      await submitDeliverable(config.decision.selectedProvider.address, erc8183JobId, deliverableHash);
    } catch (err) {
      console.error(`ERC-8183 submit() failed for stream ${config.taskId} — reveal() will still settle safely:`, err);
    }
  }

  // Pull the sealed preimage back out and independently recompute its hash.
  // This is a regression/corruption guard (it runs in the same process/trust
  // boundary as the original seal, so it is NOT external verification — see
  // above for what actually is), catching exactly the class of bug this fix
  // addresses: something silently diverging between seal-time and reveal-time
  // state. IMPORTANT: always reveal with `sealed.commitHash` — the value
  // guaranteed to match what commit() already put on-chain — never with
  // `recomputedHash`. AthenaCommit.sol has no cancel/timeout/recovery
  // function of any kind, so if this ever mismatches and we revealed with the
  // "corrected" value instead, the contract would hard-revert with
  // HashMismatch and the bond would be permanently stranded. On mismatch we
  // log loudly and flag it, but still settle on-chain with the trusted hash.
  const sealed = getSealedCommitment(config.taskId);
  if (!sealed) {
    throw new Error(`No sealed commitment found for taskId ${config.taskId} — cannot reveal safely.`);
  }
  const recomputedHash = await sha256Hex(sealed.decisionPreimage);
  const integrityOk = recomputedHash === sealed.commitHash;
  if (!integrityOk) {
    console.error(
      `Preimage integrity check failed for stream ${config.taskId} — recomputed hash does not match the sealed ` +
        `commit hash. Revealing with the trusted sealed hash regardless, to avoid a HashMismatch revert that would ` +
        `permanently strand the bond. This warrants investigation.`
    );
  }

  updateStream(config.taskId, {
    phase: "revealed",
    selectedProviderUrl: config.decision.selectedProvider.url,
    predictedQualityScore: config.decision.predictedQualityScore,
    predictedLatencyMs: config.decision.predictedLatencyMs,
    commitHash: sealed.commitHash,
    decisionPreimage: sealed.decisionPreimage,
    preimageIntegrityWarning: !integrityOk,
  });

  const revealTxHash = await broker.writeContract({
    address: athenaCommit,
    abi: athenaCommitAbi,
    functionName: "reveal",
    args: [config.taskId, prediction_met, sealed.commitHash, deliverableHash],
  });
  await publicClient.waitForTransactionReceipt({ hash: revealTxHash });

  updateStream(config.taskId, {
    phase: "settled",
    revealTxHash,
    predictionMet: prediction_met,
    bondStatus: prediction_met ? "released" : "slashed",
  });

  // ERC-8004 reputation feedback for both broker and provider (README.md step
  // 7). Fire-and-forget, same convention as the CCTP hook below — a feedback
  // posting failure must never block or delay the stream's own on-chain
  // settlement, which already fully happened above.
  const avgQualityScore =
    callHistory.length > 0 ? callHistory.reduce((sum, c) => sum + c.qualityScore, 0) / callHistory.length : null;
  postStreamReputation({
    brokerAddress: broker.account.address,
    providerAddress: config.decision.selectedProvider.address,
    predictionMet: prediction_met,
    avgQualityScore,
    revealTxHash,
  }).catch((err) => {
    console.error(`postStreamReputation failed for stream ${config.taskId}:`, err);
  });

  // 6. Phase 4 (stretch): pay Provider 3 natively on Base Sepolia via CCTP,
  // instead of the Arc Gateway nanopayments already streamed. Opt-in
  // (ENABLE_CCTP_PAYOUT) and Provider-3-only, since it needs the broker
  // wallet separately funded with Base Sepolia ETH and can take up to the
  // README's 3-hour timebox — never blocks this function's return, and a
  // failure here doesn't touch `phase`/`error`, which describe the
  // already-settled Arc-side stream, not this separate cross-chain leg.
  const isProvider3 = config.decision.selectedProvider.address.toLowerCase() === (process.env.PROVIDER3_WALLET_ADDRESS ?? "").toLowerCase();
  if (prediction_met && isProvider3 && process.env.ENABLE_CCTP_PAYOUT === "true") {
    updateStream(config.taskId, { cctpStatus: "pending" });
    payProvider3OnBase({
      brokerPk: config.brokerPk,
      amountUnits: config.bondAmountUnits,
      recipientAddress: config.decision.selectedProvider.address,
    })
      .then(({ burnTxHash, mintTxHash }) => {
        updateStream(config.taskId, { cctpStatus: "minted", cctpBurnTxHash: burnTxHash, cctpMintTxHash: mintTxHash });
      })
      .catch((err) => {
        console.error(`CCTP payout failed for stream ${config.taskId}:`, err);
        updateStream(config.taskId, {
          cctpStatus: "failed",
          cctpError: err instanceof Error ? err.message : String(err),
        });
      });
  }

  return { predictionMet: prediction_met, commitTxHash, revealTxHash, callsCompleted };
}
