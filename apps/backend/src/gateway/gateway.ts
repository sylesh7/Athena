// Phase 32 + 36 — Circle Gateway. Verified against the installed client's own type definitions:
//  - getBalances() reports ONE unified Gateway balance per depositor (not per chain), so "elsewhere" cannot be split out;
//    consolidation treats `available` as the source, MINUS x402 receipts still waiting to settle (those credits belong to
//    specific receivables, never to the general treasury).
//  - withdraw(amount, { recipient }) mints straight to the recipient on the destination chain. For consolidation the recipient
//    is the treasury contract, so the mint lands in the treasury without passing through fund(); the indexer (Phase 17.3)
//    attributes it to the CONSOLIDATE decision by token and amount.
//  - pay(url) performs the whole x402 402 → sign → retry flow (service purchases).
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { formatAmount } from "@athena/shared/money";
import { q } from "../db.js";
import { installArcRpcRewrite } from "../chain/rpcRewrite.js";
import { log } from "../log.js";
import { TREASURY } from "../chain/readClient.js";
import { safeWithdraw } from "./safeWithdraw.js";
import type { Snapshot } from "../snapshot/snapshot.js";

installArcRpcRewrite(); // the SDK's destination-chain client ignores rpcUrl and uses a dead default hostname (see chain/rpcRewrite.ts)
const client = (pk: string) =>
  new GatewayClient({ chain: "arcTestnet", privateKey: pk as `0x${string}`, ...(process.env.RPC_URL ? { rpcUrl: process.env.RPC_URL } : {}) });

export async function gatewayAvailable(pk: string): Promise<bigint> {
  return (await client(pk).getBalances()).gateway.available;
}

/** Snapshot entries for the wallets we own. Never throws: an unreachable Gateway API just yields no entries. */
export async function gatewaySnapshot(pks: { collections?: string | undefined; spend?: string | undefined }): Promise<Snapshot["gateway"]> {
  const out: Snapshot["gateway"] = [];
  for (const [wallet, pk] of [["collections", pks.collections], ["spend", pks.spend]] as const) {
    if (!pk) continue;
    try {
      // domain 26 = Arc; the balance is the wallet's UNIFIED Gateway balance (usable on Arc regardless of where it was deposited)
      out.push({ wallet, domain: 26, balance: (await gatewayAvailable(pk)).toString() });
    } catch (err) {
      log.warn({ wallet, err: String(err) }, "gateway balance unavailable — omitted from the snapshot");
    }
  }
  return out;
}

/** What the collections wallet may sweep to the treasury: available minus x402 credits not yet settled on-chain. */
export async function consolidatable(collectionsGatewayAvailable: bigint): Promise<bigint> {
  const r = (await q<{ pending: string }>("select coalesce(sum(amount),0)::text as pending from x402_receipts where status in ('pending','withdrawn')"))[0]!;
  const free = collectionsGatewayAvailable - BigInt(r.pending);
  return free > 0n ? free : 0n;
}

interface Consolidate { type: "gateway_consolidate"; amount: string; status: "pending" | "minting" | "done" | "failed"; attempts?: number; error?: string; mintTx?: string }

