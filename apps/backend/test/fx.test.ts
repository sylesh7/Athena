import { describe, expect, it } from "vitest";
import { checkRateBand, deviationBps, eurcNeed, expectedEurcOut, toMicroUsd, usdcForEurc } from "../src/fx/rates.js";

const U = 1_000_000n;

describe("FX math (Phase 34)", () => {
  it("parses reference prices strictly into micro-USD, truncating extra digits", () => {
    expect(toMicroUsd("1.1260296426")).toBe(1_126_029n);
    expect(toMicroUsd("0.9985648017")).toBe(998_564n);
    for (const bad of ["", "-1", "1e3", "abc", "0", "0.0000001"]) expect(() => toMicroUsd(bad)).toThrow();
  });

  // live Arc-testnet reference prices observed: USDC 0.9985648 / EURC 1.1260296
  const usdc = 998_564n, eurc = 1_126_029n;
  it("expected EURC for a USDC amount at the reference rate", () => {
    expect(expectedEurcOut(1n * U, usdc, eurc)).toBe(886_801n); // 0.886801 EURC, matches the live check
  });
  it("USDC needed for a EURC target rounds UP and adds the margin", () => {
    const base = usdcForEurc(100n * U, usdc, eurc, 0n);
    expect(expectedEurcOut(base, usdc, eurc) >= 100n * U).toBe(true); // never short
    expect(usdcForEurc(100n * U, usdc, eurc, 200n)).toBeGreaterThan(base);
    expect(usdcForEurc(100n * U, usdc, eurc, 200n) * 10_000n).toBeLessThanOrEqual((base + 1n) * 10_200n + 10_000n);
  });

  it("the rate band refuses only WORSE quotes beyond the limit", () => {
    const ref = 1_000_000n;
    expect(deviationBps(990_000n, ref)).toBe(-100n);
    expect(checkRateBand(996_000n, ref, 50n)).toMatchObject({ ok: true }); // −40 bps, inside 50
    const bad = checkRateBand(994_000n, ref, 50n); // −60 bps
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.reason).toContain("60 bps worse");
  });
  it("a hugely BETTER quote is accepted but flagged (observed on the testnet pool: +3514 bps)", () => {
    const v = checkRateBand(1_198_447n, expectedEurcOut(1n * U, usdc, eurc), 50n);
    expect(v.ok).toBe(true);
    expect(v.ok && v.warn).toContain("BETTER");
    expect(v.deviationBps).toBeGreaterThan(3_000n);
  });
  it("EURC need = due soon + floor − spendable, never negative", () => {
    expect(eurcNeed({ dueSoon: 100n * U, spendable: 30n * U, floor: 10n * U })).toBe(80n * U);
    expect(eurcNeed({ dueSoon: 50n * U, spendable: 500n * U, floor: 10n * U })).toBe(0n);
  });
});
