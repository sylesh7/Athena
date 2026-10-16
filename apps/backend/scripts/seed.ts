// Seeds the house-operations dataset through the public admin API (so everything goes through the real pipeline):
//   vendors/contractors/subscriptions (draft payees), vendor invoices (text documents the extractor reads), customers + receivables.
// Idempotent: existing payees/receivables (409) are skipped. Usage: pnpm seed   (API must be running; needs ADMIN_API_KEY)
// Seeded payee addresses are deterministic placeholders, NOT real vendors — the approver still has to activate each payee.
import { keccak256, toHex } from "viem";

const API = process.env.API_URL ?? `http://localhost:${process.env.API_PORT ?? 3100}`;
const KEY = process.env.ADMIN_API_KEY;
if (!KEY) throw new Error("ADMIN_API_KEY is not set");
const h = { "x-admin-key": KEY, "content-type": "application/json" };
const addr = (s: string) => `0x${keccak256(toHex(`athena-seed:${s}`)).slice(26)}`;
const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

async function post(path: string, body: unknown) {
  const r = await fetch(`${API}${path}`, { method: "POST", headers: h, body: JSON.stringify(body) });
  const t = await r.text();
  console.log(`${r.status === 409 ? "skip" : r.ok ? "ok  " : "FAIL"} ${path} ${r.status === 409 ? "(exists)" : r.ok ? "" : t.slice(0, 200)}`);
}

const payees = [
  { slug: "vendor:hosting", name: "Northwind Hosting", kind: "vendor", category: "VENDOR", email: "billing@northwind.example" },
  { slug: "vendor:design", name: "Pixel Studio", kind: "vendor", category: "VENDOR", email: "ar@pixelstudio.example" },
  { slug: "contractor:alex", name: "Alex Rivera (contractor)", kind: "contractor", category: "CONTRACTOR", email: "alex@example.com" },
  { slug: "service:eurusd", name: "EUR/USD rate feed (x402)", kind: "service", category: "SERVICES" },
  { slug: "vendor:saas-analytics", name: "Plotline Analytics (subscription)", kind: "vendor", category: "SUBSCRIPTION", email: "billing@plotline.example" },
] as const;
for (const p of payees) await post("/payees", { ...p, token: "USDC", domain: 26, account: addr(p.slug), perTxCap: "500" });

const invoices = [
  { file: "northwind-INV-2041.txt", text: `INVOICE INV-2041\nFrom: Northwind Hosting\nBill to: Athena Labs\nIssued: ${day(-10)}\nDue: ${day(5)}\nItem: Cloud hosting, monthly\nTotal due: 120.00 USDC\n` },
  { file: "pixel-INV-0187.txt", text: `INVOICE INV-0187\nFrom: Pixel Studio\nBill to: Athena Labs\nIssued: ${day(-3)}\nDue: ${day(14)}\nItem: Brand refresh, phase 1\nTotal due: 300.00 USDC\n` },
  { file: "plotline-INV-9912.txt", text: `INVOICE INV-9912\nFrom: Plotline Analytics\nBill to: Athena Labs\nIssued: ${day(-1)}\nDue: ${day(2)}\nItem: Analytics subscription\nTotal due: 49.00 USDC\n` },
];
for (const i of invoices) {
  const fd = new FormData();
  fd.append("file", new Blob([i.text], { type: "text/plain" }), i.file);
  const r = await fetch(`${API}/invoices/upload`, { method: "POST", headers: { "x-admin-key": KEY }, body: fd });
  console.log(`${r.ok ? "ok  " : "FAIL"} /invoices/upload ${i.file} ${r.status}`);
}

const recv = [
  { n: "ATH-1001", c: "Orbit Labs", amt: "250.00", due: day(10) },
  { n: "ATH-1002", c: "Kite Commerce", amt: "80.00", due: day(-2) },   // overdue: exercises dunning
  { n: "ATH-1003", c: "Lumen Collective", amt: "1200.00", due: day(30) },
];
for (const r of recv) await post("/receivables", { customer: { name: r.c, email: `ap@${r.c.toLowerCase().replace(/\W/g, "")}.example` }, invoiceNumber: r.n, token: "USDC", amount: r.amt, dueDate: r.due });
console.log("seed complete — approve the new payees in the Approvals page, then run a cycle.");
