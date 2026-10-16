// Receivables end to end on a real contract + Postgres: register on-chain, invoice + dunning emails (stub Resend server),
// payment indexing and the customer's payment history, and the x402 pay link's HTTP 402 (Circle testnet facilitator, live).
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWalletClient, http, parseAbi, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { abi, KEY, ONE, randAddr, rnd32, runnable, startHarness, USDC, type Harness } from "./helpers/harness.js";

const API_PORT = 18131;
const COLLECTIONS = privateKeyToAccount(KEY.stranger).address; // any public address works as the x402 seller here
let h: Harness;
let stub: Server;
let sent: Array<{ to: string[]; subject: string; text: string; attachments?: Array<{ filename: string; content: string }> }> = [];
let failNext = 0;
let url = "";
let collections: typeof import("../src/ar/collections.js");
let register: typeof import("../src/ar/receivables.js");
const cfg = (today: string) => ({ resendApiKey: "re_test", resendApiUrl: url, fromEmail: "billing@athena.test", fromName: "Athena Treasury", frontendUrl: "http://localhost:3000", publicBaseUrl: `http://127.0.0.1:${API_PORT}`, today });
const rows = (sql: string, p: unknown[] = []) => h.q<any>(sql, p);

async function newReceivable(slug: string, amountUsdc: bigint, due: string, opts: { email?: string | null; x402?: boolean } = {}) {
  const cust = (await rows("insert into customers(entity_id, name, email) values ($1,$2,$3) returning id", [h.entityId, `Cust ${slug}`, opts.email === undefined ? `${slug}@cust.test` : opts.email]))[0];
  const rid = rnd32();
  await rows(
    `insert into receivables(entity_id, receivable_id, customer_id, invoice_number, token, amount_due, due_date, status, x402_enabled)
     values ($1,$2,$3,$4,'USDC',$5,$6,'draft',$7)`, [h.entityId, rid, cust.id, slug, (amountUsdc * ONE).toString(), due, opts.x402 ?? true]);
  return { rid, custId: cust.id as string };
}

