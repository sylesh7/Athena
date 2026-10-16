// Phase 22 — normalization: convert model suggestions into exact values or refuse them.
import { createHash } from "node:crypto";
import { AmountError, parseAmount } from "@athena/shared/money";

export type Token = "USDC" | "EURC";

export class HoldError extends Error {
  constructor(
    public reason:
      | "unsupported_currency"
      | "amount_unparseable"
      | "line_sum_mismatch"
      | "bad_dates",
    detail: string,
  ) {
    super(`${reason}: ${detail}`);
  }
}

export function normalizeCurrency(c: string): Token {
  const u = c.trim().toUpperCase();
  if (u === "USDC" || u === "USD") return "USDC";
  if (u === "EURC" || u === "EUR") return "EURC";
  throw new HoldError("unsupported_currency", c);
}

/**
 * Strip thousands separators ONLY when the pattern is unambiguous ("1,250.00", "1 250.00"), then parse strictly.
 * "1.250,00" (European) is ambiguous and refused — a human resolves it.
 */
export function normalizeAmount(printed: string): bigint {
  const s = printed.trim();
  let cleaned = s;
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) cleaned = s.replace(/,/g, "");
  else if (/^\d{1,3}( \d{3})+(\.\d+)?$/.test(s)) cleaned = s.replace(/ /g, "");
  try {
    return parseAmount(cleaned);
  } catch (e) {
    if (e instanceof AmountError) throw new HoldError("amount_unparseable", printed);
    throw e;
  }
}

export interface PrintedLine {
  description: string;
  sku: string | null;
  quantity: string;
  unitPrice: string;
  amount: string;
}
export interface NormalLine {
  description: string;
  sku: string | null;
  quantity: bigint; // whole units only
  unitPrice: bigint;
  amount: bigint;
}

/** Σ(line.amount) == total exactly, and quantity × unitPrice == amount exactly. */
export function normalizeLines(lines: PrintedLine[], total: bigint): NormalLine[] {
  let sum = 0n;
  const out = lines.map((l) => {
    if (!/^[1-9]\d{0,8}$/.test(l.quantity.trim())) throw new HoldError("amount_unparseable", `quantity ${l.quantity}`);
    const quantity = BigInt(l.quantity.trim());
    const unitPrice = normalizeAmount(l.unitPrice);
    const amount = normalizeAmount(l.amount);
    if (quantity * unitPrice !== amount) {
      throw new HoldError("line_sum_mismatch", `${l.description}: ${quantity} × ${unitPrice} ≠ ${amount}`);
    }
    sum += amount;
    return { description: l.description, sku: l.sku, quantity, unitPrice, amount };
  });
  if (sum !== total) throw new HoldError("line_sum_mismatch", `lines sum ${sum} ≠ total ${total}`);
  return out;
}

const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) &&
  new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

export function normalizeDates(invoiceDate: string, dueDate: string | null, netDays: number | null): { invoiceDate: string; dueDate: string } {
  if (!isDate(invoiceDate)) throw new HoldError("bad_dates", `invoiceDate ${invoiceDate}`);
  let due = dueDate;
  if (due === null) {
    if (netDays === null) throw new HoldError("bad_dates", "no due date and no net terms");
    due = new Date(Date.parse(`${invoiceDate}T00:00:00Z`) + netDays * 86_400_000).toISOString().slice(0, 10);
  }
  if (!isDate(due)) throw new HoldError("bad_dates", `dueDate ${due}`);
  if (due < invoiceDate) throw new HoldError("bad_dates", "dueDate before invoiceDate");
  return { invoiceDate, dueDate: due };
}

/** "INV-0042" / "INV 42" / "inv42" → "INV42": uppercase, strip spaces/dashes, drop leading zeros of the numeric tail. */
export function normalizeInvoiceNumber(n: string): string {
  const u = n.toUpperCase().replace(/[\s\-_/.]/g, "");
  return u.replace(/^([A-Z]*)0+(\d)/, "$1$2");
}

export function invoiceFingerprint(payeeId: string, invoiceNumber: string, total: bigint, token: Token): `0x${string}` {
  return `0x${createHash("sha256").update(`${payeeId}|${normalizeInvoiceNumber(invoiceNumber)}|${total}|${token}`).digest("hex")}`;
}

/** Probable duplicate: same payee and same total within 45 days but a different invoice number (Phase 22.2 layer 3). */
export function isProbableDuplicate(a: { total: bigint; date: string; number: string }, b: { total: bigint; date: string; number: string }): boolean {
  if (a.total !== b.total) return false;
  if (normalizeInvoiceNumber(a.number) === normalizeInvoiceNumber(b.number)) return false; // that's the exact-duplicate layer
  const days = Math.abs(Date.parse(`${a.date}T00:00:00Z`) - Date.parse(`${b.date}T00:00:00Z`)) / 86_400_000;
  return days <= 45;
}
