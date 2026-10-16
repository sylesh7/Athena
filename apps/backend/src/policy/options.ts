// Phase 25.4–25.6 — the options menu and the DEFAULT plan. The default plan is complete on its own: the system
// works with no model at all. The LLM planner (Phase 26) only chooses among the options listed here.
import { discountAprBps, discountedAmount, earlyPayAllowed } from "./discount.js";
import { addDays } from "../forecast/forecast.js";

export type Choice = "PAY_NOW" | "PAY_EARLY" | "SCHEDULE" | "HOLD";

export interface ObligationInput {
  obligationId: string;
  payeeName: string;
  category: string;
  token: "USDC" | "EURC";
  amount: bigint;
  dueDate: string;
  invoiceDate: string | null;
  criticality: number;
  terms: { netDays?: number; discountBps?: number; discountDays?: number } | null;
  payable: { ok: boolean; reason?: "cooling_down" | "suspended" | "not_active" | "risk_hold" };
  scorecard: number; // 0-100
  /** Budget this obligation draws on (from the snapshot). */
  budget: { remaining: bigint; approvalLimit: bigint } | null;
  payeeCap: bigint; // 0 = none
}

export interface ObligationOptions {
  obligationId: string;
  payeeName: string;
  category: string;
  token: string;
  amount: string;
  dueDate: string;
  daysToDue: number;
  payable: ObligationInput["payable"];
  allowed: Choice[];
  payEarly?: { discountedAmount: string; aprBps: string; windowEnds: string };
  expectEscalation?: "TX_LIMIT" | "PAYEE_CAP" | "BUDGET";
  defaultChoice: Choice;
  defaultReason: string;
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export function buildOptions(args: {
  today: string;
  obligations: ObligationInput[];
  spendable: { USDC: bigint; EURC: bigint };
  bestVaultApyBps: bigint;
  earlyPayMarginBps: bigint;
}): ObligationOptions[] {
  return args.obligations.map((o) => {
    const daysToDue = daysBetween(args.today, o.dueDate);
    const allowed: Choice[] = ["HOLD"];
    const cash = args.spendable[o.token];

    let payEarly: ObligationOptions["payEarly"];
    if (o.payable.ok) {
      allowed.push("SCHEDULE");
      if (daysToDue <= 2 && cash >= o.amount) allowed.push("PAY_NOW");
      const t = o.terms;
      if (t?.discountBps && t.discountDays && t.netDays && o.invoiceDate) {
        const apr = discountAprBps(BigInt(t.discountBps), t.discountDays, t.netDays);
        const since = daysBetween(o.invoiceDate, args.today);
        const disc = discountedAmount(o.amount, BigInt(t.discountBps));
        if (
          earlyPayAllowed({ daysSinceInvoice: since, discountDays: t.discountDays, aprBps: apr, bestVaultApyBps: args.bestVaultApyBps, marginBps: args.earlyPayMarginBps }) &&
          cash >= disc
        ) {
          allowed.push("PAY_EARLY");
          payEarly = { discountedAmount: disc.toString(), aprBps: apr.toString(), windowEnds: addDays(o.invoiceDate, t.discountDays) };
        }
      }
    }

    let expectEscalation: ObligationOptions["expectEscalation"];
    if (o.budget) {
      if (o.budget.approvalLimit !== 0n && o.amount > o.budget.approvalLimit) expectEscalation = "TX_LIMIT";
      else if (o.payeeCap !== 0n && o.amount > o.payeeCap) expectEscalation = "PAYEE_CAP";
      else if (o.amount > o.budget.remaining) expectEscalation = "BUDGET";
    }

    let defaultChoice: Choice;
    let defaultReason: string;
    if (!o.payable.ok) {
      defaultChoice = "HOLD"; defaultReason = `payee not payable (${o.payable.reason ?? "unknown"})`;
    } else if (allowed.includes("PAY_NOW")) {
      defaultChoice = "PAY_NOW"; defaultReason = daysToDue < 0 ? `overdue by ${-daysToDue} days` : `due in ${daysToDue} days and cash covers it`;
    } else if (daysToDue <= 2) {
      defaultChoice = "HOLD"; defaultReason = "due within 2 days but spendable cash does not cover it";
    } else {
      defaultChoice = "SCHEDULE"; defaultReason = `not due for ${daysToDue} days; schedule for the due date`;
    }

    return {
      obligationId: o.obligationId, payeeName: o.payeeName, category: o.category, token: o.token,
      amount: o.amount.toString(), dueDate: o.dueDate, daysToDue, payable: o.payable, allowed,
      ...(payEarly ? { payEarly } : {}), ...(expectEscalation ? { expectEscalation } : {}), defaultChoice, defaultReason,
    };
  });
}

/**
 * Phase 25.4 default order: criticality (1 first) → payee scorecard (better first) → due date (earlier first).
 * The planner may reorder with a reason; the validator enforces the hard criticality rule.
 */
export function defaultOrder(obligations: ObligationInput[]): string[] {
  return [...obligations]
    .sort((a, b) => a.criticality - b.criticality || b.scorecard - a.scorecard || a.dueDate.localeCompare(b.dueDate))
    .map((o) => o.obligationId);
}
