// Pure message formatting (no env/db imports so it is unit-testable).
import { formatAmount } from "@athena/shared/money";

const REASONS = ["", "over the period budget", "over the per-payment approval limit", "over this payee's cap", "would breach the operating floor"];

export function escalationMessage(args: {
  record: { kind: string; action: { amount: string; token: string } | null; subject: { obligation: { payee: string } | null }; planner: { rationale: string } };
  reason: number; expiresAt: Date; decisionId: string; frontendUrl: string; tokenSymbol: (addr: string) => string;
}): string {
  const r = args.record;
  const amount = r.action ? `${formatAmount(BigInt(r.action.amount))} ${args.tokenSymbol(r.action.token)}` : "";
  return [
    "Athena needs a decision",
    `${r.subject.obligation?.payee ?? r.kind}: ${amount}`.trim(),
    `Why it escalated: ${REASONS[args.reason] ?? `reason ${args.reason}`}`,
    `Agent's reasoning: ${r.planner.rationale.slice(0, 300)}`,
    `Expires: ${args.expiresAt.toISOString()}`,
    `Review: ${args.frontendUrl}/approvals?decision=${args.decisionId}`,
  ].join("\n");
}

