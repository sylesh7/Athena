// Phase 39 — recompute every vendor's scorecard from what actually happened, and tighten the cap of a risky vendor on-chain.
import { q } from "../db.js";
import { log } from "../log.js";
import { operatorWallet } from "../chain/clients.js";
import { Reverted, sendTreasury } from "../chain/tx.js";
import { scoreVendor, tightenedCap, type VendorStats } from "./scorecard.js";

interface Row {
  id: string; slug: string; payee_id: string; category: string; token: string; per_tx_cap: string; status: string;
  invoices: number; matched: number; dups: number; addr: number; mism: number;
}

export async function recomputeScorecards(categoryApprovalLimit: (category: string, token: string) => bigint): Promise<{ updated: number; tightened: number }> {
  const rows = await q<Row>(
    `select p.id, p.slug, p.payee_id, p.category, p.token, p.per_tx_cap::text, p.status,
       (select count(*)::int from invoices i where i.payee_id = p.id and i.duplicate_of is null)                               as invoices,
       (select count(*)::int from invoices i where i.payee_id = p.id and i.duplicate_of is null and i.match_status = 'matched') as matched,
       (select count(*)::int from invoices i where i.payee_id = p.id and i.hold_reason in ('duplicate','probable_duplicate'))   as dups,
       (select count(*)::int from payee_address_history h where h.payee_id = p.id and h.source = 'invoice' and h.created_at > now() - interval '90 days') as addr,
       (select count(*)::int from invoices i where i.payee_id = p.id and i.hold_reason = 'mismatch')                           as mism
     from payees p where p.kind <> 'internal'`);
  let updated = 0, tightened = 0;
  for (const r of rows) {
    const stats: VendorStats = { invoices: r.invoices, matchedFirstTry: r.matched, duplicateAttempts: r.dups, addressChanges90d: r.addr, mismatches: r.mism, onTimeRate: null };
    const card = scoreVendor(stats);
    await q("update payees set scorecard = $2 where id = $1", [r.id, JSON.stringify({ ...card, computedAt: new Date().toISOString() })]);
    updated++;

    if (r.status !== "active") continue;
    const cap = tightenedCap({ score: card.score, categoryApprovalLimit: categoryApprovalLimit(r.category, r.token), currentCap: BigInt(r.per_tx_cap) });
    if (cap === null) continue;
    try {
      await sendTreasury(operatorWallet, "tightenPayeeCap", [r.payee_id, cap], `tighten cap ${r.slug} (score ${card.score})`);
      await q("update payees set per_tx_cap = $2 where id = $1", [r.id, cap.toString()]);
      tightened++;
    } catch (e) {
      if (e instanceof Reverted) log.warn({ payee: r.slug, error: e.errorName }, "tightenPayeeCap refused");
      else log.warn({ payee: r.slug, err: String(e) }, "tightenPayeeCap failed — will retry next cycle");
    }
  }
  return { updated, tightened };
}
