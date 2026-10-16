// Pure risk-tier mapping (no env/db imports so it is unit-testable).
export type RiskTier = "low" | "medium" | "high" | "blocked";

/** DENIED => blocked. APPROVED with any rule/action attached => medium (lower limit, not a refusal). Otherwise low. */
export function toTier(result: "APPROVED" | "DENIED", ruleName?: string, actions?: string[]): RiskTier {
  if (result === "DENIED") return "blocked";
  if ((actions && actions.length > 0) || (ruleName && ruleName.trim() !== "")) return "medium";
  return "low";
}

/** Re-screen cadence per tier, in days (Phase 24.2). */
export const RESCREEN_DAYS: Record<RiskTier, number> = { low: 30, medium: 7, high: 1, blocked: 1 };
