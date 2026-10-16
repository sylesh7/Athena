// Phase 24.1 / 24.3 — worker side of payee onboarding. The API only creates `draft` rows; the OPERATOR screens and
// proposes on-chain; only the human APPROVER (own wallet, in the frontend) can activate. Tiers are applied within
// the agent's authority: it may tighten a payee's cap on-chain, never loosen it.
import type { Hex } from "viem";
import { zeroHash } from "viem";
import { net } from "@athena/shared/addresses";
import { CATEGORY, type CategoryName } from "@athena/shared/categories";
import { commonCfg } from "../config.js";
import { q, notify } from "../db.js";
import { log } from "../log.js";
import { operatorWallet } from "../chain/clients.js";
import { Reverted, sendTreasury } from "../chain/tx.js";
import { RESCREEN_DAYS, screen, type RiskTier } from "./screening.js";

interface PayeeRow {
  id: string; payee_id: string; slug: string; name: string; category: CategoryName; token: "USDC" | "EURC";
  domain: number; account: string | null; remote_recipient: string | null; status: string; risk_tier: RiskTier | "unscreened"; per_tx_cap: string;
}

const padRemote = (r: string | null) => (r ?? zeroHash) as Hex;

/** draft → screen → (blocked: stop) → proposePayee → `proposed`. Unavailable screening leaves the row untouched for retry. */
export async function processPayeeDrafts(circleApiKey: string | undefined): Promise<number> {
  const drafts = await q<PayeeRow>("select * from payees where status = 'draft' order by created_at limit 20");
  let proposed = 0;
  for (const p of drafts) {
    const addr = p.account ?? null;
    if (addr) {
      if (!circleApiKey) { log.warn({ payee: p.slug }, "CIRCLE_API_KEY missing — payee stays draft (unscreened is never a pass)"); continue; }
      try {
        const s = await screen(addr, circleApiKey);
        await q("update payees set risk_tier = $2, last_screened_at = now() where id = $1", [p.id, s.tier]);
        if (s.tier === "blocked") {
          await q("update payees set status = 'rejected' where id = $1", [p.id]);
          await notify("payee.blocked", { payee: p.slug });
          continue;
        }
        p.risk_tier = s.tier;
      } catch (err) {
        log.warn({ payee: p.slug, err: String(err) }, "screening unavailable — will retry");
        continue;
      }
    }
    try {
      const cat = CATEGORY[p.category];
      const tokenAddr = net(commonCfg.NETWORK).tokens[p.token] as `0x${string}`;
      const { hash } = await sendTreasury(operatorWallet, "proposePayee", [
        p.payee_id,
        { account: (addr ?? "0x0000000000000000000000000000000000000000") as `0x${string}`, remoteRecipient: padRemote(p.remote_recipient), domain: p.domain, category: cat, token: tokenAddr, perTxCap: BigInt(p.per_tx_cap) },
      ], `proposePayee ${p.slug}`);
      await q("update payees set status = 'proposed' where id = $1", [p.id]);
      await q("insert into payee_address_history(payee_id, new_account, new_remote, source, proposed_tx, status) values ($1,$2,$3,'onboarding',$4,'proposed')", [p.id, addr, p.remote_recipient, hash]);
      proposed++;
    } catch (e) {
      if (e instanceof Reverted) { log.error({ payee: p.slug, error: e.errorName }, "proposePayee reverted"); await q("update payees set status = 'rejected' where id = $1", [p.id]); }
      else throw e;
    }
  }
  return proposed;
}

/**
 * Invoice address-change interception (Phase 24.3): for each `proposed` history row from an invoice, screen the new
 * address; low/medium ⇒ the operator proposes it as a CHANGE REQUEST (the old address stays payable until a human acts).
 */
export async function processAddressChanges(circleApiKey: string | undefined): Promise<number> {
  if (!circleApiKey) return 0;
  const rows = await q<{ hid: number; new_account: string; payee_row: string; payee_id: string; slug: string; category: CategoryName; token: "USDC" | "EURC"; domain: number; per_tx_cap: string }>(
    `select h.id as hid, h.new_account, p.id as payee_row, p.payee_id, p.slug, p.category, p.token, p.domain, p.per_tx_cap::text
     from payee_address_history h join payees p on p.id = h.payee_id
     where h.source = 'invoice' and h.status = 'proposed' and h.proposed_tx is null and p.status = 'active'`);
  let n = 0;
  for (const r of rows) {
    try {
      const s = await screen(r.new_account, circleApiKey);
      if (s.tier === "high" || s.tier === "blocked") {
        await q("update payee_address_history set status = 'rejected' where id = $1", [r.hid]);
        await notify("payee.change_blocked", { payee: r.slug });
        continue;
      }
      const { hash } = await sendTreasury(operatorWallet, "proposePayee", [
        r.payee_id,
        { account: r.new_account as `0x${string}`, remoteRecipient: zeroHash, domain: r.domain, category: CATEGORY[r.category], token: net(commonCfg.NETWORK).tokens[r.token] as `0x${string}`, perTxCap: BigInt(r.per_tx_cap) },
      ], `propose address change ${r.slug}`);
      await q("update payee_address_history set proposed_tx = $2 where id = $1", [r.hid, hash]);
      await notify("payee.change_proposed", { payee: r.slug });
      n++;
    } catch (err) {
      log.warn({ payee: r.slug, err: String(err) }, "address change handling failed — will retry");
    }
  }
  return n;
}

/** Re-screen active payees on their tier's cadence; a worse tier tightens the on-chain cap (never loosens). */
export async function rescreenDue(circleApiKey: string | undefined, categoryApprovalLimit: (category: string, token: string) => bigint): Promise<void> {
  if (!circleApiKey) return;
  const due = await q<PayeeRow>(
    `select * from payees where status = 'active' and account is not null and
       (last_screened_at is null or last_screened_at < now() - make_interval(days => case risk_tier when 'low' then $1::int when 'medium' then $2::int else $3::int end))`,
    [RESCREEN_DAYS.low, RESCREEN_DAYS.medium, RESCREEN_DAYS.high]);
  for (const p of due) {
    try {
      const s = await screen(p.account!, circleApiKey);
      await q("update payees set risk_tier = $2, last_screened_at = now() where id = $1", [p.id, s.tier]);
      if (s.tier === "medium") {
        const half = categoryApprovalLimit(p.category, p.token) / 2n;
        const cur = BigInt(p.per_tx_cap);
        if (half > 0n && (cur === 0n || half < cur)) await sendTreasury(operatorWallet, "tightenPayeeCap", [p.payee_id, half], `tighten cap ${p.slug}`);
      } else if (s.tier === "high" || s.tier === "blocked") {
        await notify("payee.suspend_requested", { payee: p.slug, tier: s.tier }); // only a human can suspend
      }
    } catch (err) {
      log.warn({ payee: p.slug, err: String(err) }, "re-screen unavailable — tier unchanged");
    }
  }
}
