// Phase 31 — Circle Earn Kit wrapper. Deposit/redeem are FOLLOW-UPS: the on-chain, policy-checked step is the committed
// decision (PAY to the internal yield payee, capped by the YIELD budget). Only after that executes does the yield wallet
// touch a vault, and the vault + amount were already in the committed record. Vault facts used here were verified against a
// live `exploreVaults` response on Arc testnet; deposit/withdraw call shapes come from the SDK's own type definitions.
import { EarnKit } from "@circle-fin/earn-kit";
import { createViemAdapterFromPrivateKey } from "@circle-fin/adapter-viem-v2";
import { formatAmount, parseAmount } from "@athena/shared/money";
import { net } from "@athena/shared/addresses";
import { createPublicClient, createWalletClient, fallback, http, keccak256, stringToBytes, parseAbi } from "viem";
import { commonCfg } from "../config.js";
import { installArcRpcRewrite } from "../chain/rpcRewrite.js";
import { q } from "../db.js";
import { log } from "../log.js";
import { yieldWallet } from "../chain/clients.js";
import { sendTreasury } from "../chain/tx.js";
import { send } from "../chain/tx.js";
import { TREASURY } from "../chain/readClient.js";
import { selectVaults, type RawVault, type VaultCandidate } from "./select.js";

installArcRpcRewrite(); // the Circle SDKs default to a dead RPC hostname (see chain/rpcRewrite.ts)
const kit = new EarnKit();
const chainName = () => {
  const c = net(commonCfg.NETWORK).earnKitChain;
  if (!c) throw new Error("Earn Kit is not verified for this network (earnKitChain is null in addresses.json) — yield is disabled");
  return c as "Arc_Testnet";
};

/** Vault discovery, cached 15 minutes (it is a public REST call; no API key). */
let cache: { at: number; vaults: RawVault[] } | null = null;
export async function exploreVaults(): Promise<RawVault[]> {
  if (cache && Date.now() - cache.at < 15 * 60_000) return cache.vaults;
  const r = await kit.exploreVaults({ chain: chainName() });
  const vaults = r.vaults as unknown as RawVault[];
  cache = { at: Date.now(), vaults };
  return vaults;
}

export async function candidatesFor(amount: bigint): Promise<VaultCandidate[]> {
  return selectVaults(await exploreVaults(), amount);
}

// The SDK defaults to rpc.testnet.arc.network (the old domain, which does not resolve everywhere). Route it through OUR
// RPC list (Canteen/public with fallback) instead.
const rpcTransport = () => fallback([http(commonCfg.RPC_URL, { timeout: 10_000 }), http(commonCfg.RPC_URL_FALLBACK, { timeout: 10_000 })]);
const adapterFor = (pk: string) =>
  createViemAdapterFromPrivateKey({
    privateKey: pk,
    getPublicClient: ({ chain }) => createPublicClient({ chain, transport: rpcTransport() }) as never,
    getWalletClient: ({ chain, account }) => createWalletClient({ chain, account, transport: rpcTransport() }) as never,
  });

export async function vaultPositionUnits(yieldPk: string, vault: string): Promise<bigint> {
  let pos;
  try {
    pos = await kit.getPosition({ from: { adapter: adapterFor(yieldPk), chain: chainName() }, vaultAddress: vault });
  } catch (e) {
    // A wallet that never deposited has no registered position: that is a balance of zero, not a failure.
    if (/not registered/i.test(String((e as Error).message))) return 0n;
    throw e;
  }
  // `currentBalance` is the withdrawable value as a decimal string in token units; parse strictly into atomic units.
  let v = String(pos.currentBalance ?? "0").trim();
  if (v.includes(".")) v = v.replace(/0+$/, "").replace(/.$/, "");
  return parseAmount(v === "" ? "0" : v);
}

interface FollowUp { type: "earn_deposit" | "earn_redeem"; vault: string; amount: string; status: "pending" | "done" | "failed"; error?: string; txs?: unknown }

