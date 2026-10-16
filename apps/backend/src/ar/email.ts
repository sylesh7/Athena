// Phase 35 — reminder emails. Templates are plain code: amounts, dates and PAY LINKS are inserted by code, never by a
// model, so a draft can never point to the wrong place, change an amount, or promise a discount. Sending is a Resend REST
// call (RESEND_API_URL overridable for tests).
import { formatAmount } from "@athena/shared/money";

export interface EmailInput {
  stage: 0 | 1 | 2 | 3;
  customerName: string;
  invoiceNumber: string;
  token: string;
  outstanding: bigint;
  dueDate: string;
  payUrl: string;
  agentPayUrl: string | null;
  fromName: string;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function renderEmail(i: EmailInput): { subject: string; text: string; html: string } {
  const amount = `${formatAmount(i.outstanding)} ${i.token}`;
  const subject =
    i.stage === 0 ? `Invoice ${i.invoiceNumber} — ${amount} due ${i.dueDate}`
    : i.stage === 1 ? `Reminder: invoice ${i.invoiceNumber} is due ${i.dueDate}`
    : i.stage === 2 ? `Invoice ${i.invoiceNumber} is due today`
    : `Overdue: invoice ${i.invoiceNumber} (${amount})`;
  const lead =
    i.stage === 0 ? `Please find invoice ${i.invoiceNumber} for ${amount}, due ${i.dueDate}.`
    : i.stage === 1 ? `A friendly reminder that invoice ${i.invoiceNumber} for ${amount} is due on ${i.dueDate}.`
    : i.stage === 2 ? `Invoice ${i.invoiceNumber} for ${amount} is due today.`
    : `Invoice ${i.invoiceNumber} for ${amount} was due on ${i.dueDate} and is now overdue. Please arrange payment at your earliest convenience.`;
  const lines = [`Hi ${i.customerName},`, "", lead, "", `Pay online: ${i.payUrl}`];
  if (i.agentPayUrl) lines.push(`Agent-payable (x402) link: ${i.agentPayUrl}`);
  lines.push("", `If you have already paid, thank you — please ignore this message.`, "", `${i.fromName}`);
  const text = lines.join("\n");
  const html = `<p>Hi ${esc(i.customerName)},</p><p>${esc(lead)}</p><p><a href="${esc(i.payUrl)}">Pay online</a>${
    i.agentPayUrl ? ` · <a href="${esc(i.agentPayUrl)}">Agent-payable (x402) link</a>` : ""
  }</p><p>If you have already paid, thank you — please ignore this message.</p><p>${esc(i.fromName)}</p>`;
  return { subject, text, html };
}

export async function sendEmail(args: {
  apiKey: string; from: string; to: string; subject: string; text: string; html: string;
  attachments?: Array<{ filename: string; contentBase64: string }>; apiUrl?: string | undefined;
}): Promise<{ ok: boolean; detail: string }> {
  const res = await fetch(args.apiUrl ?? "https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${args.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: args.from, to: [args.to], subject: args.subject, text: args.text, html: args.html,
      ...(args.attachments?.length ? { attachments: args.attachments.map((a) => ({ filename: a.filename, content: a.contentBase64 })) } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.text()).slice(0, 300);
  return { ok: res.ok, detail: `${res.status} ${body}` };
}
