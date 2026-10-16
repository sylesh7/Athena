// Phase 34 — USDC → EURC. The swap runs from the FX wallet (a Circle Developer-Controlled Wallet), AFTER the committed,
// budget-checked PAY to that wallet executed. Two verified-live facts shape this file: App Kit supports Arc_Testnet swaps
// without an API key, and `getTokenRates` gives a free reference price used for the rate band (so no x402 data purchase is
// needed for FX). Proceeds return to the treasury through fund(EURC, …, FX_PROCEEDS) so the indexer attributes them.
import { AppKit } from "@circle-fin/app-kit";
import { createCircleWalletsAdapter } from "@circle-fin/adapter-circle-wallets";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { formatAmount } from "@athena/shared/money";
import { net } from "@athena/shared/addresses";
import { keccak256, parseAbi, stringToBytes } from "viem";
import { commonCfg } from "../config.js";
import { installArcRpcRewrite } from "../chain/rpcRewrite.js";
import { q } from "../db.js";
import { log } from "../log.js";
import { pub, treasuryAbi, TREASURY } from "../chain/readClient.js";
import { checkRateBand, expectedEurcOut, toMicroUsd } from "./rates.js";

installArcRpcRewrite(); // the Circle SDKs default to a dead RPC hostname (see chain/rpcRewrite.ts)
const kit = new AppKit();
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);

export interface FxCfg {
  circleApiKey: string; entitySecret: string; walletId: string; walletAddress: `0x${string}`; appKitKey?: string | undefined; maxDeviationBps: bigint;
}

const chainName = () => {
  const c = net(commonCfg.NETWORK).appKitChain;
  if (!c) throw new Error("App Kit swap is not verified for this network (appKitChain is null in addresses.json) — FX is disabled");
  return c as "Arc_Testnet";
};

/** Reference prices (USD) for USDC and EURC, in micro-USD. Free; no API key. */
export async function referencePrices(): Promise<{ usdc: bigint; eurc: bigint }> {
  const usdc = net(commonCfg.NETWORK).tokens.USDC.toLowerCase();
  const eurc = net(commonCfg.NETWORK).tokens.EURC.toLowerCase();
  const r = (await kit.getTokenRates({ tokenIn: "USDC", tokenOut: "EURC", chain: chainName() } as never)) as unknown as {
    rates: Record<string, Record<string, { priceUSD: string }>>;
  };
  const byChain = r.rates[chainName()] ?? {};
  const u = byChain[usdc]?.priceUSD; const e = byChain[eurc]?.priceUSD;
  if (!u || !e) throw new Error("reference price feed returned no USDC/EURC price for this chain");
  return { usdc: toMicroUsd(u), eurc: toMicroUsd(e) };
}

const swapParams = (c: FxCfg, amountIn: bigint) => ({
  from: { adapter: createCircleWalletsAdapter({ apiKey: c.circleApiKey, entitySecret: c.entitySecret }), chain: chainName(), address: c.walletAddress },
  tokenIn: "USDC" as const, tokenOut: "EURC" as const, amountIn: formatAmount(amountIn),
  ...(c.appKitKey ? { config: { kitKey: c.appKitKey } } : {}),
});

const toUnits = (decimal: string): bigint => {
  const [w, f = ""] = decimal.split(".");
  return BigInt(w!) * 1_000_000n + BigInt(f.padEnd(6, "0").slice(0, 6));
};

interface FxFollowUp { type: "fx_swap"; usdcAmount: string; status: "pending" | "swapped" | "done" | "failed"; attempts?: number; error?: string; swapTx?: string; eurcOut?: string; fundTx?: string }

/**
 * Runs pending FX follow-ups for executed FX decisions. State machine (idempotent across crashes):
 *   pending → swapped (swap submitted/finished, EURC in FX wallet) → done (EURC funded back to the treasury).
 * A refused quote leaves the decision `pending` with the reason (the USDC just sits in the FX wallet) and retries next
 * cycle; after 24 attempts it is marked failed for a human.
 */
