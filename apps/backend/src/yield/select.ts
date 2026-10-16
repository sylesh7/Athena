// Phase 31 — pure vault discovery scoring and sweep sizing (no env/db/sdk imports, so it is unit-testable).
// APYs are converted to integer basis points ONCE here and handled as integers afterwards. Decimal-string amounts from the
// SDK (e.g. "1000000.0") are parsed strictly into atomic units; anything unparseable makes the vault ineligible.
import { parseAmount, AmountError } from "@athena/shared/money";

/** The fields of an Earn Kit vault we rely on (verified against a live `exploreVaults` response on Arc testnet). */
export interface RawVault {
  vaultAddress: string;
  name?: string | null;
  protocol?: string;
  asset?: string;
  status?: string;
  circleGuarded?: boolean;
  currentApy?: number | null;
  apyProfile?: { current?: number | null; d7?: number | null; d30?: number | null } | null;
  riskSignals?: { warnings?: string[]; earnKitWarnings?: string[] } | null;
  liquidityProfile?: { available?: string | null } | null;
  liquidity?: string | null;
}

export interface VaultCandidate {
  vault: string;
  name: string | null;
  protocol: string | null;
  conservativeApyBps: number;
  currentApyBps: number;
  d7ApyBps: number | null;
  d30ApyBps: number | null;
  availableLiquidity: string; // atomic units
  circleGuarded: boolean;
}

const toBps = (apy: number): number => Math.floor(apy * 10_000);

/** SDK amounts are decimal strings like "1000000.0"; trim trailing zeros then parse strictly (>6 decimals ⇒ ineligible). */
function liquidityUnits(v: RawVault): bigint | null {
  const raw = v.liquidityProfile?.available ?? v.liquidity ?? null;
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim();
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/.$/, "");
  try {
    return parseAmount(s);
  } catch (e) {
    if (e instanceof AmountError) return null;
    throw e;
  }
}

/**
 * Filters and ranks vaults:
 *  - active, USDC only, no risk warnings of any kind;
 *  - available liquidity ≥ `liquidityMultiple` × the intended deposit (so the money can come back out);
 *  - APY is planned CONSERVATIVELY: the lowest of current / 7-day / 30-day that is known.
 * Returns the top `limit`, best conservative APY first (ties: deeper liquidity first).
 */
export function selectVaults(vaults: RawVault[], intendedDeposit: bigint, opts: { liquidityMultiple?: bigint; limit?: number } = {}): VaultCandidate[] {
  const multiple = opts.liquidityMultiple ?? 3n;
  const out: VaultCandidate[] = [];
  for (const v of vaults) {
    if (v.status !== undefined && v.status !== "active") continue;
    if (v.asset !== undefined && v.asset.toUpperCase() !== "USDC") continue;
    const warnings = [...(v.riskSignals?.warnings ?? []), ...(v.riskSignals?.earnKitWarnings ?? [])];
    if (warnings.length > 0) continue;
    const liq = liquidityUnits(v);
    if (liq === null || liq < intendedDeposit * multiple) continue;

    const cur = v.apyProfile?.current ?? v.currentApy ?? null;
    const d7 = v.apyProfile?.d7 ?? null;
    const d30 = v.apyProfile?.d30 ?? null;
    const known = [cur, d7, d30].filter((x): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0);
    if (known.length === 0) continue;

    out.push({
      vault: v.vaultAddress, name: v.name ?? null, protocol: v.protocol ?? null,
      conservativeApyBps: toBps(Math.min(...known)),
      currentApyBps: toBps(cur ?? Math.min(...known)),
      d7ApyBps: d7 === null ? null : toBps(d7), d30ApyBps: d30 === null ? null : toBps(d30),
      availableLiquidity: liq.toString(), circleGuarded: Boolean(v.circleGuarded),
    });
  }
  out.sort((a, b) => b.conservativeApyBps - a.conservativeApyBps || (BigInt(b.availableLiquidity) > BigInt(a.availableLiquidity) ? 1 : -1));
  return out.slice(0, opts.limit ?? 5);
}

/**
 * Phase 25.2 surplus: cash not needed within the yield horizon under the STRESS case, above the floor and a buffer.
 *   surplus = max(0, minStressBalanceWithinHorizon − buffer),  buffer = max(minOperating, 10% of next-30-day outflows)
 */
export function surplusUnits(args: { minStressBalanceInHorizon: bigint; minOperating: bigint; next30DayOutflows: bigint }): bigint {
  const tenPct = args.next30DayOutflows / 10n;
  const buffer = args.minOperating > tenPct ? args.minOperating : tenPct;
  const s = args.minStressBalanceInHorizon - buffer;
  return s > 0n ? s : 0n;
}

/**
 * How much to sweep and where. Deterministic default policy (the LLM is not needed to be safe):
 *   amount = min(surplus, YIELD budget remaining), only if ≥ minSweep; vault = best conservative APY that still has
 *   3× liquidity for that amount, with concentration capped at 60% of total yield once two or more candidates exist.
 */
export function planSweep(args: {
  surplus: bigint; budgetRemaining: bigint; minSweep: bigint;
  vaults: RawVault[]; positions: Array<{ vault: string; value: bigint }>;
}): { amount: bigint; vault: VaultCandidate; rationale: string } | null {
  const amount = args.surplus < args.budgetRemaining ? args.surplus : args.budgetRemaining;
  if (amount < args.minSweep) return null;
  const candidates = selectVaults(args.vaults, amount);
  if (candidates.length === 0) return null;

  const total = args.positions.reduce((a, p) => a + p.value, 0n) + amount;
  const held = new Map(args.positions.map((p) => [p.vault.toLowerCase(), p.value]));
  const pick = candidates.find((c) => candidates.length < 2 || ((held.get(c.vault.toLowerCase()) ?? 0n) + amount) * 100n <= total * 60n) ?? candidates[0]!;
  const rationale =
    `Surplus ${amount} atomic units is idle under the stress forecast; ${pick.name ?? pick.vault} offers ${pick.conservativeApyBps} bps ` +
    `(conservative = lowest of current/7d/30d) with ${pick.availableLiquidity} available liquidity (≥3× the deposit).`;
  return { amount, vault: pick, rationale };
}

/**
 * Phase 25.3 redemption need: when the STRESS forecast dips below zero (or below the floor) inside the horizon, bring money
 * home from yield. Returns how much to redeem and from which position (largest first), capped by what the positions hold.
 */
export function planRedeem(args: {
  minStressBalance: bigint; buffer: bigint; positions: Array<{ vault: string; value: bigint }>;
}): { amount: bigint; vault: string; rationale: string } | null {
  const need = args.buffer - args.minStressBalance; // how far below the buffer the stress case falls
  if (need <= 0n) return null;
  const sorted = [...args.positions].filter((p) => p.value > 0n).sort((a, b) => (b.value > a.value ? 1 : -1));
  if (sorted.length === 0) return null;
  const top = sorted[0]!;
  const amount = need < top.value ? need : top.value;
  return { amount, vault: top.vault, rationale: `Stress forecast falls ${need} atomic units short of the buffer; redeeming ${amount} from the largest position.` };
}
