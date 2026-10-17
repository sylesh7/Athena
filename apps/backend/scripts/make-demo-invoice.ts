// Generates a realistic VENDOR invoice PDF and seeds the matching PO + delivery receipt, so the invoice flows:
// upload -> extraction -> three-way match -> obligation -> decision.
//   tsx scripts/make-demo-invoice.ts demo       Pixel Studio, 2.50 USDC  -> docs/demo/pixel-studio-INV-DEMO-001.pdf   (PAID automatically: under the approval limit)
//   tsx scripts/make-demo-invoice.ts escalate   Alex Rivera,  7.00 USDC  -> docs/demo/alex-rivera-INV-DEMO-002-ESCALATE.pdf (over the 6 USDC contractor limit: ESCALATES to a human + Telegram)
//   tsx scripts/make-demo-invoice.ts test       throwaway Pixel Studio copy with a fresh invoice number (rehearsal)
//   tsx scripts/make-demo-invoice.ts test-escalate   throwaway escalating copy (rehearsal)
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import PDFDocument from "pdfkit";
import { q, pool } from "../src/db.js";

const arg = process.argv[2] ?? "demo";
const escalate = arg.endsWith("escalate");
const rehearsal = arg.startsWith("test");
const v = escalate
  ? { slug: "contractor:alex", name: "Alex Rivera", tagline: "Freelance developer · alex@example.com", sku: "DEV-HRS", desc: "Smart-contract integration, 14 hours", amount: "7.00", atomic: "7000000", prefix: "AX", file: "alex-rivera-INV-DEMO-002-ESCALATE" }
  : { slug: "vendor:design", name: "Pixel Studio", tagline: "Brand & icon design · hello@pixelstudio.example", sku: "ICON-SET", desc: "Custom icon set (24 icons)", amount: "2.50", atomic: "2500000", prefix: "PX", file: "pixel-studio-INV-DEMO-001" };
const sfx = rehearsal ? `TEST-${Date.now().toString(36).slice(-4).toUpperCase()}` : escalate ? "DEMO-002" : "DEMO-001";
const invoiceNo = `${v.prefix}-${sfx}`, poNo = `PO-${v.prefix}-${sfx}`;
const today = new Date().toISOString().slice(0, 10);
const issued = new Date(Date.now() - 5 * 864e5).toISOString().slice(0, 10);

const pay = (await q<{ id: string; entity_id: string }>("select id, entity_id from payees where slug = $1", [v.slug]))[0];
if (!pay) throw new Error(`payee ${v.slug} not found`);
const po = await q<{ id: string }>(
  `insert into purchase_orders(entity_id, payee_id, po_number, token, total, terms, lines)
   values ($1,$2,$3,'USDC',$4,'{"netDays":0}'::jsonb,$5::jsonb) on conflict (entity_id, po_number) do nothing returning id`,
  [pay.entity_id, pay.id, poNo, v.atomic, JSON.stringify([{ sku: v.sku, description: v.desc, qty: "1", unitPrice: v.atomic }])]);
if (po[0]) {
  await q(`insert into receipts(po_id, kind, lines, evidence_hash, accepted_by) values ($1,'delivery',$2::jsonb,$3,'demo-seed')`,
    [po[0].id, JSON.stringify([{ sku: v.sku, qtyReceived: "1" }]), "0x" + createHash("sha256").update(`receipt-${poNo}`).digest("hex")]);
  console.log(`seeded ${poNo} + delivery receipt`);
} else console.log(`${poNo} already exists`);

const doc = new PDFDocument({ size: "A4", margin: 56, info: { Title: `Invoice ${invoiceNo}`, Author: v.name } });
const chunks: Buffer[] = [];
doc.on("data", (c: Buffer) => chunks.push(c));
const done = new Promise<void>((r) => doc.on("end", () => r()));
doc.fontSize(24).text(v.name.toUpperCase(), { align: "left" }).fontSize(10).fillColor("#555").text(v.tagline).moveDown(1.5);
doc.fillColor("#000").fontSize(20).text("INVOICE", { align: "right" }).moveDown(0.5);
doc.fontSize(11);
doc.text(`Invoice number: ${invoiceNo}`, { align: "right" });
doc.text(`Issue date: ${issued}`, { align: "right" });
doc.text(`Due date: ${today}`, { align: "right" });
doc.text(`PO number: ${poNo}`, { align: "right" }).moveDown(1.5);
doc.text("Bill to:").font("Helvetica-Bold").text("Athena Labs (house operations)").font("Helvetica").moveDown(1.5);
const y = doc.y;
doc.font("Helvetica-Bold").text("SKU", 56, y).text("Description", 130, y).text("Qty", 360, y).text("Unit price", 400, y).text("Amount", 480, y, { width: 60, align: "right" }).font("Helvetica");
doc.moveTo(56, y + 16).lineTo(539, y + 16).stroke();
const r = y + 24;
doc.text(v.sku, 56, r).text(v.desc, 130, r, { width: 220 }).text("1", 360, r).text(v.amount, 400, r).text(v.amount, 480, r, { width: 60, align: "right" });
doc.moveTo(56, r + 34).lineTo(539, r + 34).stroke();
doc.font("Helvetica-Bold").fontSize(13).text(`Total due: ${v.amount} USDC`, 56, r + 48, { align: "right" }).font("Helvetica").fontSize(10).moveDown(2);
doc.fillColor("#555").text("Terms: due on receipt. Payment in USDC on Arc. Thank you for your business.");
doc.end();
await done;
const out = rehearsal ? `../../docs/demo/_rehearsal-${invoiceNo}.pdf` : `../../docs/demo/${v.file}.pdf`;
writeFileSync(out, Buffer.concat(chunks));
console.log("wrote", out.replace("../../", ""), `(${invoiceNo}, ${v.amount} USDC, PO ${poNo}, due ${today})`);
await pool.end();
