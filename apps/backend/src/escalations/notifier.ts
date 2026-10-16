// Phase 30 — when the contract sends a payment to a human, the right person hears about it within seconds. The
// backend has NO approver key: the human decides in the frontend with their own wallet. This module only notifies,
// and expires stale escalations so the next cycle re-plans with fresh numbers.
import { q, notify } from "../db.js";
import { log } from "../log.js";
import { escalationMessage } from "./message.js";

export async function notifyPendingEscalations(cfg: {
  telegramToken?: string | undefined; telegramChatId?: string | undefined; frontendUrl: string; tokenSymbol: (addr: string) => string;
}): Promise<number> {
  const rows = await q<{ decision_id: string; reason: number; expires_at: Date; record_json: string }>(
    `select e.decision_id, e.reason, e.expires_at, d.record_json from escalations e join decisions d using (decision_id)
     where e.status = 'pending' and e.notified_at is null`);
  let sent = 0;
  for (const e of rows) {
    const text = escalationMessage({ record: JSON.parse(e.record_json), reason: e.reason, expiresAt: e.expires_at, decisionId: e.decision_id, frontendUrl: cfg.frontendUrl, tokenSymbol: cfg.tokenSymbol });
    if (cfg.telegramToken && cfg.telegramChatId) {
      try {
        const res = await fetch(`https://api.telegram.org/bot${cfg.telegramToken}/sendMessage`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: cfg.telegramChatId, text, disable_web_page_preview: true }), signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw new Error(`telegram ${res.status}`);
      } catch (err) {
        log.warn({ err: String(err), decisionId: e.decision_id }, "escalation notification failed — will retry");
        continue;
      }
    } else {
      log.info({ decisionId: e.decision_id }, "escalation pending (no Telegram configured): \n" + text);
    }
    await q("update escalations set notified_at = now() where decision_id = $1", [e.decision_id]);
    sent++;
  }
  return sent;
}

/** Escalations past expires_at become `expired`; the obligation reopens and the next cycle re-plans. */
export async function expireEscalations(): Promise<number> {
  const expired = await q<{ decision_id: string }>(
    "update escalations set status = 'expired' where status = 'pending' and expires_at < now() returning decision_id");
  for (const e of expired) {
    await q(
      "update obligations set status = 'open' where obligation_id = (select obligation_id from decisions where decision_id = $1) and status = 'escalated'",
      [e.decision_id]);
    await notify("escalation.resolved", { decisionId: e.decision_id, status: "expired" });
  }
  return expired.length;
}
