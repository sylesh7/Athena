import { describe, expect, it } from "vitest";
import { discountAprBps, discountedAmount, earlyPayAllowed } from "../src/policy/discount.js";
import { forecast, occurrences } from "../src/forecast/forecast.js";
import {
  HoldError, invoiceFingerprint, normalizeAmount, normalizeCurrency, normalizeDates,
  normalizeInvoiceNumber, normalizeLines,
} from "../src/validate/normalize.js";
import { threeWayMatch, type InvoiceView, type PoView } from "../src/validate/match.js";

const U = 1_000_000n;

describe("discount math (Phase 25.1)", () => {
  it("2/10 net 30 = 3724 bps", () => expect(discountAprBps(200n, 10, 30)).toBe(3724n));
  it("1/10 net 30 = 1843 bps", () => expect(discountAprBps(100n, 10, 30)).toBe(1843n));
  it("0.5/10 net 60 = 366 bps", () => expect(discountAprBps(50n, 10, 60)).toBe(366n));
  it("degenerate inputs give 0", () => {
    expect(discountAprBps(0n, 10, 30)).toBe(0n);
    expect(discountAprBps(200n, 30, 30)).toBe(0n);
    expect(discountAprBps(10_000n, 10, 30)).toBe(0n);
  });
  it("discounted amount is exact", () => expect(discountedAmount(1000n * U, 200n)).toBe(980n * U));
  it("early pay beats a 4.5% vault but not a 40% vault", () => {
    const base = { daysSinceInvoice: 3, discountDays: 10, aprBps: 3724n, marginBps: 200n };
    expect(earlyPayAllowed({ ...base, bestVaultApyBps: 450n })).toBe(true);
    expect(earlyPayAllowed({ ...base, bestVaultApyBps: 4000n })).toBe(false);
    expect(earlyPayAllowed({ ...base, daysSinceInvoice: 11, bestVaultApyBps: 450n })).toBe(false);
  });
});

describe("forecast (Phase 19)", () => {
  const today = "2026-10-09";
  it("receivable from a 3-days-late customer lands day 8 base and day 15 at half value in stress", () => {
    const f = forecast(
      { today, startingCash: 0n, obligations: [], subscriptions: [], receivables: [{ expectedDate: "2026-10-17", outstanding: 100n * U }] },
      30, 7, 5000n,
    );
    expect(f.days[8]!.inflowsBase).toBe((100n * U).toString());
    expect(f.days[15]!.inflowsStress).toBe((50n * U).toString());
  });

  it("30-day subscription started 25 days ago appears on day 5 and not again inside a 30-day horizon", () => {
    expect(occurrences({ nextDue: "2026-10-14", intervalDays: 30, amount: 1n }, today, 30)).toEqual(["2026-10-14"]);
    expect(occurrences({ nextDue: "2026-10-14", intervalDays: 30, amount: 1n }, today, 40)).toEqual(["2026-10-14", "2026-11-13"]);
  });

  it("obligation with planned date earlier than due date is placed on the planned date", () => {
    const f = forecast(
      { today, startingCash: 100n * U, obligations: [{ payDate: "2026-10-12", amount: 60n * U }], subscriptions: [], receivables: [] },
      30, 7, 5000n,
    );
    expect(f.days[3]!.outflows).toBe((60n * U).toString());
    expect(f.days[3]!.balanceBase).toBe((40n * U).toString());
  });

  it("flags stress shortfalls and runway", () => {
    const f = forecast(
      { today, startingCash: 50n * U, obligations: [{ payDate: "2026-10-10", amount: 80n * U }], subscriptions: [], receivables: [] },
      30, 7, 5000n,
    );
    expect(f.shortfalls[0]!.date).toBe("2026-10-10");
    expect(f.runwayDays).toBe(1);
    expect(BigInt(f.minBalanceStress.amount)).toBe(-30n * U);
  });

  it("same inputs give the same inputsHash", () => {
    const inp = { today, startingCash: 5n, obligations: [], subscriptions: [], receivables: [] };
    expect(forecast(inp, 30, 7, 5000n).inputsHash).toBe(forecast({ ...inp }, 30, 7, 5000n).inputsHash);
    expect(forecast(inp, 30, 7, 5000n).inputsHash).not.toBe(forecast({ ...inp, startingCash: 6n }, 30, 7, 5000n).inputsHash);
  });

  it("overdue obligations land today, out-of-horizon ones are ignored", () => {
    const f = forecast(
      { today, startingCash: 10n * U, obligations: [{ payDate: "2026-09-01", amount: 1n * U }, { payDate: "2027-06-01", amount: 9n * U }], subscriptions: [], receivables: [] },
      30, 7, 5000n,
    );
    expect(f.days[0]!.outflows).toBe(U.toString());
    expect(BigInt(f.days[30]!.balanceBase)).toBe(9n * U);
  });
});

