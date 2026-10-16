// Phase 34 — pure FX math (no env/db/sdk imports). Integer arithmetic on 6-decimal atomic units; prices are USD per token
// and arrive as decimal strings from the reference feed (App Kit getTokenRates), parsed to micro-USD integers.

/** "1.1260296426" → 1_126_029n (micro-USD, truncated). Throws on anything that is not a positive decimal. */
export function toMicroUsd(price: string): bigint {
  if (!/^\d+(\.\d+)?$/.test(price)) throw new Error(`bad price "${price}"`);
  const [w, f = ""] = price.split(".");
  const v = BigInt(w!) * 1_000_000n + BigInt(f.padEnd(6, "0").slice(0, 6));
  if (v <= 0n) throw new Error(`non-positive price "${price}"`);
  return v;
}

/** EURC atomic units expected for `usdcIn` at the reference prices: usdcIn × usdcPrice / eurcPrice. */
export function expectedEurcOut(usdcIn: bigint, usdcPriceMicro: bigint, eurcPriceMicro: bigint): bigint {
  return (usdcIn * usdcPriceMicro) / eurcPriceMicro;
}

/** USDC needed to buy `eurcNeed` at the reference prices, rounded UP, plus a safety margin in bps (covers fees/slippage). */
export function usdcForEurc(eurcNeed: bigint, usdcPriceMicro: bigint, eurcPriceMicro: bigint, marginBps: bigint): bigint {
  const base = (eurcNeed * eurcPriceMicro + usdcPriceMicro - 1n) / usdcPriceMicro;
  return (base * (10_000n + marginBps) + 9_999n) / 10_000n;
}

/**
 * Signed deviation of a quote from the reference, in bps of the reference: negative = the quote is WORSE than reference.
 * Only a worse quote is refused: a better-than-reference quote costs us nothing (it is reported as a warning upstream,
 * since testnet pools are sometimes mispriced). Stablecoin pairs sitting far from reference mean something is off.
 */
export function deviationBps(quotedOut: bigint, referenceOut: bigint): bigint {
  if (referenceOut <= 0n) throw new Error("reference output must be positive");
  return ((quotedOut - referenceOut) * 10_000n) / referenceOut;
}

export type BandVerdict = { ok: true; deviationBps: bigint; warn?: string } | { ok: false; deviationBps: bigint; reason: string };

export function checkRateBand(quotedOut: bigint, referenceOut: bigint, maxWorseBps: bigint): BandVerdict {
  const dev = deviationBps(quotedOut, referenceOut);
  if (dev < -maxWorseBps) return { ok: false, deviationBps: dev, reason: `quote is ${-dev} bps worse than the reference rate (limit ${maxWorseBps} bps)` };
  if (dev > maxWorseBps * 20n) return { ok: true, deviationBps: dev, warn: `quote is ${dev} bps BETTER than the reference — likely a mispriced pool; proceeding` };
  return { ok: true, deviationBps: dev };
}

/** EURC obligations due within the horizon minus spendable EURC minus the EURC floor; ≤ 0 means no need. */
export function eurcNeed(args: { dueSoon: bigint; spendable: bigint; floor: bigint }): bigint {
  const need = args.dueSoon + args.floor - args.spendable - 0n;
  return need > 0n ? need : 0n;
}