/** Runs pending yield follow-ups for resolved decisions. Idempotent: status flips to done only after the vault call returns. */
export async function runYieldFollowUps(yieldPk: string | undefined): Promise<number> {
  if (!yieldPk || !yieldWallet) return 0;
  const rows = await q<{ decision_id: string; kind: string; follow_up: FollowUp }>(
    `select decision_id, kind, follow_up from decisions
     where follow_up->>'type' in ('earn_deposit','earn_redeem') and follow_up->>'status' = 'pending'
       and ((kind = 'YIELD_DEPOSIT' and state in ('executed','approved')) or (kind = 'YIELD_REDEEM' and state = 'noop'))
     order by created_at limit 5`);
  let n = 0;
  for (const d of rows) {
    const f = d.follow_up;
    const human = formatAmount(BigInt(f.amount));
    try {
      const from = { adapter: adapterFor(yieldPk), chain: chainName() };
      if (f.type === "earn_deposit") {
        const res = await kit.deposit({ from, vaultAddress: f.vault, amount: human });
        await q(
          `insert into yield_positions(vault_address, chain, name, principal, value, updated_at) values ($1,$2,$3,$4,$4,now())
           on conflict (vault_address) do update set principal = yield_positions.principal + excluded.principal, value = yield_positions.value + excluded.value, updated_at = now()`,
          [f.vault, chainName(), null, f.amount]);
        await q("update decisions set follow_up = $2 where decision_id = $1", [d.decision_id, JSON.stringify({ ...f, status: "done", txs: JSON.parse(JSON.stringify(res, (_k, v) => (typeof v === "bigint" ? v.toString() : v))) })]);
      } else {
        const res = await kit.withdraw({ from, vaultAddress: f.vault, amount: human });
        // USDC is now in the yield wallet: approve + fund() the treasury with the YIELD_REDEEM tag so the indexer attributes it.
        const usdc = net(commonCfg.NETWORK).tokens.USDC as `0x${string}`;
        await send({ wallet: yieldWallet, address: usdc, abi: parseAbi(["function approve(address,uint256) returns (bool)"]), functionName: "approve", args: [TREASURY, BigInt(f.amount)], label: "approve redeem" });
        await sendTreasury(yieldWallet, "fund", [usdc, BigInt(f.amount), keccak256(stringToBytes("YIELD_REDEEM"))], "fund YIELD_REDEEM");
        await q("update yield_positions set principal = greatest(principal - $2::numeric, 0), value = greatest(value - $2::numeric, 0), updated_at = now() where vault_address = $1", [f.vault, f.amount]);
        await q("update decisions set follow_up = $2 where decision_id = $1", [d.decision_id, JSON.stringify({ ...f, status: "done", txs: JSON.parse(JSON.stringify(res, (_k, v) => (typeof v === "bigint" ? v.toString() : v))) })]);
      }
      n++;
    } catch (err) {
      log.error({ decisionId: d.decision_id, err: String(err) }, "yield follow-up failed — will retry next tick");
      await q("update decisions set follow_up = $2 where decision_id = $1", [d.decision_id, JSON.stringify({ ...f, status: "pending", error: String(err).slice(0, 300) })]);
    }
  }
  return n;
}

/** Refresh position values from the vault (yield earned = value − principal). */
export async function refreshPositions(yieldPk: string | undefined): Promise<void> {
  if (!yieldPk) return;
  const rows = await q<{ vault_address: string }>("select vault_address from yield_positions");
  for (const r of rows) {
    try {
      const v = await vaultPositionUnits(yieldPk, r.vault_address);
      await q("update yield_positions set value = $2, updated_at = now() where vault_address = $1", [r.vault_address, v.toString()]);
    } catch (err) { log.warn({ vault: r.vault_address, err: String(err) }, "position refresh failed"); }
  }
}
