import { describe, expect, it } from "vitest";
import { RESCREEN_DAYS, toTier } from "../src/payees/tiers.js";
import { isProbableDuplicate } from "../src/validate/normalize.js";

describe("screening tiers (Phase 24.2)", () => {
  it("DENIED is blocked; clean APPROVED is low; APPROVED with a rule/action is medium", () => {
    expect(toTier("DENIED")).toBe("blocked");
    expect(toTier("APPROVED")).toBe("low");
    expect(toTier("APPROVED", "review_rule")).toBe("medium");
    expect(toTier("APPROVED", undefined, ["REVIEW"])).toBe("medium");
    expect(toTier("APPROVED", " ", [])).toBe("low");
  });
  it("higher risk is re-screened more often", () => {
    expect(RESCREEN_DAYS.low).toBeGreaterThan(RESCREEN_DAYS.medium);
    expect(RESCREEN_DAYS.medium).toBeGreaterThan(RESCREEN_DAYS.high);
  });
});

describe("probable duplicate (Phase 22.2 layer 3)", () => {
  const a = { total: 500n, date: "2026-10-01", number: "INV-0042" };
  it("same total within 45 days but different number is probable", () => {
    expect(isProbableDuplicate(a, { total: 500n, date: "2026-10-11", number: "INV-0043" })).toBe(true);
  });
  it("same normalized number is the exact-duplicate layer, not this one", () => {
    expect(isProbableDuplicate(a, { total: 500n, date: "2026-10-11", number: "INV 42" })).toBe(false);
  });
  it("different total or > 45 days apart is not probable", () => {
    expect(isProbableDuplicate(a, { total: 501n, date: "2026-10-11", number: "INV-0043" })).toBe(false);
    expect(isProbableDuplicate(a, { total: 500n, date: "2026-12-01", number: "INV-0043" })).toBe(false);
  });
});
