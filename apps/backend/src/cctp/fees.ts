// Phase 33.1 — CCTP V2 fast-transfer fee math. Pure and integer-only. The fee comes OUT of the burned amount, so the
// action is grossed up (amount = invoice + fee) and the vendor receives exactly the invoiced amount.

/** fee = ceil(invoice × feeBps / 10000) + 1 unit (rounding headroom). */
export function quoteFee(invoiceAmount: bigint, feeBps: bigint): bigint {
  return (invoiceAmount * feeBps + 9_999n) / 10_000n + 1n;
}

export interface CrossChainAmounts { amount: bigint; maxFee: bigint }

/**
 * Returns null when the fee would exceed the contract's `maxCctpFeeBps` cap — the option is then not offered and the
 * obligation is held with reason `cctp_fee_above_cap`. The contract enforces the same bound (FeeTooHigh), so this just
 * avoids committing a decision that would revert.
 */
export function grossUp(invoiceAmount: bigint, feeBps: bigint, contractMaxFeeBps: bigint): CrossChainAmounts | null {
  const maxFee = quoteFee(invoiceAmount, feeBps);
  const amount = invoiceAmount + maxFee;
  if (maxFee >= amount) return null;
  // contract check: maxFee * 10000 <= amount * maxCctpFeeBps
  if (maxFee * 10_000n > amount * contractMaxFeeBps) return null;
  return { amount, maxFee };
}

/** Left-pad a 20-byte address to the bytes32 mint recipient CCTP expects. */
export function toBytes32Address(addr: string): `0x${string}` {
  const hex = addr.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{40}$/.test(hex)) throw new Error(`not a 20-byte address: ${addr}`);
  return `0x${hex.padStart(64, "0")}`;
}
