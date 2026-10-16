// Phase 19 — deterministic daily cash projection (base + stress). No model involved; all bigint.
import { bps } from "@athena/shared/money";
import { canonicalRecord } from "@athena/shared/canonical";

export interface ForecastObligation {
  payDate: string; // YYYY-MM-DD (planned_pay_date, else due_date)
  amount: bigint;
}
export interface ForecastSubscription {
  nextDue: string;
  intervalDays: number;
  amount: bigint;
}
export interface ForecastReceivable {
  expectedDate: string; // due_date + customer.avg_days_late (rounded up)
  outstanding: bigint;
}
export interface ForecastInputs {
  today: string;
  startingCash: bigint; // spendable USDC now
  obligations: ForecastObligation[];
  subscriptions: ForecastSubscription[];
  receivables: ForecastReceivable[];
}

export interface ForecastDay {
  date: string;
  inflowsBase: string;
  outflows: string;
  balanceBase: string;
  inflowsStress: string;
  balanceStress: string;
}
export interface Forecast {
  horizonDays: number;
  token: "USDC";
  days: ForecastDay[];
  minBalanceBase: { date: string; amount: string };
  minBalanceStress: { date: string; amount: string };
  shortfalls: Array<{ date: string; amountStress: string }>;
  runwayDays: number | null; // null = never runs out inside the horizon
  avgDailyNetBurn: string;
  inputsHash: string;
}

const MS_DAY = 86_400_000;

export const addDays = (date: string, n: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * MS_DAY).toISOString().slice(0, 10);

const dayIndex = (today: string, date: string): number =>
  Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / MS_DAY);

/** Occurrence dates of a recurring subscription inside [today, today+horizon]. */
export function occurrences(s: ForecastSubscription, today: string, horizon: number): string[] {
  if (s.intervalDays <= 0) return [];
  const out: string[] = [];
  let d = s.nextDue;
  // Overdue subscriptions are due immediately (day 0), then follow the interval from nextDue.
  while (dayIndex(today, d) <= horizon) {
    out.push(dayIndex(today, d) < 0 ? today : d);
    d = addDays(d, s.intervalDays);
  }
  return out;
}

export function forecast(inp: ForecastInputs, horizon: number, stressDelayDays: number, haircutBps: bigint): Forecast {
  const n = horizon + 1;
  const outflows = new Array<bigint>(n).fill(0n);
  const inBase = new Array<bigint>(n).fill(0n);
  const inStress = new Array<bigint>(n).fill(0n);

  const put = (arr: bigint[], date: string, amount: bigint) => {
    let i = dayIndex(inp.today, date);
    if (i < 0) i = 0; // already due/overdue: lands today
    if (i >= n) return; // outside the horizon
    arr[i] = arr[i]! + amount;
  };

  for (const o of inp.obligations) put(outflows, o.payDate, o.amount);
  for (const s of inp.subscriptions) for (const d of occurrences(s, inp.today, horizon)) put(outflows, d, s.amount);
  for (const r of inp.receivables) {
    put(inBase, r.expectedDate, r.outstanding);
    // Stress: arrives later and only part of it arrives.
    put(inStress, addDays(r.expectedDate, stressDelayDays), r.outstanding - bps(r.outstanding, haircutBps));
  }

  const days: ForecastDay[] = [];
  let base = inp.startingCash;
  let stress = inp.startingCash;
  let minBase = { date: inp.today, amount: base };
  let minStress = { date: inp.today, amount: stress };
  const shortfalls: Forecast["shortfalls"] = [];
  let runway: number | null = null;
  let totalOut = 0n;
  let totalInBase = 0n;

  for (let i = 0; i < n; i++) {
    const date = addDays(inp.today, i);
    base = base + inBase[i]! - outflows[i]!;
    stress = stress + inStress[i]! - outflows[i]!;
    totalOut += outflows[i]!;
    totalInBase += inBase[i]!;
    if (base < minBase.amount) minBase = { date, amount: base };
    if (stress < minStress.amount) minStress = { date, amount: stress };
    if (stress < 0n) shortfalls.push({ date, amountStress: stress.toString() });
    if (runway === null && base < 0n) runway = i;
    days.push({
      date,
      inflowsBase: inBase[i]!.toString(),
      outflows: outflows[i]!.toString(),
      balanceBase: base.toString(),
      inflowsStress: inStress[i]!.toString(),
      balanceStress: stress.toString(),
    });
  }

  const net = totalOut - totalInBase;
  const avgBurn = net > 0n ? net / BigInt(Math.max(horizon, 1)) : 0n;

  const inputsHash = canonicalRecord({
      today: inp.today,
      startingCash: inp.startingCash.toString(),
      obligations: inp.obligations.map((o) => ({ payDate: o.payDate, amount: o.amount.toString() })),
      subscriptions: inp.subscriptions.map((s) => ({ ...s, amount: s.amount.toString() })),
      receivables: inp.receivables.map((r) => ({ expectedDate: r.expectedDate, outstanding: r.outstanding.toString() })),
      horizon,
      stressDelayDays,
      haircutBps: haircutBps.toString(),
  }).sha256;

  return {
    horizonDays: horizon,
    token: "USDC",
    days,
    minBalanceBase: { date: minBase.date, amount: minBase.amount.toString() },
    minBalanceStress: { date: minStress.date, amount: minStress.amount.toString() },
    shortfalls,
    runwayDays: runway,
    avgDailyNetBurn: avgBurn.toString(),
    inputsHash,
  };
}
