// Phases 22–24 — turn an extracted suggestion into an obligation, or a HOLD with a reason a human can act on.
// Every step can stop the document; none of them can make a payment. The printed payout address is never used to
// pay: it is compared against the registry, and a difference becomes a change proposal.
import type { Hex } from "viem";
import { obligationId as makeObligationId } from "@athena/shared/ids";
import { parseAmount } from "@athena/shared/money";
import { canonicalRecord } from "@athena/shared/canonical";
import { q, notify } from "../db.js";
import { log } from "../log.js";
import { TREASURY } from "../chain/readClient.js";
import type { ExtractedInvoice } from "../ingest/extract.js";
import {
  HoldError, invoiceFingerprint, isProbableDuplicate, normalizeAmount, normalizeCurrency, normalizeDates, normalizeLines, normalizeInvoiceNumber,
} from "./normalize.js";
import { threeWayMatch, type PoLine, type ReceiptView } from "./match.js";

export type HoldReason =
  | "extraction_failed" | "unknown_vendor" | "unsupported_currency" | "amount_unparseable" | "line_sum_mismatch" | "bad_dates"
  | "duplicate" | "probable_duplicate" | "payee_address_changed" | "mismatch" | "no_po" | "payee_blocked";

const hold = async (id: string, reason: HoldReason, extra: Record<string, unknown> = {}) => {
  await q("update invoices set status = 'held', hold_reason = $2 where id = $1", [id, reason]);
  await notify("invoice.held", { invoiceId: id, reason, ...extra });
};

interface InvRow { id: string; entity_id: string; document_id: string; extracted: ExtractedInvoice; printed_address: string | null }
interface PayeeRow { id: string; payee_id: string; name: string; category: string; kind: string; account: string | null; risk_tier: string; status: string }

export async function processValidationQueue(): Promise<number> {
  const rows = await q<InvRow>("select id, entity_id, document_id, extracted, printed_address from invoices where status = 'extracted' order by created_at limit 50");
  let obligated = 0;
  for (const inv of rows) {
    try {
      if (await validateOne(inv)) obligated++;
    } catch (err) {
      log.error({ invoiceId: inv.id, err: String(err) }, "validation failed — holding");
      await hold(inv.id, "extraction_failed");
    }
  }
  return obligated;
}