export async function runFxFollowUps(c: FxCfg | null): Promise<number> {
  if (!c) return 0;
  const rows = await q<{ decision_id: string; follow_up: FxFollowUp }>(
    `select decision_id, follow_up from decisions
     where kind = 'FX' and state in ('executed','approved') and follow_up->>'type' = 'fx_swap' and follow_up->>'status' in ('pending','swapped')
     order by created_at limit 3`);
  const eurc = net(commonCfg.NETWORK).tokens.EURC as `0x${string}`;
  let done = 0;
  const dcw = initiateDeveloperControlledWalletsClient({ apiKey: c.circleApiKey, entitySecret: c.entitySecret });
  const save = (id: string, f: FxFollowUp) => q("update decisions set follow_up = $2 where decision_id = $1", [id, JSON.stringify(f)]);

  for (const d of rows) {
    const f = d.follow_up;
    try {
      if (f.status === "pending") {
        const amountIn = BigInt(f.usdcAmount);
        const est = await kit.estimateSwap(swapParams(c, amountIn) as never) as unknown as { estimatedOutput: { amount: string } };
        const quoted = toUnits(est.estimatedOutput.amount);
        const ref = await referencePrices();
        const verdict = checkRateBand(quoted, expectedEurcOut(amountIn, ref.usdc, ref.eurc), c.maxDeviationBps);
        if (!verdict.ok) {
          const attempts = (f.attempts ?? 0) + 1;
          log.warn({ decisionId: d.decision_id, reason: verdict.reason, attempts }, "FX swap refused by the rate band — USDC stays in the FX wallet");
          await save(d.decision_id, { ...f, attempts, status: attempts >= 24 ? "failed" : "pending", error: verdict.reason });
          continue;
        }
        if (verdict.warn) log.warn({ decisionId: d.decision_id }, verdict.warn);
        const res = (await kit.swap(swapParams(c, amountIn) as never)) as unknown as { txHash?: string; hash?: string };
        const eurcOut = (await pub.readContract({ address: eurc, abi: erc20, functionName: "balanceOf", args: [c.walletAddress] })) as bigint;
        f.status = "swapped"; f.swapTx = res.txHash ?? res.hash ?? undefined as never; f.eurcOut = eurcOut.toString();
        await save(d.decision_id, f);
      }

      // Return the EURC to the treasury (needs EURC to be a supported token on the contract: an ADMIN setting).
      const supported = (await pub.readContract({ address: TREASURY, abi: treasuryAbi, functionName: "supportedToken", args: [eurc] })) as boolean;
      if (!supported) { await save(d.decision_id, { ...f, error: "treasury does not support EURC yet — admin must call setSupportedToken(EURC, true)" }); continue; }
      const amount = (await pub.readContract({ address: eurc, abi: erc20, functionName: "balanceOf", args: [c.walletAddress] })) as bigint;
      if (amount === 0n) { await save(d.decision_id, { ...f, error: "no EURC in the FX wallet to return" }); continue; }
      const exec = async (contractAddress: string, sig: string, params: unknown[]) => {
        const r = await dcw.createContractExecutionTransaction({ walletId: c.walletId, contractAddress, abiFunctionSignature: sig, abiParameters: params as never, fee: { type: "level", config: { feeLevel: "MEDIUM" } } });
        const id = (r.data as unknown as { id: string }).id;
        for (let i = 0; i < 60; i++) {
          const t = (await dcw.getTransaction({ id })).data as unknown as { transaction?: { state: string; txHash?: string } };
          const st = t.transaction?.state;
          if (st === "COMPLETE" || st === "CONFIRMED") return t.transaction?.txHash ?? id;
          if (st === "FAILED" || st === "DENIED" || st === "CANCELLED") throw new Error(`DCW transaction ${id} ended ${st}`);
          await new Promise((r2) => setTimeout(r2, 4_000));
        }
        throw new Error(`DCW transaction ${id} did not finish in time`);
      };
      await exec(eurc, "approve(address,uint256)", [TREASURY, amount.toString()]);
      const fundTx = await exec(TREASURY, "fund(address,uint256,bytes32)", [eurc, amount.toString(), keccak256(stringToBytes("FX_PROCEEDS"))]);
      await save(d.decision_id, { ...f, status: "done", fundTx, error: undefined as never });
      done++;
    } catch (err) {
      log.error({ decisionId: d.decision_id, err: String(err) }, "FX follow-up failed — will retry next tick");
      await save(d.decision_id, { ...f, error: String(err).slice(0, 300) });
    }
  }
  return done;
}
