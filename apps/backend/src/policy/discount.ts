// Phase 25.1 — early-payment discount as an annual rate. Integer math only.

/** Annualized return of taking a discount, in basis points: (d / (1 − d)) × (365 / days). */
export function discountAprBps(discountBps: bigint, discountDays: number, netDays: number): bigint {
  const days = BigInt(netDays - discountDays);
  if (days <= 0n || discountBps <= 0n || discountBps >= 10_000n) return 0n;
  return (discountBps * 10_000n * 365n) / ((10_000n - discountBps) * days);
}

/** Amount to pay when taking the discount; exact bigint math, rounds the discount DOWN (never over-discounts). */
export function discountedAmount(amount: bigint, discountBps: bigint): bigint {
  return amount - (amount * discountBps) / 10_000n;
}

/**
 * Early payment is allowed when (1) today is inside the discount window, (2) the discount APR beats the best
 * vault APY by `marginBps`, and the caller separately confirms (3) paying early keeps the stress forecast >= 0.
 */
export function earlyPayAllowed(args: {
  daysSinceInvoice: number;
  discountDays: number;
  aprBps: bigint;
  bestVaultApyBps: bigint;
  marginBps: bigint;
}): boolean {
  return (
    args.daysSinceInvoice >= 0 &&
    args.daysSinceInvoice <= args.discountDays &&
    args.aprBps > args.bestVaultApyBps + args.marginBps
  );
}
