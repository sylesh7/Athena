/**
 * lib/compliance.ts — v2: real-time address screening via Circle's
 * Compliance Engine, before a stream is ever allowed to start.
 *
 * Previously-unused piece of the Circle stack — verified live against the
 * real API (not guessed from the OpenAPI spec alone):
 *   curl -s https://developers.circle.com/openapi/compliance.yaml
 * then a real POST with our existing CIRCLE_API_KEY, which confirmed two
 * things the spec alone didn't make obvious:
 *
 * 1. Arc / Arc Testnet is NOT in the API's `chain` enum yet (it's a fixed
 *    list: ETH, ETH-SEPOLIA, MATIC-AMOY, ARB-SEPOLIA, SOL, BTC, etc. — no
 *    ARC). Address screening is a risk/reputation lookup on the address
 *    itself (sanctions lists, known illicit associations), not chain-specific
 *    on-chain activity, so passing any EVM-format chain code is a legitimate,
 *    honest way to screen an Arc address — not a hack. We use
 *    "ETH-SEPOLIA" since Athena only ever runs on testnets.
 * 2. Our sandbox `TEST_API_KEY` only accepts TESTNET chain codes — mainnet
 *    codes (MATIC, ARB, ETH) correctly 400 with "Unsupported blockchain".
 *    Confirmed by testing both live before writing this file.
 *
 * Why this matters for Athena specifically: the project's own pitch is
 * about broker-side trust and fraud accountability. Screening every client
 * address before committing a bond and starting a stream is a direct,
 * real answer to that — not cosmetic.
 */

const COMPLIANCE_API_URL = "https://api.circle.com/v1/w3s/compliance/screening/addresses";

// Any EVM testnet code works identically here (see header comment) — pick one
// fixed value so results are consistent and comparable across screenings.
const SCREENING_CHAIN = "ETH-SEPOLIA";

export type ScreeningResult = "APPROVED" | "DENIED";

export interface ScreeningDecision {
  result: ScreeningResult;
  address: string;
  screeningDate: string;
  ruleName?: string;
  actions?: string[];
  id: string;
}

/**
 * Screens a blockchain address via Circle's Compliance Engine. Throws on a
 * genuine API/network failure (caller decides whether to fail open or
 * closed) rather than silently defaulting to "approved" — a screening
 * check that fails silently is worse than no screening check at all.
 */
export async function screenAddress(address: string): Promise<ScreeningDecision> {
  const apiKey = process.env.CIRCLE_API_KEY;
  if (!apiKey) throw new Error("CIRCLE_API_KEY not set — cannot screen address");

  const res = await fetch(COMPLIANCE_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      idempotencyKey: crypto.randomUUID(),
      address,
      chain: SCREENING_CHAIN,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Circle compliance screening failed (${res.status}): ${body}`);
  }

  const json = (await res.json()) as {
    data: {
      result: ScreeningResult;
      address: string;
      id: string;
      decision: { screeningDate: string; ruleName?: string; actions?: string[] };
    };
  };

  return {
    result: json.data.result,
    address: json.data.address,
    screeningDate: json.data.decision.screeningDate,
    ruleName: json.data.decision.ruleName,
    actions: json.data.decision.actions,
    id: json.data.id,
  };
}
