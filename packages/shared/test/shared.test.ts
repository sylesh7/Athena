import { describe, expect, it } from "vitest";
import { AmountError, formatAmount, parseAmount } from "../src/money.js";
import { canonicalRecord } from "../src/canonical.js";
import { decisionId, obligationId } from "../src/ids.js";
import { actionHash, KIND } from "../src/action.js";
import { CATEGORY } from "../src/categories.js";

const T = "0x1111111111111111111111111111111111111111" as const;
const F = ("0x" + "ab".repeat(32)) as `0x${string}`;

describe("money", () => {
  it("parses strictly", () => {
    expect(parseAmount("6")).toBe(6_000_000n);
    expect(parseAmount("6.000000")).toBe(6_000_000n);
    expect(parseAmount("0.000001")).toBe(1n);
    for (const bad of ["6.0000001", "1,250.00", "-1", "1e6", "", "01", " ", "1.", ".5"]) {
      expect(() => parseAmount(bad)).toThrow(AmountError);
    }
  });

  it("round-trips 1000 random amounts", () => {
    for (let i = 0; i < 1000; i++) {
      const units = BigInt(Math.floor(Math.random() * 1e12)) * 7n + BigInt(i);
      expect(parseAmount(formatAmount(units))).toBe(units);
    }
  });
});

describe("canonical", () => {
  it("sorts keys and is order independent", () => {
    expect(canonicalRecord({ b: 1, a: { d: 2, c: 1 } }).json).toBe('{"a":{"c":1,"d":2},"b":1}');
    expect(canonicalRecord({ a: 1, b: 2 }).sha256).toBe(canonicalRecord({ b: 2, a: 1 }).sha256);
  });
  it("bytes are the utf8 of json", () => {
    const r = canonicalRecord({ x: "y" });
    expect(Buffer.from(r.bytes.slice(2), "hex").toString("utf8")).toBe(r.json);
  });
});

describe("ids", () => {
  it("are deterministic", () => {
    expect(obligationId(T, F)).toBe(obligationId(T, F));
    expect(decisionId(T, "c1", 0)).not.toBe(decisionId(T, "c1", 1));
  });
});

describe("action", () => {
  it("hash is deterministic and field sensitive", () => {
    const a = {
      kind: KIND.PAY, obligationId: F, payeeId: F, token: T, amount: 1n, maxFee: 0n, evidenceHash: F,
    };
    expect(actionHash(a)).toBe(actionHash({ ...a }));
    expect(actionHash(a)).not.toBe(actionHash({ ...a, amount: 2n }));
  });
});

describe("categories", () => {
  it("are distinct keccak ids", () => {
    expect(new Set(Object.values(CATEGORY)).size).toBe(6);
  });
});
