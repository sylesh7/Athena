// Phase 35 (partial) — worker side of AR. The API creates `draft` receivables; the operator screens a new customer
// and registers the receivable on-chain so every inflow names what it pays for. Dunning/email/x402 links come later.
import { net } from "@athena/shared/addresses";
import { commonCfg } from "../config.js";
import { q, notify } from "../db.js";
import { log } from "../log.js";
import { operatorWallet } from "../chain/clients.js";
import { Reverted, sendTreasury } from "../chain/tx.js";
import { screen } from "../payees/screening.js";

export async function registerDraftReceivables(circleApiKey: string | undefined): Promise<number> {
  const drafts = await q<{ id: string; receivable_id: string; token: "USDC" | "EURC"; amount_due: string; customer_id: string; wallet: string | null; risk_tier: string }>(
    `select r.id, r.receivable_id, r.token, r.amount_due::text, r.customer_id, c.wallet, c.risk_tier
     from receivables r join customers c on c.id = r.customer_id where r.status = 'draft' order by r.issued_at limit 20`);
  let n = 0;
  for (const r of drafts) {
    try {
      if (r.wallet && r.risk_tier === "unscreened") {
        if (!circleApiKey) { log.warn({ receivable: r.receivable_id }, "no CIRCLE_API_KEY — customer unscreened, receivable stays draft"); continue; }
        const s = await screen(r.wallet, circleApiKey);
        await q("update customers set risk_tier = $2 where id = $1", [r.customer_id, s.tier]);
        if (s.tier === "blocked") { await q("update receivables set status = 'written_off' where id = $1", [r.id]); await notify("customer.blocked", { receivableId: r.receivable_id }); continue; }
      }
      const token = net(commonCfg.NETWORK).tokens[r.token] as `0x${string}`;
      // customer = 0 when the payer may be someone else (e.g. the collections wallet for x402 payments).
      const { hash } = await sendTreasury(operatorWallet, "registerReceivable",
        [r.receivable_id, token, BigInt(r.amount_due), (r.wallet ?? "0x0000000000000000000000000000000000000000") as `0x${string}`], "registerReceivable");
      await q("update receivables set status = 'open', register_tx = $2 where id = $1", [r.id, hash]);
      n++;
    } catch (e) {
      if (e instanceof Reverted && e.errorName === "ReceivableExists") await q("update receivables set status = 'open' where id = $1", [r.id]);
      else log.error({ receivable: r.receivable_id, err: String(e) }, "registerReceivable failed — will retry");
    }
  }
  return n;
}
