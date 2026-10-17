// Generates realistic VENDOR invoice PDFs and seeds the matching PO + delivery receipt for each, so an uploaded invoice flows:
// upload -> extraction -> three-way match -> obligation -> decision.
//
//   tsx scripts/make-demo-invoice.ts all         -> 4 PDFs: REHEARSAL 1/2 and DEMO 1/2 (use this)
//   tsx scripts/make-demo-invoice.ts rehearsal   -> REHEARSAL 1 (pays) + REHEARSAL 2 (escalates)
//   tsx scripts/make-demo-invoice.ts demo        -> DEMO 1 (pays) + DEMO 2 (escalates)
//
//   pays      = Pixel Studio, ~2.xx USDC, due today -> under the 5 USDC approval limit -> PAID automatically
//   escalates = Alex Rivera,  ~7.xx USDC, due today -> over the 6 USDC contractor limit -> ESCALATES (Telegram + Approvals)
//
// EVERY run uses a brand-new invoice number AND an unused total for that vendor: Athena's duplicate guard holds any invoice from
// the same vendor with the same total within 45 days (even a held one), so reusing an amount would block the upload.
import { createHash, randomInt } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import PDFDocument from "pdfkit";
import { q, pool } from "../src/db.js";

type Kind = "pay" | "escalate";
const today = new Date().toISOString().slice(0, 10);
const issued = new Date(Date.now() - 5 * 864e5).toISOString().slice(0, 10);
const OUT = "../../docs/demo";
mkdirSync(OUT, { recursive: true });

const VENDORS = {
  pay: { slug: "vendor:design", name: "Pixel Studio", tagline: "Brand & icon design · hello@pixelstudio.example", sku: "ICON-SET", desc: "Custom icon set (24 icons)", prefix: "PX", range: [201, 299] as const },
  escalate: { slug: "contractor:alex", name: "Alex Rivera", tagline: "Freelance developer · alex@example.com", sku: "DEV-HRS", desc: "Smart-contract integration, 14 hours", prefix: "AX", range: [651, 799] as const },
};

async function uniqueCents(payeeId: string, range: readonly [number, number]): Promise<number> {
  const used = new Set((await q<{ total: string }>("select total::text from invoices where payee_id = $1", [payeeId])).map((r) => r.total));
  const usedPo = new Set((await q<{ total: string }>("select total::text from purchase_orders where payee_id = $1", [payeeId])).map((r) => r.total));
  for (let i = 0; i < 200; i++) {
    const cents = randomInt(range[0], range[1] + 1);
    const atomic = String(cents * 10_000);
    if (!used.has(atomic) && !usedPo.has(atomic)) return cents;
  }
  throw new Error("could not find an unused amount");
}

async function make(set: "REHEARSAL" | "DEMO", n: 1 | 2, kind: Kind): Promise<string> {
  const v = VENDORS[kind];
  const pay = (await q<{ id: string; entity_id: string }>("select id, entity_id from payees where slug = $1", [v.slug]))[0];
  if (!pay) throw new Error(`payee ${v.slug} not found`);
  const cents = await uniqueCents(pay.id, v.range);
  const amount = (cents / 100).toFixed(2), atomic = String(cents * 10_000);
  const tag = `${set === "DEMO" ? "D" : "R"}${n}${randomInt(1000, 9999)}`;
  const invoiceNo = `${v.prefix}-${tag}`, poNo = `PO-${v.prefix}-${tag}`;

  const po = await q<{ id: string }>(
    `insert into purchase_orders(entity_id, payee_id, po_number, token, total, terms, lines)
     values ($1,$2,$3,'USDC',$4,'{"netDays":0}'::jsonb,$5::jsonb) returning id`,
    [pay.entity_id, pay.id, poNo, atomic, JSON.stringify([{ sku: v.sku, description: v.desc, qty: "1", unitPrice: atomic }])]);
  await q(`insert into receipts(po_id, kind, lines, evidence_hash, accepted_by) values ($1,'delivery',$2::jsonb,$3,'demo-seed')`,
    [po[0]!.id, JSON.stringify([{ sku: v.sku, qtyReceived: "1" }]), "0x" + createHash("sha256").update(`receipt-${poNo}`).digest("hex")]);

  const doc = new PDFDocument({ size: "A4", margin: 56, info: { Title: `Invoice ${invoiceNo}`, Author: v.name } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((r) => doc.on("end", () => r()));
  doc.fontSize(24).text(v.name.toUpperCase()).fontSize(10).fillColor("#555").text(v.tagline).moveDown(1.5);
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
  doc.text(v.sku, 56, r).text(v.desc, 130, r, { width: 220 }).text("1", 360, r).text(amount, 400, r).text(amount, 480, r, { width: 60, align: "right" });
  doc.moveTo(56, r + 34).lineTo(539, r + 34).stroke();
  doc.font("Helvetica-Bold").fontSize(13).text(`Total due: ${amount} USDC`, 56, r + 48, { align: "right" }).font("Helvetica").fontSize(10).moveDown(2);
  doc.fillColor("#555").text("Terms: due on receipt. Payment in USDC on Arc. Thank you for your business.");
  doc.end();
  await done;

  const file = `${set}_${n}_${kind === "pay" ? "PAYS" : "ESCALATES"}_${v.name.replace(/ /g, "-")}_${amount}USDC_${invoiceNo}.pdf`;
  writeFileSync(`${OUT}/${file}`, Buffer.concat(chunks));
  console.log(`${set} ${n} (${kind === "pay" ? "gets PAID automatically" : "ESCALATES to a human + Telegram"}): docs/demo/${file}`);
  return file;
}

const mode = process.argv[2] ?? "all";
if (!["all", "rehearsal", "demo"].includes(mode)) throw new Error("usage: make-demo-invoice.ts all|rehearsal|demo");
if (mode === "all" || mode === "rehearsal") { await make("REHEARSAL", 1, "pay"); await make("REHEARSAL", 2, "escalate"); }
if (mode === "all" || mode === "demo") { await make("DEMO", 1, "pay"); await make("DEMO", 2, "escalate"); }
await pool.end();
