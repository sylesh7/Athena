import { describe, expect, it } from "vitest";
import { checkBudget, costMicroUsd, estimateInputTokens, toMicro, usd } from "../src/llm/pricing.js";
import { resolveLlm } from "../src/llm/tool.js";

describe("LLM cost math", () => {
  it("prices gpt-4o-mini at $0.15 / $0.60 per 1M tokens, rounding up", () => {
    expect(costMicroUsd("gpt-4o-mini", 1_000_000, 0)).toBe(150_000n); // $0.15
    expect(costMicroUsd("gpt-4o-mini", 0, 1_000_000)).toBe(600_000n); // $0.60
    expect(costMicroUsd("gpt-4o-mini", 1, 0)).toBe(1n); // never rounds to zero
    expect(usd(costMicroUsd("gpt-4o-mini", 3_000, 500))).toBe("$0.0008");
  });
  it("an unknown model is priced HIGH so the cap trips early, and an override wins", () => {
    expect(costMicroUsd("some-new-model", 1_000_000, 0)).toBe(5_000_000n);
    expect(costMicroUsd("some-new-model", 1_000_000, 0, { in: 1n, out: 1n })).toBe(1n);
  });
  it("a typical extraction/plan call costs a fraction of a cent on a mini model", () => {
    const worst = costMicroUsd("gpt-4o-mini", estimateInputTokens(6_000), 4_000);
    expect(worst < toMicro(0.01)).toBe(true);
  });
});

describe("budget guard", () => {
  const cap = { capTotal: toMicro(4), capDaily: toMicro(0.5) };
  it("allows a call comfortably inside both caps", () => {
    expect(checkBudget({ spentTotal: toMicro(1), spentToday: toMicro(0.1), worstCase: toMicro(0.01), ...cap }).ok).toBe(true);
  });
  it("refuses when the TOTAL cap would be crossed (worst case counted, not just spent)", () => {
    const v = checkBudget({ spentTotal: toMicro(3.995), spentToday: 0n, worstCase: toMicro(0.01), ...cap });
    expect(v.ok).toBe(false);
  });
  it("refuses when the DAILY cap would be crossed even though the total has room", () => {
    const v = checkBudget({ spentTotal: toMicro(0.2), spentToday: toMicro(0.495), worstCase: toMicro(0.01), ...cap });
    expect(v.ok).toBe(false);
    expect(!v.ok && v.reason).toContain("daily");
  });
  it("with $10 funded and a $4 cap, at least $6 is always left for the demo", () => {
    expect(10 - 4).toBeGreaterThanOrEqual(6);
    expect(checkBudget({ spentTotal: toMicro(4), spentToday: 0n, worstCase: 1n, ...cap }).ok).toBe(false);
  });
});

describe("provider selection", () => {
  it("uses OpenAI when only an OpenAI key is set, honours LLM_PROVIDER, and is off for model=none", () => {
    expect(resolveLlm({ OPENAI_API_KEY: "k" }, "gpt-4o-mini")).toMatchObject({ provider: "openai" });
    expect(resolveLlm({ ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "k", LLM_PROVIDER: "openai" }, "m")).toMatchObject({ provider: "openai" });
    expect(resolveLlm({ ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "k" }, "m")).toMatchObject({ provider: "anthropic" });
    expect(resolveLlm({ OPENAI_API_KEY: "k" }, "none")).toBeNull();
    expect(resolveLlm({}, "gpt-4o-mini")).toBeNull();
  });
});
