/**
 * client/streamOnce.ts — fire ONE real on-chain Athena stream and print the
 * full settled result. This is the real thing, not the smoke test: it makes an
 * actual x402 GatewayClient.pay() call to POST /stream-task (the $0.01 fee),
 * then polls GET /stream-status/:taskId to a terminal phase and prints every
 * on-chain artifact (commit/reveal tx, bond outcome, ERC-8183 jobId, the
 * externally-verifiable commit hash + preimage) with Arcscan links.
 *
 * Prereqs (same as any real stream):
 *   - backend running:  npm run dev   (in another terminal)
 *   - TEST_CLIENT_PK    a funded wallet (separate from broker/providers) with
 *                       USDC deposited into Circle Gateway to pay the $0.01 fee.
 *                       Deposit with:  PK=<that key> AMOUNT=5 npm run wallets:deposit-gateway
 *
 * Usage:
 *   npm run stream                 # SUCCESS case — organic prediction, bond should RELEASE
 *   npm run stream -- slash        # SLASH case  — forces an unmeetable prediction, bond SLASHES
 *
 * (Or: MODE=slash tsx client/streamOnce.ts)
 */

import { GatewayClient } from "@circle-fin/x402-batching/client";
import { privateKeyToAccount } from "viem/accounts";
import { addresses } from "../lib/config.js";
import { requirePkEnv } from "../lib/chain.js";

const BASE = process.env.ENTRYPOINT_URL ?? `http://localhost:${process.env.ENTRYPOINT_PORT ?? 3100}`;
const EXPLORER = addresses.explorer.replace(/\/$/, "");
const mode = (process.argv[2] ?? process.env.MODE ?? "success").toLowerCase();
const isSlash = mode === "slash" || mode === "fail" || mode === "failure";

function tx(hash: string | null | undefined): string {
  return hash ? `${EXPLORER}/tx/${hash}` : "(none)";
}

async function main() {
  const testClientPk = requirePkEnv("TEST_CLIENT_PK");
  const client = privateKeyToAccount(testClientPk);
  const gateway = new GatewayClient({
    chain: "arcTestnet",
    privateKey: testClientPk,
    ...(process.env.RPC_URL ? { rpcUrl: process.env.RPC_URL } : {}),
  });

  console.log(`\n=== Athena real stream — ${isSlash ? "SLASH" : "SUCCESS"} case ===`);
  console.log(`client:     ${client.address}`);
  console.log(`entrypoint: ${BASE}`);
  console.log(`paying $0.01 to POST /stream-task ...`);

  const body: Record<string, unknown> = {
    taskDescription: isSlash
      ? "real on-chain run — forced slash case (unmeetable latency prediction)"
      : "real on-chain run — success case (organic prediction)",
    clientAddress: client.address,
  };
  // The commit-reveal-bond flow is fully real either way; this only sets the
  // prediction target so the run deterministically proves the slash path.
  if (isSlash) body.testOverride = { predictedLatencyMs: 0 };

  const { data } = await gateway.pay<{ taskId: `0x${string}`; statusUrl: string }>(`${BASE}/stream-task`, {
    method: "POST",
    body,
  });
  const taskId = data.taskId;
  if (!taskId) throw new Error(`no taskId in /stream-task response: ${JSON.stringify(data)}`);
  console.log(`✓ paid. taskId=${taskId}`);
  console.log(`polling ${BASE}/stream-status/${taskId} ...\n`);

  const deadline = Date.now() + 150_000;
  let last: Record<string, unknown> | undefined;
  let lastPhase = "";
  while (Date.now() < deadline) {
    const res = await fetch(`${BASE}/stream-status/${taskId}`);
    last = (await res.json()) as Record<string, unknown>;
    if (last.phase !== lastPhase) {
      console.log(`  phase: ${lastPhase || "(start)"} -> ${last.phase}`);
      lastPhase = String(last.phase);
    }
    if (last.phase === "settled" || last.phase === "failed") break;
    await new Promise((r) => setTimeout(r, 2000));
  }

  if (!last || (last.phase !== "settled" && last.phase !== "failed")) {
    throw new Error(`stream ${taskId} did not settle within 150s (last phase: ${last?.phase})`);
  }
  if (last.phase === "failed") {
    throw new Error(`stream ${taskId} FAILED: ${last.error}`);
  }

  const jobIdDec = last.erc8183JobId ? BigInt(last.erc8183JobId as string).toString() : "(none)";
  console.log(`\n──────────── SETTLED ────────────`);
  console.log(`  outcome:            ${last.predictionMet ? "✅ prediction MET — bond RELEASED" : "⚠️  prediction MISSED — bond SLASHED"}`);
  console.log(`  bondStatus:         ${last.bondStatus}`);
  console.log(`  predictionMet:      ${last.predictionMet}`);
  console.log(`  predicted quality>= ${last.predictedQualityScore}   latency<= ${last.predictedLatencyMs}ms`);
  console.log(`  calls completed:    ${last.callsCompleted}`);
  console.log(`  ERC-8183 jobId:     ${jobIdDec}  (${last.erc8183JobId})`);
  console.log(`  commitHash:         ${last.commitHash}`);
  console.log(`  preimage integrity: ${last.preimageIntegrityWarning ? "⚠️ WARNING" : "ok"}`);
  console.log(`\n  on-chain txs (Arcscan):`);
  console.log(`    commit:  ${tx(last.commitTxHash as string)}`);
  console.log(`    reveal:  ${tx(last.revealTxHash as string)}`);
  console.log(`    contract: ${EXPLORER}/address/${addresses.contracts.athenaCommit}`);
  console.log(`\n  verify the commit yourself:`);
  console.log(`    sha256( decisionPreimage ) must equal commitHash above.`);
  console.log(`    decisionPreimage = ${last.decisionPreimage}`);
  console.log("");
}

main().catch((err) => {
  console.error("\n✗ stream failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
