// Pure LLM cost math (no env/db imports so it is unit-testable). All money is integer micro-USD (1e-6 USD).
// Prices are ESTIMATES used only to protect the budget; a model id not listed here gets a deliberately HIGH fallback so
// an unknown model is never under-counted. Integer "micro-USD per million tokens" (e.g. $0.15 per 1M = 150_000).
const PER_MILLION: Record<string, { in: bigint; out: bigint }> = {
  "gpt-4o-mini": { in: 150_000n, out: 600_000n }, // $0.15 / $0.60 per 1M
  "gpt-4.1-nano": { in: 100_000n, out: 400_000n }, // $0.10 / $0.40
  "gpt-4.1-mini": { in: 400_000n, out: 1_600_000n }, // $0.40 / $1.60
  "gpt-5-nano": { in: 50_000n, out: 400_000n }, // $0.05 / $0.40
  "gpt-5-mini": { in: 250_000n, out: 2_000_000n }, // $0.25 / $2.00
  "claude-haiku-4-5-20251001": { in: 1_000_000n, out: 5_000_000n },
};
// Unknown model ⇒ assume expensive ($5 in / $20 out per 1M) so the cap trips early rather than late.
export const FALLBACK_PER_MILLION = { in: 5_000_000n, out: 20_000_000n };

export function pricePerMillion(model: string, override?: { in: bigint; out: bigint }) {
  return override ?? PER_MILLION[model] ?? FALLBACK_PER_MILLION;
}

/** Cost in micro-USD, rounded UP (never under-counts). */
export function costMicroUsd(model: string, inputTokens: number, outputTokens: number, override?: { in: bigint; out: bigint }): bigint {
  const p = pricePerMillion(model, override);
  const num = BigInt(Math.max(0, inputTokens)) * p.in + BigInt(Math.max(0, outputTokens)) * p.out;
  return (num + 999_999n) / 1_000_000n;
}

/** Rough pre-call token estimate for text (≈ 1 token per 3 chars, pessimistic). PDFs: assume 2,500 tokens per ~100 KB. */
export function estimateInputTokens(textChars: number, pdfBase64Chars = 0): number {
  return Math.ceil(textChars / 3) + Math.ceil((pdfBase64Chars * 3 / 4) / 100_000 * 2_500) + 200;
}

export const usd = (micro: bigint): string => `$${(Number(micro) / 1_000_000).toFixed(4)}`;
export const toMicro = (usdAmount: number): bigint => BigInt(Math.round(usdAmount * 1_000_000));

export type BudgetVerdict = { ok: true } | { ok: false; reason: string };

/** Refuse when this call's WORST-CASE cost would push total or today's spend past the caps. */
export function checkBudget(args: {
  spentTotal: bigint; spentToday: bigint; worstCase: bigint; capTotal: bigint; capDaily: bigint;
}): BudgetVerdict {
  if (args.spentTotal + args.worstCase > args.capTotal) {
    return { ok: false, reason: `total LLM budget ${usd(args.capTotal)} would be exceeded (spent ${usd(args.spentTotal)}, this call up to ${usd(args.worstCase)})` };
  }
  if (args.spentToday + args.worstCase > args.capDaily) {
    return { ok: false, reason: `daily LLM budget ${usd(args.capDaily)} would be exceeded (today ${usd(args.spentToday)}, this call up to ${usd(args.worstCase)})` };
  }
  return { ok: true };
}