beforeAll(async () => {
  if (!runnable) return;
  h = await startHarness({ anvil: 18550, pg: 54340 });
  Object.assign(process.env, { API_PORT: String(API_PORT), ADMIN_API_KEY: "test-admin-key-0123456789abcdef0123", CORS_ORIGIN: "http://localhost:3000", PUBLIC_BASE_URL: `http://127.0.0.1:${API_PORT}`, FRONTEND_URL: "http://localhost:3000", COLLECTIONS_ADDRESS: COLLECTIONS });

  stub = createServer((req, res) => {
    let body = ""; req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (failNext > 0) { failNext--; res.writeHead(500); res.end('{"error":"boom"}'); return; }
      sent.push(JSON.parse(body)); res.writeHead(200, { "content-type": "application/json" }); res.end('{"id":"stub"}');
    });
  });
  await new Promise<void>((r) => stub.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(stub.address() as { port: number }).port}/emails`;

  collections = await import("../src/ar/collections.js");
  register = await import("../src/ar/receivables.js");
}, 300_000);

afterAll(async () => { stub?.close(); await h?.stop(); });

describe.skipIf(!runnable)("receivable registration (Phase 35.1)", () => {
  it("registers drafts on-chain: x402 receivables with customer = 0x0 so the collections wallet can settle them", async () => {
    const a = await newReceivable("INV-A", 100n, "2026-11-10", { x402: true });
    expect(await register.registerDraftReceivables(undefined)).toBe(1);
    const row = (await rows("select status, register_tx from receivables where receivable_id = $1", [a.rid]))[0];
    expect(row.status).toBe("open");
    expect(row.register_tx).toMatch(/^0x[0-9a-f]{64}$/);
    const onchain = (await h.pub.readContract({ address: h.treasury, abi, functionName: "getReceivable", args: [a.rid] })) as { customer: Address; amountDue: bigint; exists: boolean };
    expect(onchain.exists).toBe(true);
    expect(onchain.amountDue).toBe(100n * ONE);
    expect(onchain.customer).toBe("0x0000000000000000000000000000000000000000");
  }, 120_000);
});

describe.skipIf(!runnable)("collections (Phase 35.4)", () => {
  let r: { rid: string; custId: string };
  it("sends the invoice once (PDF attached, both pay links) and never again", async () => {
    r = await newReceivable("INV-B", 250n, "2026-11-10", { x402: true });
    await register.registerDraftReceivables(undefined);
    sent = [];
    expect(await collections.runCollections(cfg("2026-10-16"))).toEqual({ sent: 2, escalated: 0 }); // INV-A (registered earlier) and INV-B
    const mail = sent.find((m) => m.subject.includes("INV-B"))!;
    expect(mail.to).toEqual(["INV-B@cust.test"]);
    expect(mail.text).toContain(`http://localhost:3000/pay/${r.rid}`);
    expect(mail.text).toContain(`http://127.0.0.1:${API_PORT}/pay/${r.rid}`);
    expect(Buffer.from(mail.attachments![0]!.content, "base64").subarray(0, 5).toString()).toBe("%PDF-");
    expect((await rows("select stage from receivable_reminders where receivable_id = $1", [r.rid])).map((x) => x.stage)).toEqual([0]);
    expect(sent.filter((m) => m.subject.includes("INV-A"))).toHaveLength(1);

    sent = [];
    await collections.runCollections(cfg("2026-10-16"));
    expect(sent).toHaveLength(0); // idempotent across cycles
  }, 120_000);

  it("walks the ladder on schedule — one message per stage — and hands the human stage to a person", async () => {
    const b = () => sent.map((m) => m.subject).filter((s) => s.includes("INV-B"));
    sent = [];
    await collections.runCollections(cfg("2026-11-07")); // due − 3
    expect(b()).toEqual(["Reminder: invoice INV-B is due 2026-11-10"]);
    sent = [];
    await collections.runCollections(cfg("2026-11-08"));
    expect(b()).toHaveLength(0);
    await collections.runCollections(cfg("2026-11-10")); // due date
    await collections.runCollections(cfg("2026-11-17")); // due + 7
    expect(b()).toEqual(["Invoice INV-B is due today", "Overdue: invoice INV-B (250.000000 USDC)"]);

    sent = [];
    const out = await collections.runCollections(cfg("2026-11-24")); // due + 14 ⇒ human, no email
    expect(out.escalated).toBeGreaterThanOrEqual(1);
    expect(b()).toHaveLength(0);
    const stages = (await rows("select stage, channel from receivable_reminders where receivable_id = $1 order by stage", [r.rid])).map((x) => `${x.stage}:${x.channel}`);
    expect(stages).toEqual(["0:email", "1:email", "2:email", "3:email", "4:human"]);
    expect((await rows("select dunning_stage from receivables where receivable_id = $1", [r.rid]))[0].dunning_stage).toBe(4);
    sent = [];
    await collections.runCollections(cfg("2026-12-30"));
    expect(b()).toHaveLength(0); // nothing more for INV-B after the human stage
  }, 180_000);

  it("a failed send is not logged as sent and is retried next cycle", async () => {
    const x = await newReceivable("INV-C", 10n, "2026-12-01", { x402: false });
    await register.registerDraftReceivables(undefined);
    failNext = 1; sent = [];
    expect((await collections.runCollections(cfg("2026-10-16"))).sent).toBe(0);
    expect(await rows("select 1 from receivable_reminders where receivable_id = $1", [x.rid])).toHaveLength(0);
    expect((await collections.runCollections(cfg("2026-10-16"))).sent).toBe(1);
    expect(sent[0]!.text).not.toContain("/pay/"+"x402"); // wallet-only receivable: no agent link
    expect(sent[0]!.text).not.toContain(`127.0.0.1:${API_PORT}`);
  }, 120_000);

  it("no email address ⇒ nothing sent (a human delivers it); no Resend key ⇒ disabled without error", async () => {
    await newReceivable("INV-D", 10n, "2026-12-01", { email: null });
    await register.registerDraftReceivables(undefined);
    sent = [];
    await collections.runCollections(cfg("2026-10-16"));
    expect(sent.some((m) => m.subject.includes("INV-D"))).toBe(false);
    expect(await collections.runCollections({ ...cfg("2026-10-16"), resendApiKey: undefined })).toEqual({ sent: 0, escalated: 0 });
  }, 120_000);
});

