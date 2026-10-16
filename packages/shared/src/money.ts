// All amounts are bigint atomic units. 1 USDC = 1_000_000n. 1 EURC = 1_000_000n.
export const TOKEN_DECIMALS = 6 as const;

export class AmountError extends Error {}

/** Parse a human decimal string into atomic units. Refuses anything ambiguous; never rounds. */
export function parseAmount(input: string, decimals: number = TOKEN_DECIMALS): bigint {
  const s = input.trim();
  const strict = new RegExp(`^(0|[1-9]\\d{0,14})(\\.\\d{1,${decimals}})?$`);
  if (!strict.test(s)) {
    throw new AmountError(`Refused amount "${input}": expected up to ${decimals} decimals, no separators, no sign`);
  }
  const [whole, frac = ""] = s.split(".");
  return BigInt(whole!) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0"));
}

/** Format atomic units for display. Never use the result for arithmetic. */
export function formatAmount(units: bigint, decimals: number = TOKEN_DECIMALS): string {
  const neg = units < 0n;
  const abs = neg ? -units : units;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

/** Postgres numeric comes back as a string; never let it become a JS number. */
export const fromDb = (v: string | null | undefined): bigint => (v === null || v === undefined ? 0n : BigInt(v));
export const toDb = (v: bigint): string => v.toString();

export const bps = (amount: bigint, b: bigint): bigint => (amount * b) / 10_000n;