describe("normalization (Phase 22)", () => {
  const refused = (fn: () => unknown, reason: string) => {
    try { fn(); } catch (e) { expect(e).toBeInstanceOf(HoldError); expect((e as HoldError).reason).toBe(reason); return; }
    throw new Error("expected a HoldError");
  };

  it("currencies", () => {
    expect(normalizeCurrency("usd")).toBe("USDC");
    expect(normalizeCurrency("EUR")).toBe("EURC");
    refused(() => normalizeCurrency("GBP"), "unsupported_currency");
  });

  it("amounts: unambiguous separators stripped, ambiguous or excess decimals refused", () => {
    expect(normalizeAmount("1,250.00")).toBe(1250n * U);
    expect(normalizeAmount("1 250.00")).toBe(1250n * U);
    refused(() => normalizeAmount("6.0000001"), "amount_unparseable");
    refused(() => normalizeAmount("1.250,00"), "amount_unparseable");
    refused(() => normalizeAmount("-5"), "amount_unparseable");
  });

  it("line sums must be exact", () => {
    const lines = [{ description: "a", sku: "A", quantity: "2", unitPrice: "100.00", amount: "200.00" }];
    expect(normalizeLines(lines, 200n * U)).toHaveLength(1);
    refused(() => normalizeLines(lines, 1250n * U), "line_sum_mismatch");
    refused(() => normalizeLines([{ ...lines[0]!, amount: "199.99" }], 199_990_000n), "line_sum_mismatch");
  });

  it("dates", () => {
    expect(normalizeDates("2026-10-01", null, 30)).toEqual({ invoiceDate: "2026-10-01", dueDate: "2026-10-31" });
    refused(() => normalizeDates("2026-10-05", "2026-10-01", null), "bad_dates");
    refused(() => normalizeDates("2026-02-30", null, 30), "bad_dates");
  });

  it("INV-0042 and 'INV 42' share a fingerprint", () => {
    expect(normalizeInvoiceNumber("INV-0042")).toBe("INV42");
    expect(normalizeInvoiceNumber("INV 42")).toBe("INV42");
    expect(invoiceFingerprint("p", "INV-0042", 5n, "USDC")).toBe(invoiceFingerprint("p", "INV 42", 5n, "USDC"));
    expect(invoiceFingerprint("p", "INV-0042", 5n, "USDC")).not.toBe(invoiceFingerprint("p", "INV-0043", 5n, "USDC"));
  });
});

describe("three-way match (Phase 23)", () => {
  const po: PoView = {
    payeeId: "p1", token: "USDC", total: 1000n * U, invoiced: 0n, poNumber: "PO-1",
    linesHash: "0xaa", termsHash: "0xbb", lines: [{ sku: "HOST", unitPrice: 100n * U, qtyOrdered: 10n }],
  };
  const receipt = (qty: bigint) => ({ id: "r1", kind: "delivery" as const, evidenceHash: "0xcc", qtyBySku: { HOST: qty }, accepted: {} });
  const inv = (qty: bigint, unit = 100n * U): InvoiceView => ({
    payeeId: "p1", token: "USDC", total: qty * unit, invoiceNumber: "INV42", documentSha256: "0xdd",
    lines: [{ description: "hosting", sku: "HOST", quantity: qty, unitPrice: unit, amount: qty * unit }],
    alreadyInvoicedBySku: {},
  });

  it("matched at PO price for received quantities, with a reproducible evidence hash", () => {
    const a = threeWayMatch(inv(8n), po, [receipt(8n)]);
    const b = threeWayMatch(inv(8n), po, [receipt(8n)]);
    expect(a.status).toBe("matched");
    expect(a.matchedAmount).toBe(800n * U);
    expect(a.evidenceHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(a.evidenceHash).toBe(b.evidenceHash);
  });

  it("unit price 1 atomic unit higher than PO is a mismatch", () => {
    const r = threeWayMatch(inv(8n, 100n * U + 1n), po, [receipt(8n)]);
    expect(r.status).toBe("mismatch");
    expect(r.evidenceHash).toBeNull();
  });

  it("invoicing 10 when 8 were received is partial for 8", () => {
    const r = threeWayMatch(inv(10n), po, [receipt(8n)]);
    expect(r.status).toBe("partial");
    expect(r.matchedAmount).toBe(800n * U);
  });

  it("nothing received is a mismatch; no PO is no_po; over PO value is a mismatch", () => {
    expect(threeWayMatch(inv(2n), po, []).status).toBe("mismatch");
    expect(threeWayMatch(inv(2n), null, []).status).toBe("no_po");
    expect(threeWayMatch(inv(8n), { ...po, invoiced: 500n * U }, [receipt(8n)]).status).toBe("mismatch");
  });

  it("different payee is a mismatch", () => {
    expect(threeWayMatch({ ...inv(8n), payeeId: "other" }, po, [receipt(8n)]).status).toBe("mismatch");
  });

  it("milestone must be accepted", () => {
    const mpo: PoView = { ...po, lines: [{ sku: "M1", unitPrice: 300n * U, qtyOrdered: 1n }] };
    const minv: InvoiceView = {
      ...inv(1n), total: 300n * U,
      lines: [{ description: "milestone", sku: "M1", quantity: 1n, unitPrice: 300n * U, amount: 300n * U }],
    };
    const rec = (ok: boolean) => ({ id: "r2", kind: "milestone" as const, evidenceHash: "0xee", qtyBySku: {}, accepted: { M1: ok } });
    expect(threeWayMatch(minv, mpo, [rec(true)]).status).toBe("matched");
    expect(threeWayMatch(minv, mpo, [rec(false)]).status).toBe("mismatch");
  });
});
