// Phase 24.2 — Circle Compliance Engine screening. Response shape verified live in v1 (backend/lib/compliance.ts):
// { data: { result: "APPROVED"|"DENIED", id, address, decision: { screeningDate, ruleName?, actions? } } }.
// The API only reports APPROVED/DENIED plus rule/actions, so tiers are mapped conservatively from those.
// An unavailable screen NEVER counts as a pass.
import { randomUUID } from "node:crypto";
import { commonCfg } from "../config.js";
import { q } from "../db.js";
import { toTier, type RiskTier } from "./tiers.js";

export { RESCREEN_DAYS, toTier, type RiskTier } from "./tiers.js";

export interface Screening {
  id: string;
  result: "APPROVED" | "DENIED";
  ruleName?: string;
  actions?: string[];
  tier: RiskTier;
  screenedAt: string;
}

// Circle's sandbox key only accepts testnet chain codes and Arc is not yet in the enum; address screening is a
// risk lookup on the address itself, so a fixed EVM code is used (see v1 compliance.ts).
const chainCode = () => (commonCfg.NETWORK === "testnet" ? "ETH-SEPOLIA" : "ETH");

export async function screen(address: string, apiKey: string): Promise<Screening> {
  const res = await fetch("https://api.circle.com/v1/w3s/compliance/screening/addresses", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ idempotencyKey: randomUUID(), address, chain: chainCode() }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`screening unavailable: ${res.status}`); // unavailable ⇒ treat as not screened
  const body = (await res.json()) as {
    data: { id: string; result: "APPROVED" | "DENIED"; decision: { screeningDate: string; ruleName?: string; actions?: string[] } };
  };
  const { id, result, decision } = body.data;
  const tier = toTier(result, decision.ruleName, decision.actions);
  await q("insert into screenings(address, chain, result, risk_tier, raw) values ($1,$2,$3,$4,$5)", [address, chainCode(), result, tier, JSON.stringify(body)]);
  return { id, result, ...(decision.ruleName ? { ruleName: decision.ruleName } : {}), ...(decision.actions ? { actions: decision.actions } : {}), tier, screenedAt: decision.screeningDate };
}