async function validateOne(inv: InvRow): Promise<boolean> {
  const ex = inv.extracted;
  // 1. vendor must exist in the vendor master (matched by name, then email). Unknown ⇒ human onboards it.
  const payee = (await q<PayeeRow>(
    `select id, payee_id, name, category, kind, account, risk_tier, status from payees
     where entity_id = $1 and (lower(name) = lower($2) or ($3::text is not null and lower(email) = lower($3))) limit 1`,
    [inv.entity_id, ex.vendorName, ex.vendorEmail],
  ))[0];
  if (!payee) { await hold(inv.id, "unknown_vendor"); return false; }
  if (payee.risk_tier === "blocked") { await hold(inv.id, "payee_blocked"); return false; }

  // 2. normalization — strict decimals, exact line sums, real dates. Refuse, never repair.
  let token, total, lines, dates;
  try {
    token = normalizeCurrency(ex.currency);
    total = normalizeAmount(ex.total);
    lines = normalizeLines(ex.lines, total);
    dates = normalizeDates(ex.invoiceDate, ex.dueDate, ex.terms.netDays);
  } catch (e) {
    if (e instanceof HoldError) { await hold(inv.id, e.reason, { detail: e.message }); return false; }
    throw e;
  }

  // 3. duplicates — fingerprint (exact), then probable (same payee/total within 45 days).
  const fingerprint = invoiceFingerprint(payee.id, ex.invoiceNumber, total, token);
  const dup = (await q<{ id: string }>("select id from invoices where entity_id = $1 and fingerprint = $2 and duplicate_of is null and id <> $3", [inv.entity_id, fingerprint, inv.id]))[0];
  if (dup) {
    await q("update invoices set duplicate_of = $2, payee_id = $3, status = 'held', hold_reason = 'duplicate' where id = $1", [inv.id, dup.id, payee.id]);
    await notify("invoice.held", { invoiceId: inv.id, reason: "duplicate" });
    return false;
  }
  const near = await q<{ invoice_number: string; invoice_date: string }>(
    "select invoice_number, invoice_date::text from invoices where entity_id = $1 and payee_id = $2 and total = $3 and id <> $4 and status <> 'rejected'",
    [inv.entity_id, payee.id, total.toString(), inv.id]);
  const probable = near.find((n) => isProbableDuplicate({ total, date: dates.invoiceDate, number: ex.invoiceNumber }, { total, date: n.invoice_date, number: n.invoice_number }));

  // Persist the normalized fields (these, not the model's strings, are what everything downstream uses).
  await q(
    `update invoices set payee_id = $2, invoice_number = $3, invoice_date = $4, due_date = $5, token = $6, total = $7, lines = $8,
       terms = $9, fingerprint = $10 where id = $1`,
    [inv.id, payee.id, ex.invoiceNumber, dates.invoiceDate, dates.dueDate, token, total.toString(),
      JSON.stringify(lines.map((l) => ({ ...l, quantity: l.quantity.toString(), unitPrice: l.unitPrice.toString(), amount: l.amount.toString() }))),
      JSON.stringify({ netDays: ex.terms.netDays, discountBps: ex.terms.discountPercent ? Number(parseAmount(ex.terms.discountPercent, 2)) : null, discountDays: ex.terms.discountDays }),
      fingerprint],
  );
  if (probable) { await hold(inv.id, "probable_duplicate", { similarTo: probable.invoice_number }); return false; }

  // 4. payee-substitution defense — the printed address is compared, never used.
  if (inv.printed_address && payee.account && inv.printed_address.toLowerCase() !== payee.account.toLowerCase()) {
    await q(
      `insert into payee_address_history(payee_id, old_account, new_account, source, source_document_id, status)
       values ($1,$2,$3,'invoice',$4,'proposed')`, [payee.id, payee.account, inv.printed_address, inv.document_id]);
    await hold(inv.id, "payee_address_changed", { oldAccount: payee.account, newAccount: inv.printed_address });
    return false;
  }

  // 5. three-way match.
  const poNumber = ex.poNumber;
  const poRow = poNumber ? (await q<any>("select * from purchase_orders where entity_id = $1 and po_number = $2 and payee_id = $3", [inv.entity_id, poNumber, payee.id]))[0] : null;
  const poLines: PoLine[] = poRow ? (poRow.lines as any[]).map((l) => ({ sku: l.sku, unitPrice: BigInt(l.unitPrice), qtyOrdered: BigInt(l.qty) })) : [];
  const receipts: ReceiptView[] = poRow
    ? (await q<any>("select id, kind, lines, evidence_hash from receipts where po_id = $1", [poRow.id])).map((r) => {
        const qtyBySku: Record<string, bigint> = {};
        const accepted: Record<string, boolean> = {};
        for (const l of r.lines as any[]) {
          if (l.sku && l.qtyReceived !== undefined) qtyBySku[l.sku] = (qtyBySku[l.sku] ?? 0n) + BigInt(l.qtyReceived);
          if (l.meter && l.units !== undefined) qtyBySku[l.meter] = (qtyBySku[l.meter] ?? 0n) + BigInt(l.units);
          if (l.milestone !== undefined) accepted[l.milestone] = Boolean(l.accepted);
        }
        return { id: r.id, kind: r.kind, evidenceHash: r.evidence_hash, qtyBySku, accepted };
      })
    : [];
  const prior = poRow ? await q<{ lines: any[] }>("select lines from invoices where po_id = $1 and status = 'obligated' and id <> $2", [poRow.id, inv.id]) : [];
  const alreadyInvoicedBySku: Record<string, bigint> = {};
  for (const p of prior) for (const l of p.lines ?? []) if (l.sku) alreadyInvoicedBySku[l.sku] = (alreadyInvoicedBySku[l.sku] ?? 0n) + BigInt(l.quantity);

  const doc = (await q<{ sha256: string }>("select sha256 from documents where id = $1", [inv.document_id]))[0]!;
  const match = threeWayMatch(
    { payeeId: payee.id, token, total, invoiceNumber: ex.invoiceNumber, documentSha256: doc.sha256, lines, alreadyInvoicedBySku },
    poRow ? {
      payeeId: poRow.payee_id, token: poRow.token, total: BigInt(poRow.total), invoiced: BigInt(poRow.invoiced), poNumber: poRow.po_number,
      lines: poLines, linesHash: canonicalRecord(poRow.lines).sha256, termsHash: canonicalRecord(poRow.terms).sha256,
    } : null,
    receipts,
  );
  await q("update invoices set po_id = $2, match_status = $3, match_detail = $4 where id = $1",
    [inv.id, poRow?.id ?? null, match.status, JSON.stringify({ problems: match.problems, bundle: match.bundle, evidenceHash: match.evidenceHash })]);
  if (match.status === "mismatch" || match.status === "no_po") { await hold(inv.id, match.status === "no_po" ? "no_po" : "mismatch", { problems: match.problems }); return false; }

  // 6. obligation — category from the payee record, never from the invoice. Partial ⇒ obligation for the matched portion only.
  const fp = fingerprint as Hex;
  const terms = { netDays: ex.terms.netDays, discountBps: ex.terms.discountPercent ? Number(parseAmount(ex.terms.discountPercent, 2)) : null, discountDays: ex.terms.discountDays };
  await q(
    `insert into obligations(entity_id, obligation_id, payee_id, invoice_id, source, category, token, amount, due_date, terms, criticality, evidence_hash, status)
     values ($1,$2,$3,$4,'invoice',$5,$6,$7,$8,$9,$10,$11,'open') on conflict (obligation_id) do nothing`,
    [inv.entity_id, makeObligationId(TREASURY, fp), payee.id, inv.id, payee.category, token, match.matchedAmount.toString(), dates.dueDate,
      JSON.stringify(terms), payee.kind === "contractor" ? 1 : 2, match.evidenceHash],
  );
  if (poRow) await q("update purchase_orders set invoiced = invoiced + $2 where id = $1", [poRow.id, match.matchedAmount.toString()]);
  await q("update invoices set status = 'obligated', hold_reason = $2 where id = $1", [inv.id, match.status === "partial" ? "partial_match" : null]);
  await notify("invoice.validated", { invoiceId: inv.id, matchStatus: match.status });
  return true;
}
