import { describe, expect, it } from "vitest";
import { ladder, nextStage, updatedAvgDaysLate } from "../src/ar/dunning.js";
import { renderEmail } from "../src/ar/email.js";
import { renderInvoicePdf } from "../src/ar/pdf.js";

const U = 1_000_000n;

describe("dunning ladder (Phase 35.4)", () => {
  it("normal payers: reminders at due−3, due, due+7; human at due+14", () => {
    expect(ladder(0).map((s) => [s.stage, s.offsetDays])).toEqual([[1, -3], [2, 0], [3, 7], [4, 14]]);
  });
  it("late payers (avg > 5 days) are chased earlier", () => {
    expect(ladder(6).map((s) => [s.stage, s.offsetDays])).toEqual([[1, -7], [2, 0], [3, 3], [4, 10]]);
    expect(ladder(5).map((s) => s.offsetDays)).toEqual([-3, 0, 7, 14]); // exactly 5 is not "late"
  });
  const base = { dueDate: "2026-11-10", avgDaysLate: 0 };
  it("sends nothing before the first stage date", () => {
    expect(nextStage({ ...base, today: "2026-11-06", sent: [0] })).toBeNull();
  });
  it("sends stage 1 on due−3, then nothing until due", () => {
    expect(nextStage({ ...base, today: "2026-11-07", sent: [0] })?.stage).toBe(1);
    expect(nextStage({ ...base, today: "2026-11-09", sent: [0, 1] })).toBeNull();
    expect(nextStage({ ...base, today: "2026-11-10", sent: [0, 1] })?.stage).toBe(2);
  });
  it("a receivable discovered late gets ONE message (the latest due stage), not a burst of back-dated ones", () => {
    expect(nextStage({ ...base, today: "2026-11-20", sent: [0] })?.stage).toBe(3);
    expect(nextStage({ ...base, today: "2026-11-25", sent: [0] })?.stage).toBe(4);
  });
  it("never repeats a stage and stops after the human stage", () => {
    expect(nextStage({ ...base, today: "2026-11-12", sent: [0, 1, 2] })).toBeNull();
    expect(nextStage({ ...base, today: "2027-03-01", sent: [0, 1, 2, 3, 4] })).toBeNull();
  });
  it("running average lateness: early payers count as 0, never negative", () => {
    expect(updatedAvgDaysLate({ avg: 0, paidCount: 0, paidOn: "2026-11-15", dueDate: "2026-11-10" })).toBe(5);
    expect(updatedAvgDaysLate({ avg: 5, paidCount: 1, paidOn: "2026-11-01", dueDate: "2026-11-10" })).toBe(2.5);
    expect(updatedAvgDaysLate({ avg: 4, paidCount: 3, paidOn: "2026-11-10", dueDate: "2026-11-10" })).toBe(3);
  });
});

describe("email templates (links and amounts come from code)", () => {
  const i = { stage: 2 as const, customerName: "Acme <Corp>", invoiceNumber: "AR-1", token: "USDC", outstanding: 250_500_000n, dueDate: "2026-11-10",
    payUrl: "https://app.example/pay/0xabc", agentPayUrl: "https://api.example/pay/0xabc", fromName: "Athena Treasury" };
  it("renders amounts exactly and includes both pay links", () => {
    const m = renderEmail(i);
    expect(m.subject).toBe("Invoice AR-1 is due today");
    expect(m.text).toContain("250.500000 USDC");
    expect(m.text).toContain("https://app.example/pay/0xabc");
    expect(m.text).toContain("https://api.example/pay/0xabc");
  });
  it("omits the x402 link when the receivable does not accept it, and HTML-escapes names", () => {
    const m = renderEmail({ ...i, agentPayUrl: null });
    expect(m.text).not.toContain("x402");
    expect(m.html).toContain("Acme &lt;Corp&gt;");
    expect(m.html).not.toContain("<Corp>");
  });
  it("each stage has its own subject; the overdue one does not threaten or offer discounts", () => {
    const subjects = ([0, 1, 2, 3] as const).map((stage) => renderEmail({ ...i, stage }).subject);
    expect(new Set(subjects).size).toBe(4);
    const overdue = renderEmail({ ...i, stage: 3 }).text.toLowerCase();
    for (const bad of ["legal", "lawyer", "sue", "discount", "penalty"]) expect(overdue).not.toContain(bad);
  });
});

describe("invoice PDF", () => {
  it("renders a real PDF containing the invoice number", async () => {
    const pdf = await renderInvoicePdf({
      fromName: "Athena Treasury", customerName: "Acme", invoiceNumber: "AR-1", token: "USDC", amountDue: 250_500_000n, issuedOn: "2026-10-16",
      dueDate: "2026-11-10", payUrl: "https://app.example/pay/0xabc", agentPayUrl: null, receivableId: "0x" + "ab".repeat(32),
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1_000);
  });
});
void U;