/** Executes pending CONSOLIDATE decisions: withdraw from the collections wallet's Gateway balance straight into the treasury. */
export async function runGatewayFollowUps(collectionsPk: string | undefined): Promise<number> {
  if (!collectionsPk) return 0;
  const rows = await q<{ decision_id: string; follow_up: Consolidate }>(
    `select decision_id, follow_up from decisions
     where kind = 'CONSOLIDATE' and state = 'noop' and follow_up->>'type' = 'gateway_consolidate' and follow_up->>'status' = 'pending' order by created_at limit 2`);
  let done = 0;
  for (const d of rows) {
    const f = d.follow_up;
    try {
      const avail = await consolidatable(await gatewayAvailable(collectionsPk));
      const amount = BigInt(f.amount) < avail ? BigInt(f.amount) : avail; // never take x402 credits that belong to receivables
      if (amount === 0n) throw new Error("no consolidatable Gateway balance right now");
      // Crash-safe: the attestation is persisted before the mint (see safeWithdraw.ts). If the mint doesn't land now, the
      // retry loop finishes it, and the decision is marked done only once it has.
      const w = await safeWithdraw({ pk: collectionsPk, amount, recipient: TREASURY, purpose: "consolidate" });
      // Burned = no more withdraw calls for this decision (a retry must never burn twice). If the mint is still pending the status is
      // 'minting': retryPendingMints() finishes it and the indexer attributes the inflow to this decision when it lands.
      await q("update decisions set follow_up = $2 where decision_id = $1", [d.decision_id, JSON.stringify({ ...f, status: w.minted ? "done" : "minting", amount: amount.toString(), transferId: w.transferId, mintTx: w.mintTx, error: w.minted ? undefined : w.error?.slice(0, 200) })]);
      if (w.minted) done++;
    } catch (err) {
      const attempts = (f.attempts ?? 0) + 1;
      log.error({ decisionId: d.decision_id, attempts, err: String(err) }, "gateway consolidation failed — will retry");
      await q("update decisions set follow_up = $2 where decision_id = $1", [d.decision_id, JSON.stringify({ ...f, attempts, status: attempts >= 24 ? "failed" : "pending", error: String(err).slice(0, 300) })]);
    }
  }
  return done;
}

/** Deposits any USDC sitting in the spend wallet into Gateway so x402 purchases can draw on it (after a TOP_UP decision). */
export async function runSpendFollowUps(spendPk: string | undefined): Promise<number> {
  if (!spendPk) return 0;
  const rows = await q<{ decision_id: string; follow_up: { type: string; amount: string; status: string } }>(
    `select decision_id, follow_up from decisions
     where kind = 'TOP_UP_SERVICES' and state in ('executed','approved') and follow_up->>'type' = 'gateway_deposit' and follow_up->>'status' = 'pending' order by created_at limit 2`);
  let done = 0;
  for (const d of rows) {
    try {
      const dep = await client(spendPk).deposit(formatAmount(BigInt(d.follow_up.amount)));
      await q("update decisions set follow_up = $2 where decision_id = $1", [d.decision_id, JSON.stringify({ ...d.follow_up, status: "done", depositTx: dep.depositTxHash })]);
      done++;
    } catch (err) {
      log.error({ decisionId: d.decision_id, err: String(err) }, "gateway deposit failed — will retry");
      await q("update decisions set follow_up = $2 where decision_id = $1", [d.decision_id, JSON.stringify({ ...d.follow_up, error: String(err).slice(0, 300) })]);
    }
  }
  return done;
}

/** One x402 purchase from the spend wallet. Records the purchase (and its real cost) whether it succeeded or not. */
export async function buyService(args: { spendPk: string; url: string; meterKey: string; decisionId?: string | null; network: string }): Promise<{ ok: boolean; data?: unknown; amount?: bigint }> {
  const started = Date.now();
  try {
    const r = await client(args.spendPk).pay<unknown>(args.url);
    await q("insert into service_purchases(decision_id, url, amount, ok, latency_ms, meter_key, network) values ($1,$2,$3,true,$4,$5,$6)",
      [args.decisionId ?? null, args.url, r.amount.toString(), Date.now() - started, args.meterKey, args.network]);
    return { ok: true, data: r.data, amount: r.amount };
  } catch (err) {
    log.warn({ url: args.url, err: String(err) }, "service purchase failed");
    await q("insert into service_purchases(decision_id, url, amount, ok, latency_ms, meter_key, network) values ($1,$2,0,false,$3,$4,$5)",
      [args.decisionId ?? null, args.url, Date.now() - started, args.meterKey, args.network]);
    return { ok: false };
  }
}
