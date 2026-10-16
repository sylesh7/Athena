// Phase 35.4 — collections. Runs every cycle: issues the invoice email (stage 0, PDF attached) for newly-registered
// receivables, then walks the dunning ladder. Stage 4 stops automatic email and raises a human review. Each stage is logged
// in receivable_reminders (unique per receivable+stage+channel) so it is never sent twice, even across crashes/restarts.
import { q, sb, notify } from "../db.js";
import { log } from "../log.js";
import { nextStage } from "./dunning.js";
import { renderEmail, sendEmail } from "./email.js";
import { renderInvoicePdf } from "./pdf.js";

export interface CollectionsCfg {
  resendApiKey: string | undefined; resendApiUrl?: string | undefined; fromEmail: string | undefined; fromName: string;
  frontendUrl: string; publicBaseUrl: string | undefined; today?: string;
}

interface Row {
  receivable_id: string; invoice_number: string; token: string; amount_due: string; amount_paid: string; due_date: string; issued_at: string;
  x402_enabled: boolean; customer_name: string; email: string | null; avg_days_late: string; stages: number[] | null;
}

export async function runCollections(cfg: CollectionsCfg): Promise<{ sent: number; escalated: number }> {
  if (!cfg.resendApiKey || !cfg.fromEmail) { log.info("collections: RESEND_API_KEY/FROM_EMAIL not set — no emails will be sent"); return { sent: 0, escalated: 0 }; }
  const today = cfg.today ?? new Date().toISOString().slice(0, 10);
  const rows = await q<Row>(
    `select r.receivable_id, r.invoice_number, r.token, r.amount_due::text, r.amount_paid::text, r.due_date::text, r.issued_at::text, r.x402_enabled,
            c.name as customer_name, c.email, c.avg_days_late::text,
            (select array_agg(stage) from receivable_reminders rr where rr.receivable_id = r.receivable_id) as stages
     from receivables r join customers c on c.id = r.customer_id
     where r.status in ('open','partial') order by r.due_date`);
  let sent = 0, escalated = 0;

  for (const r of rows) {
    const done = r.stages ?? [];
    const outstanding = BigInt(r.amount_due) - BigInt(r.amount_paid);
    const payUrl = `${cfg.frontendUrl}/pay/${r.receivable_id}`;
    const agentPayUrl = r.x402_enabled && cfg.publicBaseUrl ? `${cfg.publicBaseUrl}/pay/${r.receivable_id}` : null;
    const base = { customerName: r.customer_name, invoiceNumber: r.invoice_number, token: r.token, outstanding, dueDate: r.due_date, payUrl, agentPayUrl, fromName: cfg.fromName };

    // Stage 0: the invoice itself, once, as soon as it is registered.
    if (!done.includes(0)) {
      if (!r.email) continue; // nobody to email; a human delivers it
      const pdf = await renderInvoicePdf({
        fromName: cfg.fromName, customerName: r.customer_name, invoiceNumber: r.invoice_number, token: r.token, amountDue: BigInt(r.amount_due),
        issuedOn: r.issued_at.slice(0, 10), dueDate: r.due_date, payUrl, agentPayUrl, receivableId: r.receivable_id,
      });
      const m = renderEmail({ ...base, stage: 0 });
      const res = await sendEmail({ apiKey: cfg.resendApiKey, apiUrl: cfg.resendApiUrl, from: cfg.fromEmail, to: r.email, ...m, attachments: [{ filename: `${r.invoice_number}.pdf`, contentBase64: pdf.toString("base64") }] });
      if (res.ok) {
        await q("insert into receivable_reminders(receivable_id, stage, ok, detail) values ($1,0,true,$2) on conflict do nothing", [r.receivable_id, res.detail]);
        // Keep the PDF (best effort): the invoice as sent is evidence.
        try {
          const path = `receivables/${r.receivable_id}.pdf`;
          const up = await sb.storage.from("documents").upload(path, pdf, { contentType: "application/pdf", upsert: true });
          if (!up.error) await q("update receivables set pdf_path = $2 where receivable_id = $1", [r.receivable_id, path]);
        } catch { /* storage is optional here */ }
        sent++;
      } else log.warn({ receivable: r.receivable_id, detail: res.detail }, "invoice email failed — will retry next cycle");
      continue;
    }

    const stage = nextStage({ dueDate: r.due_date, today, avgDaysLate: Number(r.avg_days_late), sent: done });
    if (!stage) continue;

    if (stage.stage === 4) {
      await q("insert into receivable_reminders(receivable_id, stage, channel, ok, detail) values ($1,4,'human',true,'escalated to a human') on conflict do nothing", [r.receivable_id]);
      await q("update receivables set dunning_stage = 4, next_reminder_at = null where receivable_id = $1", [r.receivable_id]);
      await notify("receivable.escalated", { receivableId: r.receivable_id, customer: r.customer_name, outstanding: outstanding.toString() });
      escalated++;
      continue;
    }
    if (!r.email) continue;
    const m = renderEmail({ ...base, stage: stage.stage as 1 | 2 | 3 });
    const res = await sendEmail({ apiKey: cfg.resendApiKey, apiUrl: cfg.resendApiUrl, from: cfg.fromEmail, to: r.email, ...m });
    if (res.ok) {
      await q("insert into receivable_reminders(receivable_id, stage, ok, detail) values ($1,$2,true,$3) on conflict do nothing", [r.receivable_id, stage.stage, res.detail]);
      await q("update receivables set dunning_stage = $2 where receivable_id = $1", [r.receivable_id, stage.stage]);
      sent++;
    } else log.warn({ receivable: r.receivable_id, stage: stage.stage, detail: res.detail }, "reminder email failed — will retry next cycle");
  }
  return { sent, escalated };
}
