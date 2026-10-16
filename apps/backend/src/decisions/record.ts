// Phase 28 — one canonical decision record per validated item: what the agent saw, the forecast it ran,
// the rule it applied, its reasoning, and the action. Hashed and committed BEFORE anything moves.
import { canonicalRecord, type CanonicalRecord } from "@athena/shared/canonical";
import { actionHash, NO_ACTION, type Action } from "@athena/shared/action";
import type { Hex } from "viem";

export type DecisionKind =
  | "PAY_NOW" | "PAY_EARLY" | "SCHEDULE" | "HOLD"
  | "YIELD_DEPOSIT" | "YIELD_REDEEM" | "RESERVE" | "RELEASE_RESERVE"
  | "CONSOLIDATE" | "FX" | "TOP_UP_SERVICES";

/** Kinds that execute an on-chain action. Everything else commits actionHash = 0 (a no-op decision). */
export const ONCHAIN_KINDS: ReadonlySet<DecisionKind> = new Set([
  "PAY_NOW", "PAY_EARLY", "YIELD_DEPOSIT", "RESERVE", "RELEASE_RESERVE", "FX", "TOP_UP_SERVICES",
]);

export interface SerializedAction {
  kind: number; obligationId: string; payeeId: string; token: string;
  amount: string; maxFee: string; evidenceHash: string;
}
export const serializeAction = (a: Action): SerializedAction => ({
  kind: a.kind, obligationId: a.obligationId, payeeId: a.payeeId, token: a.token,
  amount: a.amount.toString(), maxFee: a.maxFee.toString(), evidenceHash: a.evidenceHash,
});
export const deserializeAction = (s: SerializedAction): Action => ({
  kind: s.kind, obligationId: s.obligationId as Hex, payeeId: s.payeeId as Hex, token: s.token as `0x${string}`,
  amount: BigInt(s.amount), maxFee: BigInt(s.maxFee), evidenceHash: s.evidenceHash as Hex,
});

export interface DecisionRecord {
  schema: "athena.decision.v1";
  decisionId: string;
  treasury: string; chainId: number; network: string;
  cycleId: string; seq: number;
  kind: DecisionKind;
  action: SerializedAction | null;
  actionHash: string;
  subject: {
    obligation: { id: string; payee: string; payeeId: string; invoiceNumber: string | null; amount: string; dueDate: string; terms: unknown } | null;
    treasury: { from: string; to: string; amount: string } | null;
  };
  saw: {
    block: string; snapshotHash: string; spendable: string; reserve: string;
    budget: { category: string; remaining: string; approvalLimit: string } | null;
  };
  forecast: { forecastHash: string; minBalanceStress: string; firstShortfall: string | null; runwayDays: number | null };
  rule: {
    policyVersion: string;
    checks: Array<{ name: string; passed: boolean; detail: string }>;
    discountAprBps: string | null; bestVaultApyBps: string | null; expectEscalation: string | null;
  };
  evidence: { evidenceHash: string | null; matchStatus: string | null };
  planner: {
    mode: "llm" | "default_policy"; model: string | null; proposed: unknown; rationale: string;
    alternativesConsidered: string[]; overruled: boolean; overruleReason: string | null; truncated: boolean;
  };
  followUp: unknown | null;
  createdAt: string;
}

// Exported and sorted: the worker refuses to start if a builder adds/removes a field without updating this.
export const DECISION_RECORD_FIELDS = [
  "action", "actionHash", "chainId", "createdAt", "cycleId", "decisionId", "evidence", "followUp", "forecast",
  "kind", "network", "planner", "rule", "saw", "schema", "seq", "subject", "treasury",
] as const;

const MAX_RECORD_BYTES = 12 * 1024;

export function assertRecordShape(r: DecisionRecord): void {
  const keys = Object.keys(r).sort();
  if (JSON.stringify(keys) !== JSON.stringify(DECISION_RECORD_FIELDS)) {
    throw new Error(`DecisionRecord fields (${keys.join(",")}) drifted from DECISION_RECORD_FIELDS`);
  }
}

export interface SealedDecision {
  record: DecisionRecord;
  canon: CanonicalRecord;
  actionHash: Hex;
}

/** Validates shape, caps size (truncating the reasoning first), canonicalizes and hashes. */
export function sealRecord(record: DecisionRecord, action: Action | null): SealedDecision {
  record.action = action ? serializeAction(action) : null;
  record.actionHash = action ? actionHash(action) : NO_ACTION;
  assertRecordShape(record);

  let canon = canonicalRecord(record);
  if (Buffer.byteLength(canon.json, "utf8") > MAX_RECORD_BYTES) {
    record.planner.rationale = record.planner.rationale.slice(0, 400);
    record.planner.alternativesConsidered = record.planner.alternativesConsidered.slice(0, 1).map((s) => s.slice(0, 120));
    record.planner.truncated = true;
    canon = canonicalRecord(record);
    if (Buffer.byteLength(canon.json, "utf8") > MAX_RECORD_BYTES) throw new Error("decision record exceeds 12 KB after truncation");
  }
  return { record, canon, actionHash: record.actionHash as Hex };
}
