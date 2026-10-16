// Phase 35.4 — the dunning ladder. Pure: no env/db imports.
//
//   stage 0  at issue                      invoice email
//   stage 1  due − 3 days  (late payer: −7)   friendly reminder
//   stage 2  due date                         reminder with pay links
//   stage 3  due + 7 days  (late payer: +3)   firmer reminder
//   stage 4  due + 14 days (late payer: +10)  escalate to a HUMAN — no more automatic emails
//
// A "late payer" is a customer whose average lateness exceeds 5 days; the forecast learns the same number (Phase 19).

export const LATE_PAYER_DAYS = 5;

export interface StageDef { stage: 0 | 1 | 2 | 3 | 4; offsetDays: number }

export function ladder(avgDaysLate: number): StageDef[] {
  const late = avgDaysLate > LATE_PAYER_DAYS;
  return [
    { stage: 1, offsetDays: late ? -7 : -3 },
    { stage: 2, offsetDays: 0 },
    { stage: 3, offsetDays: late ? 3 : 7 },
    { stage: 4, offsetDays: late ? 10 : 14 },
  ];
}

const dayNumber = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 86_400_000);

/**
 * The single stage to send now: the HIGHEST stage whose date has arrived and which has not been sent yet.
 * Skipping straight to the latest due stage (instead of sending every missed one in a burst) means a receivable discovered
 * late never gets a pile of back-dated emails. Stage 0 (the invoice itself) is handled separately at issue.
 */
export function nextStage(args: { dueDate: string; today: string; avgDaysLate: number; sent: number[] }): StageDef | null {
  const due = dayNumber(args.dueDate);
  const today = dayNumber(args.today);
  const reached = ladder(args.avgDaysLate).filter((s) => today >= due + s.offsetDays);
  const highestSent = Math.max(0, ...args.sent);
  const candidates = reached.filter((s) => s.stage > highestSent);
  return candidates.length === 0 ? null : candidates[candidates.length - 1]!;
}

/** Running average lateness in days after a payment lands (never negative: early payers count as 0 late). */
export function updatedAvgDaysLate(args: { avg: number; paidCount: number; paidOn: string; dueDate: string }): number {
  const late = Math.max(0, dayNumber(args.paidOn) - dayNumber(args.dueDate));
  return Math.round(((args.avg * args.paidCount + late) / (args.paidCount + 1)) * 100) / 100;
}
