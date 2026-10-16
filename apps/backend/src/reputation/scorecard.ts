// Phase 39 — the vendor scorecard. Pure (no env/db imports). The agent remembers which vendors behaved, from what actually
// happened, and that memory changes its decisions: payment priority under a shortfall (policy/options.ts reads the score) and a
// tighter on-chain cap for a risky vendor. Weights follow the README: on-time 30, invoice accuracy 25, duplicates 20,
// address changes 10, mismatches 15 (sum 100).
//
// "On-time delivery" needs expected delivery dates that the schema does not hold yet, so it is reported as `null` and
// scored at full marks until the data exists — the other four signals are real.

export interface VendorStats {
  invoices: number; // invoices received from this vendor (excluding exact re-uploads of the same file)
  matchedFirstTry: number; // invoices whose match was `matched` on the first pass
  duplicateAttempts: number; // holds with reason duplicate / probable_duplicate / usage over-claim
  addressChanges90d: number; // intercepted payout-address changes in the last 90 days
  mismatches: number; // holds with reason mismatch
  onTimeRate: number | null; // 0..1 when delivery dates are available, else null
}

export interface Scorecard {
  score: number; // 0–100
  components: { onTime: number; accuracy: number; duplicates: number; addressChanges: number; mismatches: number };
  basis: VendorStats;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

export function scoreVendor(s: VendorStats): Scorecard {
  const n = Math.max(s.invoices, 0);
  const accuracy = n === 0 ? 25 : 25 * clamp(s.matchedFirstTry / n, 0, 1);
  const onTime = s.onTimeRate === null ? 30 : 30 * clamp(s.onTimeRate, 0, 1);
  const duplicates = 20 - clamp(10 * s.duplicateAttempts, 0, 20);
  const addressChanges = 10 - clamp(5 * s.addressChanges90d, 0, 10);
  const mismatches = n === 0 ? 15 : 15 * (1 - clamp(s.mismatches / n, 0, 1));
  const components = { onTime: round1(onTime), accuracy: round1(accuracy), duplicates: round1(duplicates), addressChanges: round1(addressChanges), mismatches: round1(mismatches) };
  const score = Math.round(onTime + accuracy + duplicates + addressChanges + mismatches);
  return { score: clamp(score, 0, 100), components, basis: s };
}

/** Below this the operator proposes a tighter payee cap on-chain (it can tighten, never loosen). */
export const TIGHTEN_BELOW = 50;

/**
 * Target cap for a risky vendor: half the category's per-payment approval limit. Returns null when no tightening is possible
 * or needed (score fine, no approval limit to halve, or the current cap is already at or below the target).
 */
export function tightenedCap(args: { score: number; categoryApprovalLimit: bigint; currentCap: bigint }): bigint | null {
  if (args.score >= TIGHTEN_BELOW) return null;
  const target = args.categoryApprovalLimit / 2n;
  if (target === 0n) return null;
  if (args.currentCap !== 0n && args.currentCap <= target) return null; // the contract refuses non-tightening changes anyway
  return target;
}

/** 0–100 score from a human agreement rate in bps (null ⇒ nothing to report). */
export const scoreFromAgreementBps = (bps: number | null): number | null => (bps === null ? null : Math.max(0, Math.min(100, Math.round(bps / 100))));
