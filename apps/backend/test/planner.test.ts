import { describe, expect, it } from "vitest";
import { buildOptions, defaultOrder, type ObligationInput } from "../src/policy/options.js";
import { defaultPlan, validateObligationPlan } from "../src/planner/validate.js";

const U = 1_000_000n;
const today = "2026-10-09";
const ob = (over: Partial<ObligationInput> & { obligationId: string }): ObligationInput => ({
  payeeName: "Acme", category: "VENDOR", token: "USDC", amount: 100n * U, dueDate: "2026-10-10", invoiceDate: "2026-10-05",
  criticality: 2, terms: null, payable: { ok: true }, scorecard: 80, budget: { remaining: 1000n * U, approvalLimit: 250n * U }, payeeCap: 0n, ...over,
});
const base = (cash: bigint) => ({ today, startingCash: cash, obligations: [], subscriptions: [], receivables: [] });
const common = { horizon: 30, stressDelayDays: 7, haircutBps: 5000n };

describe("policy options (Phase 25)", () => {
  it("2/10 net 30 is PAY_EARLY-allowed at a 4.5% vault, not at 40%", () => {
    const o = ob({ obligationId: "a", dueDate: "2026-11-04", terms: { netDays: 30, discountBps: 200, discountDays: 10 } });
    const mk = (apy: bigint) => buildOptions({ today, obligations: [o], spendable: { USDC: 5000n * U, EURC: 0n }, bestVaultApyBps: apy, earlyPayMarginBps: 200n })[0]!;
    expect(mk(450n).allowed).toContain("PAY_EARLY");
    expect(mk(450n).payEarly!.discountedAmount).toBe((98n * U).toString());
    expect(mk(4000n).allowed).not.toContain("PAY_EARLY");
  });

  it("flags expected escalation: 300 USDC against a 250 approval limit", () => {
    const o = buildOptions({ today, obligations: [ob({ obligationId: "a", amount: 300n * U })], spendable: { USDC: 5000n * U, EURC: 0n }, bestVaultApyBps: 0n, earlyPayMarginBps: 200n })[0]!;
    expect(o.expectEscalation).toBe("TX_LIMIT");
  });

  it("unpayable payee can only be held", () => {
    const o = buildOptions({ today, obligations: [ob({ obligationId: "a", payable: { ok: false, reason: "cooling_down" } })], spendable: { USDC: 5000n * U, EURC: 0n }, bestVaultApyBps: 0n, earlyPayMarginBps: 200n })[0]!;
    expect(o.allowed).toEqual(["HOLD"]);
    expect(o.defaultChoice).toBe("HOLD");
  });

  it("default order: criticality, then scorecard, then due date", () => {
    const order = defaultOrder([
      ob({ obligationId: "n", criticality: 2, scorecard: 90 }),
      ob({ obligationId: "c", criticality: 1, scorecard: 10 }),
      ob({ obligationId: "n2", criticality: 2, scorecard: 50 }),
    ]);
    expect(order).toEqual(["c", "n", "n2"]);
  });
});

describe("plan validator (Phase 27)", () => {
  const run = (obs: ObligationInput[], cash: bigint, mutate?: (p: ReturnType<typeof defaultPlan>) => void) => {
    const options = buildOptions({ today, obligations: obs, spendable: { USDC: cash, EURC: 0n }, bestVaultApyBps: 0n, earlyPayMarginBps: 200n });
    const order = defaultOrder(obs);
    const plan = defaultPlan(options, order);
    mutate?.(plan);
    return validateObligationPlan({
      today, proposed: plan, options, criticality: Object.fromEntries(obs.map((o) => [o.obligationId, o.criticality])),
      defaultOrder: order, base: base(cash), ...common,
    });
  };

  it("the default plan is feasible and unoverruled", () => {
    const v = run([ob({ obligationId: "a" })], 1000n * U);
    expect(v.items[0]!.final.choice).toBe("PAY_NOW");
    expect(v.items[0]!.overruled).toBe(false);
    expect(v.checks.find((c) => c.name === "combined_feasibility")!.passed).toBe(true);
  });

  it("a disallowed choice is overruled to the default", () => {
    const v = run([ob({ obligationId: "a", dueDate: "2026-11-20" })], 1000n * U, (p) => { p.obligations[0]!.choice = "PAY_EARLY"; });
    expect(v.items[0]!.overruled).toBe(true);
    expect(v.items[0]!.final.choice).toBe("SCHEDULE");
  });

  it("a schedule date after the due date is overruled", () => {
    const v = run([ob({ obligationId: "a", dueDate: "2026-11-20" })], 1000n * U, (p) => {
      p.obligations[0]!.choice = "SCHEDULE"; p.obligations[0]!.plannedDate = "2026-12-31";
    });
    expect(v.items[0]!.overruled).toBe(true);
    expect(v.items[0]!.final.plannedDate! <= "2026-11-20").toBe(true);
  });

  it("holding a payable, overdue criticality-1 contractor while paying a vendor is overruled", () => {
    const v = run(
      [ob({ obligationId: "contractor", criticality: 1, dueDate: "2026-10-08" }), ob({ obligationId: "vendor", criticality: 2 })],
      1000n * U,
      (p) => { p.obligations.find((o) => o.obligationId === "contractor")!.choice = "HOLD"; },
    );
    const c = v.items.find((i) => i.obligationId === "contractor")!;
    expect(c.final.choice).toBe("PAY_NOW");
    expect(c.overruled).toBe(true);
  });

  it("sheds optional payments when paying everything breaks the stress forecast", () => {
    // 150 cash; two 100 payments due tomorrow: the second would push stress below zero... only criticality-3 sheds.
    const v = run(
      [ob({ obligationId: "a", criticality: 1, amount: 100n * U }), ob({ obligationId: "b", criticality: 3, amount: 100n * U })],
      150n * U,
    );
    const b = v.items.find((i) => i.obligationId === "b")!;
    expect(b.final.choice).not.toBe("PAY_NOW");
    expect(b.overruled).toBe(true);
  });

  it("a bad pay order falls back to the default order", () => {
    const v = run([ob({ obligationId: "a" }), ob({ obligationId: "b", dueDate: "2026-10-09" })], 1000n * U, (p) => { p.payOrder = ["zzz"]; });
    expect(v.checks.find((c) => c.name === "pay_order")!.passed).toBe(false);
    expect(new Set(v.payOrder)).toEqual(new Set(["a", "b"]));
  });
});
