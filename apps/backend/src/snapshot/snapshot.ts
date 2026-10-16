// Phase 18 — one immutable picture of everything the business holds at a block, hashed.
// All contract reads are pinned to the SAME block so the picture is consistent.
import { parseAbi } from "viem";
import { net } from "@athena/shared/addresses";
import { CATEGORY, type CategoryName } from "@athena/shared/categories";
import { canonicalRecord } from "@athena/shared/canonical";
import { commonCfg } from "../config.js";
import { pub, treasuryAbi, TREASURY } from "../chain/readClient.js";
import { q } from "../db.js";

const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);

export interface TokenSnap { balance: string; reserved: string; freeOperating: string; minOperating: string }
export interface BudgetSnap {
  category: string; token: string; limit: string; spent: string; remaining: string;
  perTxApprovalLimit: string; periodEnds: string; requiresEvidence: boolean;
}
export interface Snapshot {
  version: 1;
  network: "testnet" | "mainnet";
  chainId: number;
  block: string;
  takenAt: string;
  treasury: { address: string; tokens: Record<"USDC" | "EURC", TokenSnap>; paused: boolean; overdueCount: string };
  budgets: BudgetSnap[];
  yield: Array<{ vault: string; name: string | null; principal: string; value: string; apyBps: number | null }>;
  gateway: Array<{ wallet: "collections" | "spend"; domain: number; balance: string }>;
  internalWallets: Record<string, { usdc: string; eurc: string }>;
}

export interface TakenSnapshot { snapshot: Snapshot; hash: `0x${string}` }

export async function takeSnapshot(opts: {
  internalWallets?: Record<string, `0x${string}`>;
  gateway?: Snapshot["gateway"];
} = {}): Promise<TakenSnapshot> {
  const n = net(commonCfg.NETWORK);
  const blockNumber = await pub.getBlockNumber();
  const at = { blockNumber };
  const block = await pub.getBlock({ blockNumber });
  const tokens = { USDC: n.tokens.USDC as `0x${string}`, EURC: n.tokens.EURC as `0x${string}` };

  const rd = <T>(functionName: string, args: unknown[] = []) =>
    pub.readContract({ address: TREASURY, abi: treasuryAbi, functionName, args, ...at } as never) as Promise<T>;

  const tokenSnap = async (t: `0x${string}`): Promise<TokenSnap> => {
    const [balance, reserved, free, min] = await Promise.all([
      pub.readContract({ address: t, abi: erc20, functionName: "balanceOf", args: [TREASURY], ...at }),
      rd<bigint>("reserved", [t]), rd<bigint>("freeOperating", [t]), rd<bigint>("minOperating", [t]),
    ]);
    return { balance: balance.toString(), reserved: reserved.toString(), freeOperating: free.toString(), minOperating: min.toString() };
  };
  const [usdc, eurc, paused, overdue] = await Promise.all([tokenSnap(tokens.USDC), tokenSnap(tokens.EURC), rd<boolean>("paused"), rd<bigint>("overdueCount")]);

  const budgets: BudgetSnap[] = [];
  for (const [catName, cat] of Object.entries(CATEGORY) as [CategoryName, `0x${string}`][]) {
    for (const [tName, t] of Object.entries(tokens)) {
      const [b, remaining] = await rd<[
        { limitPerPeriod: bigint; perTxApprovalLimit: bigint; spentInPeriod: bigint; periodSeconds: bigint; periodStart: bigint; requiresEvidence: boolean; exists: boolean },
        bigint,
      ]>("getBudget", [cat, t]);
      if (!b.exists) continue;
      budgets.push({
        category: catName, token: tName, limit: b.limitPerPeriod.toString(), spent: b.spentInPeriod.toString(),
        remaining: remaining.toString(), perTxApprovalLimit: b.perTxApprovalLimit.toString(),
        periodEnds: new Date(Number(b.periodStart + b.periodSeconds) * 1000).toISOString(), requiresEvidence: b.requiresEvidence,
      });
    }
  }

  const internal: Snapshot["internalWallets"] = {};
  for (const [name, addr] of Object.entries(opts.internalWallets ?? {})) {
    const [u, e] = await Promise.all([
      pub.readContract({ address: tokens.USDC, abi: erc20, functionName: "balanceOf", args: [addr], ...at }),
      pub.readContract({ address: tokens.EURC, abi: erc20, functionName: "balanceOf", args: [addr], ...at }),
    ]);
    internal[name] = { usdc: u.toString(), eurc: e.toString() };
  }

  const yieldRows = await q<{ vault_address: string; name: string | null; principal: string; value: string; apy_bps: number | null }>(
    "select vault_address, name, principal, value, apy_bps from yield_positions");

  const snapshot: Snapshot = {
    version: 1, network: commonCfg.NETWORK, chainId: n.chainId, block: blockNumber.toString(),
    takenAt: new Date(Number(block.timestamp) * 1000).toISOString(), // chain time, so the same block ⇒ the same hash
    treasury: { address: TREASURY, tokens: { USDC: usdc, EURC: eurc }, paused, overdueCount: overdue.toString() },
    budgets,
    yield: yieldRows.map((y) => ({ vault: y.vault_address, name: y.name, principal: y.principal, value: y.value, apyBps: y.apy_bps })),
    gateway: opts.gateway ?? [],
    internalWallets: internal,
  };
  return { snapshot, hash: canonicalRecord(snapshot).sha256 };
}

const big = (s: string) => BigInt(s);

/** Phase 18.4 derived figures. */
export function derived(s: Snapshot) {
  const spendable = (t: "USDC" | "EURC") => {
    const x = big(s.treasury.tokens[t].freeOperating) - big(s.treasury.tokens[t].minOperating);
    return x > 0n ? x : 0n;
  };
  const yieldValue = s.yield.reduce((a, y) => a + big(y.value), 0n);
  const gatewayElsewhere = s.gateway.filter((g) => g.domain !== 26).reduce((a, g) => a + big(g.balance), 0n);
  const internal = Object.values(s.internalWallets).reduce((a, w) => a + big(w.usdc), 0n);
  return {
    spendableUsdc: spendable("USDC"),
    spendableEurc: spendable("EURC"),
    reserve: big(s.treasury.tokens.USDC.reserved),
    redeemable: yieldValue,
    elsewhere: gatewayElsewhere,
    fundsUnderManagement: big(s.treasury.tokens.USDC.balance) + yieldValue + s.gateway.reduce((a, g) => a + big(g.balance), 0n) + internal,
  };
}
