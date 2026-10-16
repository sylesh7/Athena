import { describe, expect, it } from "vitest";
import { grossUp, quoteFee, toBytes32Address } from "../src/cctp/fees.js";
import { escalationMessage } from "../src/escalations/message.js";

const U = 1_000_000n;

describe("CCTP fee math (Phase 33.1)", () => {
  it("quotes ceil(bps) + 1 unit", () => {
    expect(quoteFee(100n * U, 10n)).toBe(100_000n + 1n); // 0.1% of 100 USDC = 0.1 USDC, +1
    expect(quoteFee(1n, 1n)).toBe(2n); // ceil(0.0001) = 1, +1
  });
  it("grosses up so the vendor receives the invoiced amount", () => {
    const g = grossUp(100n * U, 10n, 100n)!;
    expect(g.amount - g.maxFee).toBe(100n * U);
    expect(g.maxFee * 10_000n <= g.amount * 100n).toBe(true);
  });
  it("is refused when the fee exceeds the contract's cap", () => {
    expect(grossUp(100n * U, 300n, 100n)).toBeNull(); // 3% quote vs 1% cap
  });
  it("left-pads addresses to bytes32 and rejects junk", () => {
    expect(toBytes32Address("0xAbCdEf0123456789aBcDeF0123456789AbCdEf01")).toBe("0x000000000000000000000000abcdef0123456789abcdef0123456789abcdef01");
    expect(() => toBytes32Address("0x123")).toThrow();
  });
});

describe("escalation message (Phase 30.2)", () => {
  it("names the payee, amount, reason, reasoning and review link", () => {
    const text = escalationMessage({
      record: { kind: "PAY_NOW", action: { amount: "300000000", token: "0xusdc" }, subject: { obligation: { payee: "Hosting Co" } }, planner: { rationale: "Due tomorrow; cash covers it." } },
      reason: 2, expiresAt: new Date("2026-10-12T00:00:00Z"), decisionId: "0xabc", frontendUrl: "https://app.example", tokenSymbol: () => "USDC",
    });
    expect(text).toContain("Hosting Co: 300.000000 USDC");
    expect(text).toContain("over the per-payment approval limit");
    expect(text).toContain("Due tomorrow");
    expect(text).toContain("https://app.example/approvals?decision=0xabc");
  });
});
