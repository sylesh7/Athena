// Phase 35.1 — a simple invoice PDF (line item, total, due date, both pay links). Pure rendering: bytes in memory.
import PDFDocument from "pdfkit";
import { formatAmount } from "@athena/shared/money";

export interface InvoicePdfInput {
  fromName: string; customerName: string; invoiceNumber: string; token: string; amountDue: bigint; issuedOn: string; dueDate: string;
  payUrl: string; agentPayUrl: string | null; receivableId: string;
}

export function renderInvoicePdf(i: InvoicePdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 56, info: { Title: `Invoice ${i.invoiceNumber}`, Author: i.fromName } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(22).text("INVOICE", { align: "right" });
    doc.fontSize(10).fillColor("#555").text(i.fromName, { align: "right" }).moveDown(2);
    doc.fillColor("#000").fontSize(11);
    doc.text(`Invoice number: ${i.invoiceNumber}`);
    doc.text(`Issued: ${i.issuedOn}`);
    doc.text(`Due: ${i.dueDate}`).moveDown();
    doc.text(`Bill to: ${i.customerName}`).moveDown(2);
    doc.fontSize(12).text("Description", 56, doc.y, { continued: true }).text("Amount", { align: "right" });
    doc.moveTo(56, doc.y + 4).lineTo(539, doc.y + 4).stroke().moveDown();
    doc.fontSize(11).text(`Services — invoice ${i.invoiceNumber}`, 56, doc.y, { continued: true }).text(`${formatAmount(i.amountDue)} ${i.token}`, { align: "right" });
    doc.moveDown(2).fontSize(14).text(`Total due: ${formatAmount(i.amountDue)} ${i.token}`, { align: "right" }).moveDown(2);
    doc.fontSize(10).fillColor("#000").text("Pay online (wallet):").fillColor("#0645ad").text(i.payUrl, { link: i.payUrl });
    if (i.agentPayUrl) doc.fillColor("#000").moveDown(0.5).text("Agent-payable (x402):").fillColor("#0645ad").text(i.agentPayUrl, { link: i.agentPayUrl });
    doc.fillColor("#777").fontSize(8).moveDown(2).text(`Receivable id (on-chain): ${i.receivableId}`);
    doc.end();
  });
}
