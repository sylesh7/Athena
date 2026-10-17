// Generates a realistic VENDOR invoice PDF (Pixel Studio -> Athena Labs) and seeds the matching PO + delivery receipt, so the
// invoice flows: upload -> extraction -> three-way match -> obligation -> PAY_NOW (under the approval limit).
//   tsx scripts/make-demo-invoice.ts demo   -> docs/demo/pixel-studio-INV-DEMO-001.pdf   (upload this on camera)
//   tsx scripts/make-demo-invoice.ts test   -> a throwaway copy with its own PO, for rehearsal
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import PDFDocument from "pdfkit";
import { q, pool } from "../src/db.js";

const mode = process.argv[2] === "test" ? "test" : "demo";
const sfx = mode === "demo" ? "DEMO-001" : `TEST-${Date.now().toString(36).slice(-4).toUpperCase()}`;
const invoiceNo = `PX-${sfx}`, poNo = `PO-${sfx}`;
const today = new Date().toISOString().slice(0, 10);
const issued = new Date(Date.now() - 5 * 864e5).toISOString().slice(0, 10);
const AMOUNT = "2.50", ATOMIC = "2500000";

const pay = (await q<{ id: string; entity_id: string }>("select id, entity_id from payees where slug = 'vendor:design'"))[0];
if (!pay) throw new Error("payee vendor:design not found");
const po = await q<{ id: string }>(
  `insert into purchase_orders(entity_id, payee_id, po_number, token, total, terms, lines)
   values ($1,$2,$3,'USDC',$4,'{"netDays":0}'::jsonb,$5::jsonb) on conflict (entity_id, po_number) do nothing returning id`,
  [pay.entity_id, pay.id, poNo, ATOMIC, JSON.stringify([{ sku: "ICON-SET", description: "Custom icon set (24 icons)", qty: "1", unitPrice: ATOMIC }])]);
if (po[0]) {
  await q(`insert into receipts(po_id, kind, lines, evidence_hash, accepted_by) values ($1,'delivery',$2::jsonb,$3,'demo-seed')`,
    [po[0].id, JSON.stringify([{ sku: "ICON-SET", qtyReceived: "1" }]), "0x" + createHash("sha256").update(`receipt-${poNo}`).digest("hex")]);
  console.log(`seeded ${poNo} + delivery receipt`);
} else console.log(`${poNo} already exists`);

const doc = new PDFDocument({ size: "A4", margin: 56, info: { Title: `Invoice ${invoiceNo}`, Author: "Pixel Studio" } });
const chunks: Buffer[] = [];
doc.on("data", (c: Buffer) => chunks.push(c));
const done = new Promise<void>((r) => doc.on("end", () => r()));
doc.fontSize(24).text("PIXEL STUDIO", { align: "left" }).fontSize(10).fillColor("#555").text("Brand & icon design · hello@pixelstudio.example").moveDown(1.5);
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
doc.text("ICON-SET", 56, r).text("Custom icon set (24 icons)", 130, r, { width: 220 }).text("1", 360, r).text(AMOUNT, 400, r).text(AMOUNT, 480, r, { width: 60, align: "right" });
doc.moveTo(56, r + 22).lineTo(539, r + 22).stroke();
doc.font("Helvetica-Bold").fontSize(13).text(`Total due: ${AMOUNT} USDC`, 56, r + 36, { align: "right" }).font("Helvetica").fontSize(10).moveDown(2);
doc.fillColor("#555").text("Terms: due on receipt. Payment in USDC on Arc. Thank you for your business.");
doc.end();
await done;
const out = mode === "demo" ? "../../docs/demo/pixel-studio-INV-DEMO-001.pdf" : "../../docs/demo/_rehearsal-" + invoiceNo + ".pdf";
writeFileSync(out, Buffer.concat(chunks));
console.log("wrote", out.replace("../../", ""), `(${invoiceNo}, ${AMOUNT} USDC, PO ${poNo}, due ${today})`);
await pool.end();
