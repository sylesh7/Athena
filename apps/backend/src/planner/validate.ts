// Phase 27 — every item the planner proposes is re-checked by code. Infeasible items are replaced with the safe
// default and the overrule is recorded. The model proposes; this layer (then the contract) disposes.
import { forecast, addDays, type ForecastInputs } from "../forecast/forecast.js";
import type { Choice, ObligationOptions } from "../policy/options.js";

export interface PlannedObligation {
  obligationId: string;
  choice: Choice;
  plannedDate: string | null;
  rationale: string;
  alternativesConsidered: string[];
}
export interface ProposedPlan {
  summary: string;
  obligations: PlannedObligation[];
  payOrder: string[];
}

export interface Check { name: string; passed: boolean; detail: string }
export interface ValidatedObligation {
  obligationId: string;
  proposed: PlannedObligation | null;
  final: { choice: Choice; plannedDate: string | null; amount: bigint };
  overruled: boolean;
  overruleReason: string | null;
  checks: Check[];
}
export interface ValidatedPlan {
  items: ValidatedObligation[];
  payOrder: string[];
  checks: Check[];
}

const isoDate = (d: string | null) => d !== null && /^\d{4}-\d{2}-\d{2}$/.test(d);

export function validateObligationPlan(args: {
  today: string;
  proposed: ProposedPlan;
  options: ObligationOptions[];
  criticality: Record<string, number>;
  defaultOrder: string[];
  base: ForecastInputs; // forecast inputs WITHOUT the obligations being planned
  horizon: number;
  stressDelayDays: number;
  haircutBps: bigint;
}): ValidatedPlan {
  const byId = new Map(args.proposed.obligations.map((p) => [p.obligationId, p]));
  const items: ValidatedObligation[] = [];

  for (const opt of args.options) {
    const p = byId.get(opt.obligationId) ?? null;
    const checks: Check[] = [];
    let choice: Choice = p?.choice ?? opt.defaultChoice;
    let plannedDate: string | null = p?.plannedDate ?? null;
    let overruled = false;
    let reason: string | null = null;
    const overrule = (r: string, c: Choice, d: string | null = null) => { choice = c; plannedDate = d; overruled = true; reason = r; };

    if (!p) { checks.push({ name: "planned", passed: false, detail: "planner omitted this obligation; default applied" }); overruled = true; reason = "omitted by planner"; }
    const allowed = opt.allowed.includes(choice);
    checks.push({ name: "choice_allowed", passed: allowed, detail: `${choice} ∈ [${opt.allowed.join(",")}]` });
    if (!allowed) overrule(`${choice} is not an allowed option (${opt.allowed.join(",")})`, opt.defaultChoice);

    if (choice === "SCHEDULE") {
      const ok = isoDate(plannedDate) && plannedDate! >= args.today && plannedDate! <= opt.dueDate;
      checks.push({ name: "schedule_window", passed: ok, detail: `${plannedDate} within [${args.today}, ${opt.dueDate}]` });
      if (!ok) { const fallback = opt.dueDate > args.today ? addDays(opt.dueDate, -1) : args.today; plannedDate = fallback < args.today ? args.today : fallback; if (p) { overruled = true; reason = "schedule date outside [today, dueDate]"; } }
    } else if (choice === "PAY_NOW" || choice === "PAY_EARLY") {
      plannedDate = args.today;
    } else {
      plannedDate = null;
    }

    const amount = choice === "PAY_EARLY" && opt.payEarly ? BigInt(opt.payEarly.discountedAmount) : BigInt(opt.amount);
    items.push({ obligationId: opt.obligationId, proposed: p, final: { choice, plannedDate, amount }, overruled, overruleReason: reason, checks });
  }

  // Hard rule: a criticality-1 obligation may not be held while a lower-criticality one is paid, if paying it was feasible.
  const paying = (i: ValidatedObligation) => i.final.choice === "PAY_NOW" || i.final.choice === "PAY_EARLY";
  for (const it of items) {
    const crit = args.criticality[it.obligationId] ?? 2;
    if (crit !== 1 || it.final.choice !== "HOLD") continue;
    const opt = args.options.find((o) => o.obligationId === it.obligationId)!;
    const lowerPaid = items.some((o) => paying(o) && (args.criticality[o.obligationId] ?? 2) > 1);
    const feasible = opt.allowed.includes("PAY_NOW");
    const bad = lowerPaid && feasible && opt.daysToDue <= 0;
    it.checks.push({ name: "criticality_rule", passed: !bad, detail: bad ? "criticality-1 held past due while lower priority was paid" : "ok" });
    if (bad) { it.final = { choice: "PAY_NOW", plannedDate: args.today, amount: BigInt(opt.amount) }; it.overruled = true; it.overruleReason = "criticality-1 obligation cannot be held past due while lower-criticality items are paid"; }
  }

  // Combined feasibility: re-run the forecast with the chosen placements; shed lowest-priority optional payments until stress >= 0.
  // The forecast is USDC-denominated: EURC obligations are not placed on it.
  const placements = (): ForecastInputs["obligations"] => items.flatMap((i) => {
    const opt = args.options.find((o) => o.obligationId === i.obligationId)!;
    return opt.token === "USDC" ? [{ payDate: i.final.plannedDate ?? opt.dueDate, amount: i.final.amount }] : [];
  });
  const run = () => forecast({ ...args.base, obligations: [...args.base.obligations, ...placements()] }, args.horizon, args.stressDelayDays, args.haircutBps);

  const shedOrder = (i: ValidatedObligation) => {
    const opt = args.options.find((o) => o.obligationId === i.obligationId)!;
    // PAY_EARLY first, then PAY_NOW of criticality 3, then criticality 2 not yet due. Never criticality 1.
    if (i.final.choice === "PAY_EARLY") return 0;
    if (i.final.choice === "PAY_NOW" && (args.criticality[i.obligationId] ?? 2) === 3) return 1;
    if (i.final.choice === "PAY_NOW" && (args.criticality[i.obligationId] ?? 2) === 2 && opt.daysToDue > 0) return 2;
    return 99;
  };
  let f = run();
  const shed: string[] = [];
  while (BigInt(f.minBalanceStress.amount) < 0n) {
    const cand = items.filter((i) => shedOrder(i) < 99).sort((a, b) => shedOrder(a) - shedOrder(b))[0];
    if (!cand) break;
    const opt = args.options.find((o) => o.obligationId === cand.obligationId)!;
    cand.final = { choice: "SCHEDULE", plannedDate: opt.dueDate < args.today ? args.today : opt.dueDate, amount: BigInt(opt.amount) };
    cand.overruled = true;
    cand.overruleReason = "paying now would push the stress-case balance below zero";
    shed.push(cand.obligationId);
    f = run();
  }
  const feasible = BigInt(f.minBalanceStress.amount) >= 0n;

  // Pay order must be a permutation of the obligations being paid; otherwise fall back to the default order.
  const payingIds = new Set(items.filter(paying).map((i) => i.obligationId));
  const proposedOrder = args.proposed.payOrder.filter((id) => payingIds.has(id));
  const orderOk = proposedOrder.length === payingIds.size && new Set(proposedOrder).size === payingIds.size;
  const payOrder = orderOk ? proposedOrder : args.defaultOrder.filter((id) => payingIds.has(id));

  return {
    items,
    payOrder,
    checks: [
      { name: "combined_feasibility", passed: feasible, detail: `min stress balance ${f.minBalanceStress.amount} on ${f.minBalanceStress.date}; shed ${shed.length}` },
      { name: "pay_order", passed: orderOk, detail: orderOk ? "proposed order accepted" : "fell back to default order" },
    ],
  };
}

/** The default plan: every obligation takes its policy default. No model required. */
export function defaultPlan(options: ObligationOptions[], order: string[]): ProposedPlan {
  return {
    summary: "Default policy plan (no planner): each obligation takes its deterministic default choice.",
    obligations: options.map((o) => ({
      obligationId: o.obligationId, choice: o.defaultChoice,
      plannedDate: o.defaultChoice === "SCHEDULE" ? (o.daysToDue > 0 ? addDaysIso(o.dueDate, -1) : null) : null,
      rationale: o.defaultReason, alternativesConsidered: [],
    })),
    payOrder: order,
  };
}

const addDaysIso = (d: string, n: number) => addDays(d, n);