describe.skipIf(!runnable)("payment indexing teaches the forecast (Phase 19/35)", () => {
  it("a paid receivable updates the customer's payment history; a partial one does not", async () => {
    const { indexOnce } = await import("../src/indexer/indexer.js");
    const x = await newReceivable("INV-E", 50n, "2026-01-01", { x402: true }); // long overdue ⇒ lateness is large
    await register.registerDraftReceivables(undefined);
    const payer = KEY.stranger;
    const mint = parseAbi(["function mint(address,uint256)", "function approve(address,uint256) returns (bool)"]);
    await h.send(KEY.deployer, USDC, mint as never, "mint", [privateKeyToAccount(payer).address, 100n * ONE]);
    await h.send(payer, USDC, mint as never, "approve", [h.treasury, 100n * ONE]);

    await h.send(payer, h.treasury, abi, "payReceivable", [x.rid, 20n * ONE]); // partial
    await indexOnce();
    let c = (await rows("select paid_count, avg_days_late::float from customers where id = $1", [x.custId]))[0];
    expect((await rows("select status from receivables where receivable_id = $1", [x.rid]))[0].status).toBe("partial");
    expect(c.paid_count).toBe(0);

    await h.send(payer, h.treasury, abi, "payReceivable", [x.rid, 30n * ONE]); // remainder
    await indexOnce();
    c = (await rows("select paid_count, avg_days_late::float from customers where id = $1", [x.custId]))[0];
    expect((await rows("select status from receivables where receivable_id = $1", [x.rid]))[0].status).toBe("paid");
    expect(c.paid_count).toBe(1);
    expect(c.avg_days_late).toBeGreaterThan(100); // paid ~9 months after the 2026-01-01 due date
  }, 180_000);
});

describe.skipIf(!runnable)("x402 pay link (Phase 35.2) — live Circle testnet facilitator", () => {
  it("returns a real HTTP 402 naming the collections wallet as payee and the exact outstanding amount", async () => {
    const x = await newReceivable("INV-F", 7n, "2026-12-15", { x402: true });
    await register.registerDraftReceivables(undefined);
    await import("../src/api.js"); // starts listening
    for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${API_PORT}/health`); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }

    const res = await fetch(`http://127.0.0.1:${API_PORT}/pay/${x.rid}`);
    expect(res.status).toBe(402);
    const headerB64 = res.headers.get("payment-required");
    const body = headerB64 ? JSON.parse(Buffer.from(headerB64, "base64").toString()) : await res.json();
    const accepts = body.accepts as Array<Record<string, any>>;
    expect(accepts.length).toBeGreaterThan(0);
    const arc = accepts.find((a) => String(a.network) === "eip155:5042002") ?? accepts[0]!;
    expect(String(arc.payTo).toLowerCase()).toBe(COLLECTIONS.toLowerCase());
    expect(String(arc.amount ?? arc.maxAmountRequired)).toBe((7n * ONE).toString());

    // unknown / wallet-only / unregistered receivables are refused before any payment is requested
    expect((await fetch(`http://127.0.0.1:${API_PORT}/pay/0x${"0".repeat(64)}`)).status).toBe(404);
    const wOnly = await newReceivable("INV-G", 7n, "2026-12-15", { x402: false });
    expect((await fetch(`http://127.0.0.1:${API_PORT}/pay/${wOnly.rid}`)).status).toBe(403);
  }, 120_000);
});
void createWalletClient; void http; void randAddr;
