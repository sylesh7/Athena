import { describe, expect, it } from "vitest";
import { planRedeem, planSweep, selectVaults, surplusUnits, type RawVault } from "../src/yield/select.js";

const U = 1_000_000n;
const vault = (over: Partial<RawVault> & { vaultAddress: string }): RawVault => ({
  name: over.vaultAddress, protocol: "MORPHO", asset: "USDC", status: "active", circleGuarded: false, currentApy: 0.04,
  apyProfile: { current: 0.04, d7: null, d30: null }, riskSignals: { warnings: [], earnKitWarnings: [] },
  liquidityProfile: { available: "1000000.0" }, ...over,
});

describe("vault selection (Phase 31.2)", () => {
  it("ranks by conservative APY — the LOWEST of current/7d/30d — not by the headline rate", () => {
    const hot = vault({ vaultAddress: "0xhot", apyProfile: { current: 0.09, d7: 0.02, d30: 0.03 } }); // conservative 2%
    const steady = vault({ vaultAddress: "0xsteady", apyProfile: { current: 0.04, d7: 0.04, d30: 0.045 } }); // conservative 4%
    const r = selectVaults([hot, steady], 5n * U);
    expect(r.map((c) => c.vault)).toEqual(["0xsteady", "0xhot"]);
    expect(r[0]!.conservativeApyBps).toBe(400);
    expect(r[1]!.conservativeApyBps).toBe(200);
  });

  it("drops vaults with ANY risk warning, non-USDC assets and inactive vaults", () => {
    const r = selectVaults([
      vault({ vaultAddress: "0xwarn", riskSignals: { warnings: ["low liquidity"], earnKitWarnings: [] } }),
      vault({ vaultAddress: "0xkitwarn", riskSignals: { warnings: [], earnKitWarnings: ["unverified"] } }),
      vault({ vaultAddress: "0xeur", asset: "EURC" }),
      vault({ vaultAddress: "0xpaused", status: "paused" }),
      vault({ vaultAddress: "0xok" }),
    ], 5n * U);
    expect(r.map((c) => c.vault)).toEqual(["0xok"]);
  });

  it("requires 3× the deposit in available liquidity so the money can come back out", () => {
    const thin = vault({ vaultAddress: "0xthin", liquidityProfile: { available: "10.0" } });
    expect(selectVaults([thin], 5n * U)).toHaveLength(0); // 10 < 15
    expect(selectVaults([thin], 3n * U)).toHaveLength(1); // 10 ≥ 9
  });

  it("parses the SDK's decimal strings strictly: '1000000.0' → atomic units; garbage → ineligible", () => {
    expect(selectVaults([vault({ vaultAddress: "0xa", liquidityProfile: { available: "1000000.0" } })], U)[0]!.availableLiquidity).toBe("1000000000000");
    expect(selectVaults([vault({ vaultAddress: "0xb", liquidityProfile: { available: "1,000" } })], U)).toHaveLength(0);
    expect(selectVaults([vault({ vaultAddress: "0xc", liquidityProfile: { available: "1.0000001" } })], U)).toHaveLength(0);
  });

  it("a vault with no usable APY is ineligible", () => {
    expect(selectVaults([vault({ vaultAddress: "0xn", currentApy: null, apyProfile: { current: null, d7: null, d30: null } })], U)).toHaveLength(0);
  });
});

describe("surplus and sweep sizing (Phase 25.2)", () => {
  it("surplus is the stress minimum above max(floor, 10% of next-30-day outflows); never negative", () => {
    expect(surplusUnits({ minStressBalanceInHorizon: 500n * U, minOperating: 100n * U, next30DayOutflows: 1_000n * U })).toBe(400n * U); // buffer = max(100,100)=100
    expect(surplusUnits({ minStressBalanceInHorizon: 500n * U, minOperating: 100n * U, next30DayOutflows: 3_000n * U })).toBe(200n * U); // buffer = 300
    expect(surplusUnits({ minStressBalanceInHorizon: 50n * U, minOperating: 100n * U, next30DayOutflows: 0n })).toBe(0n);
  });

  const vs = [vault({ vaultAddress: "0xa", apyProfile: { current: 0.05, d7: null, d30: null } }), vault({ vaultAddress: "0xb", apyProfile: { current: 0.045, d7: null, d30: null } })];

  it("sweeps min(surplus, budget remaining) when it clears the minimum, into the best vault", () => {
    const s = planSweep({ surplus: 100n * U, budgetRemaining: 40n * U, minSweep: 5n * U, vaults: vs, positions: [] })!;
    expect(s.amount).toBe(40n * U);
    expect(s.vault.vault).toBe("0xa");
    expect(s.rationale).toContain("500 bps");
  });

  it("does nothing below the minimum sweep (no dust moves) or with no eligible vault", () => {
    expect(planSweep({ surplus: 4n * U, budgetRemaining: 100n * U, minSweep: 5n * U, vaults: vs, positions: [] })).toBeNull();
    expect(planSweep({ surplus: 50n * U, budgetRemaining: 100n * U, minSweep: 5n * U, vaults: [], positions: [] })).toBeNull();
    expect(planSweep({ surplus: 50n * U, budgetRemaining: 0n, minSweep: 5n * U, vaults: vs, positions: [] })).toBeNull();
  });

  it("caps concentration at 60% once two candidates exist: an over-weight vault is skipped", () => {
    const s = planSweep({ surplus: 50n * U, budgetRemaining: 100n * U, minSweep: 5n * U, vaults: vs, positions: [{ vault: "0xa", value: 100n * U }] })!;
    expect(s.vault.vault).toBe("0xb"); // 0xa would hold 150/150 = 100% > 60%
  });
});

describe("redemption need (Phase 25.3)", () => {
  it("redeems the shortfall below the buffer from the largest position, capped by what it holds", () => {
    const r = planRedeem({ minStressBalance: 20n * U, buffer: 100n * U, positions: [{ vault: "0xsmall", value: 10n * U }, { vault: "0xbig", value: 500n * U }] })!;
    expect(r.vault).toBe("0xbig");
    expect(r.amount).toBe(80n * U);
    expect(planRedeem({ minStressBalance: 20n * U, buffer: 100n * U, positions: [{ vault: "0xsmall", value: 10n * U }] })!.amount).toBe(10n * U);
  });
  it("does nothing when the stress case clears the buffer or there is nothing to redeem", () => {
    expect(planRedeem({ minStressBalance: 150n * U, buffer: 100n * U, positions: [{ vault: "0xbig", value: 500n * U }] })).toBeNull();
    expect(planRedeem({ minStressBalance: 0n, buffer: 100n * U, positions: [] })).toBeNull();
  });
});
