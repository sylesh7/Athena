// Phase 23 — three-way match (invoice ↔ PO ↔ receipt) and the evidence bundle. All exact, all bigint.
import { canonicalRecord } from "@athena/shared/canonical";
import type { NormalLine } from "./normalize.js";

export interface PoLine {
  sku: string;
  unitPrice: bigint;
  qtyOrdered: bigint;
}
export interface PoView {
  payeeId: string;
  token: string;
  total: bigint;
  invoiced: bigint;
  lines: PoLine[];
  poNumber: string;
  linesHash: string;
  termsHash: string;
}
export interface ReceiptView {
  id: string;
  kind: "delivery" | "milestone" | "usage";
  evidenceHash: string;
  /** sku → total qty received (delivery) / units metered (usage). */
  qtyBySku: Record<string, bigint>;
  /** sku/milestone → accepted flag (milestone receipts). */
  accepted: Record<string, boolean>;
}
export interface InvoiceView {
  payeeId: string;
  token: string;
  total: bigint;
  invoiceNumber: string;
  documentSha256: string;
  lines: NormalLine[];
  /** sku → qty already invoiced on earlier invoices against this PO. */
  alreadyInvoicedBySku: Record<string, bigint>;
}

export type MatchStatus = "matched" | "partial" | "mismatch" | "no_po";
export interface MatchResult {
  status: MatchStatus;
  /** Amount the obligation may be created for (== total when matched, the received portion when partial). */
  matchedAmount: bigint;
  problems: string[];
  evidenceHash: string | null;
  bundle: unknown | null;
}

export function threeWayMatch(inv: InvoiceView, po: PoView | null, receipts: ReceiptView[]): MatchResult {
  if (po === null) return { status: "no_po", matchedAmount: 0n, problems: ["no purchase order"], evidenceHash: null, bundle: null };

  const problems: string[] = [];
  if (inv.payeeId !== po.payeeId) problems.push("payee differs from PO");
  if (inv.token !== po.token) problems.push("token differs from PO");
  if (inv.total > po.total - po.invoiced) problems.push("invoice total exceeds remaining PO value");

  const received: Record<string, bigint> = {};
  const accepted: Record<string, boolean> = {};
  for (const r of receipts) {
    for (const [sku, q] of Object.entries(r.qtyBySku)) received[sku] = (received[sku] ?? 0n) + q;
    for (const [k, v] of Object.entries(r.accepted)) accepted[k] = (accepted[k] ?? false) || v;
  }
  const poBySku = new Map(po.lines.map((l) => [l.sku, l]));

  let matchedAmount = 0n;
  let partial = false;
  for (const l of inv.lines) {
    const sku = l.sku;
    if (sku === null) { problems.push(`line "${l.description}" has no SKU`); continue; }
    const pl = poBySku.get(sku);
    if (!pl) { problems.push(`SKU ${sku} not on PO`); continue; }
    if (l.unitPrice !== pl.unitPrice) { problems.push(`SKU ${sku} unit price ${l.unitPrice} ≠ PO ${pl.unitPrice}`); continue; }
    const available = (received[sku] ?? 0n) - (inv.alreadyInvoicedBySku[sku] ?? 0n);
    const isMilestone = Object.prototype.hasOwnProperty.call(accepted, sku);
    if (isMilestone) {
      if (!accepted[sku]) { problems.push(`milestone ${sku} not accepted`); continue; }
      matchedAmount += l.amount;
      continue;
    }
    if (l.quantity <= available) {
      matchedAmount += l.amount;
    } else if (available > 0n) {
      matchedAmount += available * l.unitPrice;
      partial = true;
      problems.push(`SKU ${sku}: invoiced ${l.quantity}, received-and-uninvoiced ${available}`);
    } else {
      problems.push(`SKU ${sku}: nothing received to invoice`);
    }
  }

  const hardProblems = problems.filter((p) => !p.includes("received-and-uninvoiced"));
  const status: MatchStatus = hardProblems.length > 0 ? "mismatch" : partial ? "partial" : "matched";
  if (status === "mismatch") return { status, matchedAmount: 0n, problems, evidenceHash: null, bundle: null };

  // The evidence bundle: hashes only, so anyone holding the three documents can recompute it.
  const bundle = {
    version: 1,
    invoice: { documentSha256: inv.documentSha256, invoiceNumber: inv.invoiceNumber, total: inv.total.toString(), token: inv.token },
    purchaseOrder: { poNumber: po.poNumber, linesHash: po.linesHash, termsHash: po.termsHash },
    receipts: receipts.map((r) => ({ id: r.id, kind: r.kind, evidenceHash: r.evidenceHash })),
    match: { status, rulesVersion: "match.v1", matchedAmount: matchedAmount.toString() },
  };
  return { status, matchedAmount, problems, evidenceHash: canonicalRecord(bundle).sha256, bundle };
}
