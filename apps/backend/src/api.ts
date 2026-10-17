// REST + SSE API (port 3100). Read-mostly, holds NO operator key. There is deliberately no endpoint that
// moves treasury money: money moves only when the worker executes a committed decision, or when a human
// signs a contract call in their own wallet.
import "./config.js";
import cors from "cors";
import express from "express";
import pg from "pg";
import { sha256Hex } from "@athena/shared/canonical";
import { z } from "zod";
import { commonCfg, loadApiCfg } from "./config.js";
import { pool, q } from "./db.js";
import { log } from "./log.js";
import { pub, readDecision, TREASURY, treasuryAbi } from "./chain/readClient.js";
import { SignatureError, verifySignedAction, type SignedAction } from "./api/signed.js";
import { net } from "@athena/shared/addresses";
import multer from "multer";
import { createGatewayMiddleware } from "@circle-fin/x402-batching/server";
import { isAddress } from "viem";
import { payeeId as makePayeeId, receivableId as makeReceivableId } from "@athena/shared/ids";
import { parseAmount, AmountError, formatAmount } from "@athena/shared/money";
import { intakeDocument, IntakeError } from "./ingest/intake.js";

const api = loadApiCfg();
const app = express();
app.use(cors({ origin: api.CORS_ORIGIN.split(",") }));
app.use(express.json({ limit: "1mb" }));

// BigInt-safe JSON; money is never a JS number.
app.set("json replacer", (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v));

const explorer = net(commonCfg.NETWORK).explorer;
const txUrl = (h: string | null) => (h ? `${explorer}/tx/${h}` : null);
const wrap = (fn: express.RequestHandler): express.RequestHandler => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch((err) => {
    log.error({ err: String(err), path: req.path }, "request failed");
    res.status(500).json({ error: { code: "internal", message: err instanceof Error ? err.message : String(err) } });
  });
const bad = (res: express.Response, status: number, code: string, message: string) =>
  res.status(status).json({ error: { code, message } });

const page = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), cursor: z.string().optional() });

const adminOnly: express.RequestHandler = (req, res, next) => {
  if (req.header("x-admin-key") !== api.ADMIN_API_KEY) return bad(res, 401, "unauthorized", "missing or wrong x-admin-key");
  next();
};

// ── Dashboard ────────────────────────────────────────────────────────────────────────────────
app.get("/health", wrap(async (_req, res) => {
  const [block, paused, overdue] = await Promise.all([
    pub.getBlockNumber(),
    pub.readContract({ address: TREASURY, abi: treasuryAbi, functionName: "paused" }),
    pub.readContract({ address: TREASURY, abi: treasuryAbi, functionName: "overdueCount" }),
  ]);
  const last = (await q("select finished_at from cycles where status = 'done' order by finished_at desc limit 1"))[0];
  res.json({
    ok: true, network: commonCfg.NETWORK, chainId: pub.chain?.id, treasury: TREASURY,
    block: block.toString(), lastCycleAt: last?.finished_at ?? null, paused, overdueCount: (overdue as bigint).toString(),
  });
}));

app.get("/treasury/overview", wrap(async (_req, res) => {
  const c = (await q("select id, snapshot, snapshot_hash, started_at from cycles where snapshot is not null order by started_at desc limit 1"))[0];
  if (!c) return bad(res, 404, "no_snapshot", "no cycle has produced a snapshot yet");
  res.json({ cycleId: c.id, snapshotHash: c.snapshot_hash, takenAt: c.started_at, ...c.snapshot });
}));

app.get("/treasury/forecast", wrap(async (_req, res) => {
  const c = (await q("select id, forecast, forecast_hash from cycles where forecast is not null order by started_at desc limit 1"))[0];
  if (!c) return bad(res, 404, "no_forecast", "no cycle has produced a forecast yet");
  res.json({ cycleId: c.id, forecastHash: c.forecast_hash, ...c.forecast });
}));

// ── Obligations / invoices ───────────────────────────────────────────────────────────────────
app.get("/obligations", wrap(async (req, res) => {
  const p = page.parse(req.query);
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const payee = typeof req.query.payee === "string" ? req.query.payee : null;
  const rows = await q(
    `select o.*, p.name as payee_name, p.slug as payee_slug from obligations o join payees p on p.id = o.payee_id
     where ($1::text is null or o.status = $1) and ($2::text is null or p.slug = $2)
       and ($3::timestamptz is null or o.created_at < $3)
     order by o.created_at desc limit $4`,
    [status, payee, p.cursor ?? null, p.limit],
  );
  res.json({ items: rows, nextCursor: rows.length === p.limit ? rows[rows.length - 1].created_at : null });
}));

app.get("/obligations/:id", wrap(async (req, res) => {
  const o = (await q("select o.*, p.name as payee_name from obligations o join payees p on p.id = o.payee_id where o.obligation_id = $1 or o.id::text = $1", [req.params.id]))[0];
  if (!o) return bad(res, 404, "not_found", "unknown obligation");
  const invoice = o.invoice_id ? (await q("select * from invoices where id = $1", [o.invoice_id]))[0] ?? null : null;
  const decisions = await q("select decision_id, kind, state, revealed, created_at from decisions where obligation_id = $1 order by created_at", [o.obligation_id]);
  res.json({ ...o, invoice, evidenceBundle: invoice?.match_detail ?? null, decisions });
}));

app.get("/invoices", wrap(async (req, res) => {
  const p = page.parse(req.query);
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const rows = await q(
    // Early holds (unknown vendor, bad amount…) never reach normalization, so fall back to what the model extracted for DISPLAY only.
    `select i.id, coalesce(i.invoice_number, i.extracted->>'invoiceNumber') as invoice_number, i.payee_id, i.token, i.total, i.due_date, i.status, i.hold_reason,
            i.match_status, i.created_at, coalesce(p.name, i.extracted->>'vendorName') as payee_name, i.extracted->>'total' as printed_total,
            i.extracted->>'currency' as printed_currency
     from invoices i left join payees p on p.id = i.payee_id
     where ($1::text is null or i.status = $1) and ($2::timestamptz is null or i.created_at < $2)
     order by i.created_at desc limit $3`,
    [status, p.cursor ?? null, p.limit],
  );
  res.json({ items: rows, nextCursor: rows.length === p.limit ? rows[rows.length - 1].created_at : null });
}));

app.get("/invoices/:id", wrap(async (req, res) => {
  const inv = (await q("select * from invoices where id::text = $1", [req.params.id]))[0];
  if (!inv) return bad(res, 404, "not_found", "unknown invoice");
  res.json(inv); // extraction is a model SUGGESTION; normalized fields are the code-validated ones
}));

const resolveBody = z.object({
  verdict: z.enum(["release", "reject", "mark_distinct"]),
  nonce: z.string().min(8), issuedAt: z.string(), signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
});

app.post("/invoices/:id/resolve", wrap(async (req, res) => {
  const b = resolveBody.safeParse(req.body);
  if (!b.success) return bad(res, 400, "bad_request", b.error.message);
  const inv = (await q("select id, status from invoices where id::text = $1", [req.params.id]))[0];
  if (!inv) return bad(res, 404, "not_found", "unknown invoice");
  if (inv.status !== "held") return bad(res, 409, "not_held", `invoice is ${inv.status}, not held`);
  try {
    const signer = await verifySignedAction({
      action: "invoice.resolve", target: inv.id, verdict: b.data.verdict,
      nonce: b.data.nonce, issuedAt: b.data.issuedAt, signature: b.data.signature as `0x${string}`,
    });
    // Release re-enters validation; the worker re-runs matching rather than trusting the human blindly.
    const next = b.data.verdict === "reject" ? "rejected" : "validated";
    await q("update invoices set status = $2, hold_reason = case when $2 = 'rejected' then hold_reason else null end where id = $1", [inv.id, next]);
    await pool.query("select pg_notify('athena_events', $1)", [JSON.stringify({ type: "invoice.resolved", invoiceId: inv.id, verdict: b.data.verdict, by: signer })]);
    res.json({ ok: true, status: next, by: signer });
  } catch (e) {
    if (e instanceof SignatureError) return bad(res, e.code === "replay" ? 409 : 401, e.code, e.message);
    throw e;
  }
}));

// ── Payees / escalations ─────────────────────────────────────────────────────────────────────
app.get("/payees", wrap(async (_req, res) => {
  res.json({ items: await q("select * from payees order by created_at desc") });
}));
app.get("/payees/:id", wrap(async (req, res) => {
  const p = (await q("select * from payees where slug = $1 or payee_id = $1 or id::text = $1", [req.params.id]))[0];
  if (!p) return bad(res, 404, "not_found", "unknown payee");
  const history = await q("select * from payee_address_history where payee_id = $1 order by created_at desc", [p.id]);
  res.json({ ...p, addressHistory: history });
}));

app.get("/escalations", wrap(async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const rows = await q(
    `select e.*, d.kind, d.action, d.record_json, d.created_at as decision_created_at, p.name as payee_name,
            coalesce(o.token, 'USDC') as token, coalesce(d.action->>'amount', o.amount::text, '0') as amount
     from escalations e join decisions d using (decision_id)
     left join obligations o on o.obligation_id = d.obligation_id
     left join payees p on p.payee_id = d.action->>'payeeId'
     where ($1::text is null or e.status = $1) order by e.expires_at`, [status]);
  res.json({ items: rows.map((r) => ({ ...r, record: JSON.parse(r.record_json), record_json: undefined })) });
}));
app.get("/escalations/:id", wrap(async (req, res) => {
  const r = (await q(`select e.*, d.kind, d.action, d.record_json from escalations e join decisions d using (decision_id) where e.decision_id = $1`, [req.params.id]))[0];
  if (!r) return bad(res, 404, "not_found", "unknown escalation");
  res.json({ ...r, record: JSON.parse(r.record_json), record_json: undefined });
}));

// ── Audit trail ──────────────────────────────────────────────────────────────────────────────
app.get("/decisions", wrap(async (req, res) => {
  const p = page.parse(req.query);
  const kind = typeof req.query.kind === "string" ? req.query.kind : null;
  const state = typeof req.query.state === "string" ? req.query.state : null;
  const rows = await q(
    `select d.decision_id, d.cycle_id, d.seq, d.kind, d.obligation_id, d.state, d.revealed, d.commit_tx, d.execute_tx, d.reveal_tx, d.scenario, d.created_at,
            d.decision_hash, p.name as payee_name, o.token as token, coalesce(d.action->>'amount', o.amount::text, '0') as amount,
            coalesce(d.record_json::jsonb->'planner'->>'rationale', d.record_json::jsonb->>'rationale') as rationale
     from decisions d
     left join obligations o on o.obligation_id = d.obligation_id
     left join payees p on p.payee_id = d.action->>'payeeId' or p.id = o.payee_id
     where ($1::text is null or d.kind = $1) and ($2::text is null or d.state = $2)
       and ($3::timestamptz is null or d.created_at < $3) order by d.created_at desc limit $4`,
    [kind, state, p.cursor ?? null, p.limit],
  );
  res.json({ items: rows.map((r) => ({ ...r, explorer: { commit: txUrl(r.commit_tx), execute: txUrl(r.execute_tx), reveal: txUrl(r.reveal_tx) } })),
    nextCursor: rows.length === p.limit ? rows[rows.length - 1].created_at : null });
}));

app.get("/decisions/:id", wrap(async (req, res) => {
  const d = (await q("select * from decisions where decision_id = $1", [req.params.id]))[0];
  if (!d) return bad(res, 404, "not_found", "unknown decision");
  const reviews = await q("select reviewer_address, verdict, note, created_at from reviews where decision_id = $1", [d.decision_id]);
  res.json({ ...d, record: JSON.parse(d.record_json), reviews,
    explorer: { commit: txUrl(d.commit_tx), execute: txUrl(d.execute_tx), reveal: txUrl(d.reveal_tx) } });
}));

// Everything a browser needs to verify independently: stored bytes → SHA-256 → compare with the chain.
app.get("/decisions/:id/verify", wrap(async (req, res) => {
  const d = (await q("select decision_id, record_bytes, decision_hash, reveal_tx, revealed from decisions where decision_id = $1", [req.params.id]))[0];
  if (!d) return bad(res, 404, "not_found", "unknown decision");
  const onchain = await readDecision(d.decision_id);
  const bytes = Buffer.from(d.record_bytes.slice(2), "hex");
  const recomputed = sha256Hex(bytes);
  let revealedBytesEqual: boolean | null = null;
  if (d.revealed) {
    const ev = (await q("select args from chain_events where event_name = 'DecisionRevealed' and args->>'decisionId' = $1 limit 1", [d.decision_id]))[0];
    revealedBytesEqual = ev ? String(ev.args.preimage).toLowerCase() === d.record_bytes.toLowerCase() : null;
  }
  res.json({
    recordBytes: d.record_bytes, onchainDecisionHash: onchain.decisionHash, recomputedSha256: recomputed,
    match: recomputed.toLowerCase() === onchain.decisionHash.toLowerCase(),
    revealed: onchain.revealed, revealTx: d.reveal_tx, revealedBytesEqual,
  });
}));

const reviewBody = z.object({
  verdict: z.enum(["agree", "disagree"]), note: z.string().max(500).optional(),
  nonce: z.string().min(8), issuedAt: z.string(), signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
});
app.post("/decisions/:id/review", wrap(async (req, res) => {
  const b = reviewBody.safeParse(req.body);
  if (!b.success) return bad(res, 400, "bad_request", b.error.message);
  const d = (await q("select decision_id, revealed from decisions where decision_id = $1", [req.params.id]))[0];
  if (!d) return bad(res, 404, "not_found", "unknown decision");
  if (!d.revealed) return bad(res, 409, "not_revealed", "only revealed decisions can be reviewed");
  try {
    const signer = await verifySignedAction({
      action: "decision.review", target: d.decision_id, verdict: b.data.verdict,
      nonce: b.data.nonce, issuedAt: b.data.issuedAt, signature: b.data.signature as `0x${string}`,
    });
    await q(
      `insert into reviews(decision_id, reviewer_address, verdict, note, signature) values ($1,$2,$3,$4,$5)
       on conflict (decision_id, reviewer_address) do update set verdict = excluded.verdict, note = excluded.note, signature = excluded.signature`,
      [d.decision_id, signer.toLowerCase(), b.data.verdict, b.data.note ?? null, b.data.signature],
    );
    res.json({ ok: true, by: signer });
  } catch (e) {
    if (e instanceof SignatureError) return bad(res, e.code === "replay" ? 409 : 401, e.code, e.message);
    throw e;
  }
}));

app.get("/cycles", wrap(async (req, res) => {
  const p = page.parse(req.query);
  const rows = await q(
    `select id, trigger, dry_run, status, snapshot_hash, forecast_hash, error, started_at, finished_at, validation
     from cycles where ($1::timestamptz is null or started_at < $1) order by started_at desc limit $2`, [p.cursor ?? null, p.limit]);
  res.json({ items: rows, nextCursor: rows.length === p.limit ? rows[rows.length - 1].started_at : null });
}));
app.get("/cycles/:id", wrap(async (req, res) => {
  const c = (await q("select * from cycles where id::text = $1", [req.params.id]))[0];
  if (!c) return bad(res, 404, "not_found", "unknown cycle");
  res.json({ ...c, decisions: await q("select decision_id, seq, kind, state, planner_overruled, overrule_reason from decisions where cycle_id = $1 order by seq", [c.id]) });
}));

// ── Receivables ──────────────────────────────────────────────────────────────────────────────
app.get("/receivables", wrap(async (_req, res) => {
  res.json({ items: await q(`select r.*, c.name as customer_name from receivables r join customers c on c.id = r.customer_id order by r.issued_at desc`) });
}));
app.get("/receivables/:id", wrap(async (req, res) => {
  const r = (await q(`select r.*, c.name as customer_name, c.wallet as customer_wallet from receivables r join customers c on c.id = r.customer_id
                      where r.receivable_id = $1 or r.id::text = $1`, [req.params.id]))[0];
  if (!r) return bad(res, 404, "not_found", "unknown receivable");
  res.json({ ...r, payUrl: `${api.FRONTEND_URL}/pay/${r.receivable_id}`, agentPayUrl: `${api.PUBLIC_BASE_URL}/pay/${r.receivable_id}` });
}));

// ── Metrics / yield / cross-chain ────────────────────────────────────────────────────────────
app.get("/metrics", wrap(async (_req, res) => {
  const latest = (await q("select taken_at, network, data from metrics_snapshots order by taken_at desc limit 1"))[0] ?? null;
  const series = await q("select date_trunc('day', taken_at) as day, (array_agg(data order by taken_at desc))[1] as data from metrics_snapshots group by 1 order by 1 desc limit 60");
  res.json({ latest, series });
}));
app.get("/yield/positions", wrap(async (_req, res) => res.json({ items: await q("select * from yield_positions order by value desc") })));
app.get("/crosschain", wrap(async (_req, res) => {
  const rows = await q("select * from cross_chain_transfers order by updated_at desc limit 200");
  res.json({ items: rows.map((r) => ({ ...r, burnExplorer: txUrl(r.burn_tx) })) });
}));

// ── Writes: all queued for the worker as draft rows. The API never holds the operator key. ────
const entityId = async (): Promise<string> => {
  const e = (await q<{ id: string }>("select id from entities where treasury_address ilike $1 limit 1", [TREASURY]))[0];
  if (!e) throw new Error(`no entities row for treasury ${TREASURY}`);
  return e.id;
};

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
app.post("/invoices/upload", adminOnly, upload.single("file"), wrap(async (req, res) => {
  if (!req.file) return bad(res, 400, "bad_request", "multipart field 'file' is required");
  try {
    const r = await intakeDocument({ entityId: await entityId(), source: "upload", filename: req.file.originalname, mime: req.file.mimetype, bytes: req.file.buffer });
    res.status(r.duplicate ? 200 : 202).json(r);
  } catch (e) {
    if (e instanceof IntakeError) return bad(res, 400, "intake_refused", e.message);
    throw e;
  }
}));

const payeeBody = z.object({
  slug: z.string().regex(/^[a-z]+:[a-z0-9-]+$/, "use kind:name, e.g. vendor:hosting"),
  name: z.string().min(2),
  kind: z.enum(["vendor", "contractor", "service", "internal"]),
  category: z.enum(["VENDOR", "CONTRACTOR", "SUBSCRIPTION", "SERVICES", "YIELD", "FX"]),
  token: z.enum(["USDC", "EURC"]),
  domain: z.number().int().default(26),
  account: z.string().refine(isAddress).optional(),
  remoteRecipient: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  email: z.string().email().optional(),
  perTxCap: z.string().default("0"),
}).refine(
  (b) => (b.domain === 26 ? !!b.account && !b.remoteRecipient : !!b.remoteRecipient && !b.account && b.token === "USDC"),
  "domain 26 needs `account`; other domains need `remoteRecipient` (bytes32) and USDC",
);

app.post("/payees", adminOnly, wrap(async (req, res) => {
  const b = payeeBody.safeParse(req.body);
  if (!b.success) return bad(res, 400, "bad_request", b.error.message);
  let cap = 0n;
  try { if (b.data.perTxCap !== "0") cap = parseAmount(b.data.perTxCap); }
  catch (e) { if (e instanceof AmountError) return bad(res, 400, "bad_amount", e.message); throw e; }
  const row = await q(
    `insert into payees(entity_id, slug, payee_id, name, kind, category, token, domain, account, remote_recipient, email, per_tx_cap, status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'draft') on conflict (entity_id, slug) do nothing returning id, slug, payee_id, status`,
    [await entityId(), b.data.slug, makePayeeId(TREASURY, b.data.slug), b.data.name, b.data.kind, b.data.category, b.data.token, b.data.domain,
      b.data.account ?? null, b.data.remoteRecipient ?? null, b.data.email ?? null, cap.toString()]);
  if (!row[0]) return bad(res, 409, "exists", `payee ${b.data.slug} already exists`);
  res.status(202).json({ ...row[0], note: "draft: the worker screens it and proposes it on-chain; only the approver can activate it" });
}));

const receivableBody = z.object({
  customer: z.object({ name: z.string().min(2), email: z.string().email().optional(), wallet: z.string().refine(isAddress).optional() }),
  invoiceNumber: z.string().min(1),
  token: z.enum(["USDC", "EURC"]).default("USDC"),
  amount: z.string(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

app.post("/receivables", adminOnly, wrap(async (req, res) => {
  const b = receivableBody.safeParse(req.body);
  if (!b.success) return bad(res, 400, "bad_request", b.error.message);
  let amount: bigint;
  try { amount = parseAmount(b.data.amount); }
  catch (e) { if (e instanceof AmountError) return bad(res, 400, "bad_amount", e.message); throw e; }
  if (amount === 0n) return bad(res, 400, "bad_amount", "amount must be > 0");
  const eid = await entityId();
  const rid = makeReceivableId(TREASURY, b.data.invoiceNumber);
  if ((await q("select 1 from receivables where receivable_id = $1", [rid])).length > 0) {
    return bad(res, 409, "exists", `receivable for invoice ${b.data.invoiceNumber} already exists`);
  }
  const cust = (await q<{ id: string }>(
    "insert into customers(entity_id, name, email, wallet) values ($1,$2,$3,$4) returning id",
    [eid, b.data.customer.name, b.data.customer.email ?? null, b.data.customer.wallet ?? null]))[0]!;
  await q(
    `insert into receivables(entity_id, receivable_id, customer_id, invoice_number, token, amount_due, due_date, status)
     values ($1,$2,$3,$4,$5,$6,$7,'draft')`,
    [eid, rid, cust.id, b.data.invoiceNumber, b.data.token, amount.toString(), b.data.dueDate]);
  res.status(202).json({ receivableId: rid, status: "draft", payUrl: `${api.FRONTEND_URL}/pay/${rid}`, note: "draft: the worker screens the customer and registers it on-chain" });
}));

// ── Admin triggers: queued for the worker, never executed here ───────────────────────────────
app.post("/admin/cycle/run", adminOnly, wrap(async (_req, res) => {
  await pool.query("select pg_notify('athena_trigger', $1)", [JSON.stringify({ trigger: "manual", dryRun: false })]);
  res.status(202).json({ queued: true });
}));
app.post("/admin/cycle/dry-run", adminOnly, wrap(async (_req, res) => {
  await pool.query("select pg_notify('athena_trigger', $1)", [JSON.stringify({ trigger: "dry_run", dryRun: true })]);
  res.status(202).json({ queued: true });
}));

// ── SSE ──────────────────────────────────────────────────────────────────────────────────────
app.get("/events/stream", async (req, res) => {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "x-accel-buffering": "no" });
  // Flush the headers + a first comment NOW: Node holds headers until the first write, so without this the client's
  // `EventSource.onopen` (and fetch()) would not resolve until the first event or the 15 s keep-alive ping.
  res.flushHeaders();
  res.write(": connected\n\n");
  const client = await pool.connect();
  await client.query("LISTEN athena_events");
  const onNote = (m: pg.Notification) => {
    if (!m.payload) return;
    let type = "message";
    try { type = JSON.parse(m.payload).type ?? type; } catch { /* keep default */ }
    res.write(`event: ${type}\ndata: ${m.payload}\n\n`);
  };
  client.on("notification", onNote);
  const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
  req.on("close", async () => {
    clearInterval(ping);
    client.off("notification", onNote);
    try { await client.query("UNLISTEN athena_events"); } finally { client.release(); }
  });
});

// ── x402 agent-payable receivable link (Phase 35.2) ──────────────────────────────────────────
// Unpaid requests get a correct HTTP 402 with the exact outstanding amount; a verified payment credits the collections
// wallet's Gateway balance and queues a receipt that the WORKER settles on-chain via payReceivable(). This route never
// moves treasury money, and the API holds no key: only the collections wallet's PUBLIC address (the x402 seller).
const gatewayApi = net(commonCfg.NETWORK).gateway.api;
if (api.COLLECTIONS_ADDRESS && gatewayApi) {
  const gateway = createGatewayMiddleware({
    sellerAddress: api.COLLECTIONS_ADDRESS,
    // MUST be explicit: the package default is Circle's MAINNET facilitator, which has never heard of Arc testnet.
    facilitatorUrl: gatewayApi,
    networks: net(commonCfg.NETWORK).gateway.x402Network,
  });
  app.get(
    "/pay/:receivableId",
    wrap(async (req, res, next) => {
      const r = (await q<{ amount_due: string; amount_paid: string; status: string; x402_enabled: boolean }>(
        "select amount_due::text, amount_paid::text, status, x402_enabled from receivables where receivable_id = $1", [req.params.receivableId]))[0];
      if (!r || r.status === "paid") return bad(res, 404, "not_found", "unknown or already paid");
      if (!r.x402_enabled) return bad(res, 403, "x402_disabled", "this receivable does not accept x402 payment");
      if (!["open", "partial"].includes(r.status)) return bad(res, 409, "not_payable", `receivable is ${r.status}`);
      const outstanding = BigInt(r.amount_due) - BigInt(r.amount_paid);
      return gateway.require(`$${formatAmount(outstanding)}`)(req as never, res as never, next);
    }),
    wrap(async (req, res) => {
      const p = (req as unknown as { payment?: { verified: boolean; payer: string; amount: string } }).payment;
      if (!p?.verified) return bad(res, 402, "unpaid", "payment not verified");
      // Idempotency: a retried request with the same payment must not queue a second settlement.
      await q("insert into x402_receipts(receivable_id, amount, payer) values ($1,$2,$3)", [req.params.receivableId, p.amount, p.payer]);
      res.json({ status: "received", receivableId: req.params.receivableId, note: "settles on-chain shortly; the receivable is marked paid when ReceivablePaid is indexed" });
    }),
  );
  // The house data service Athena itself buys with its spend wallet (Phase 36.2): a EUR/USD reference rate at $0.001 per call.
  // Real nanopayments on Arc; revenue lands in the collections wallet's Gateway balance like any x402 sale.
  app.get(
    "/services/eurusd",
    gateway.require("$0.001") as never,
    wrap(async (_req, res) => {
      const { referencePrices } = await import("./fx/swap.js");
      const p = await referencePrices();
      const rate = Number(p.eurc) / Number(p.usdc); // USD per 1 EUR (EURC ≈ EUR)
      res.json({ pair: "EUR/USD", rate: Number(rate.toFixed(6)), source: "Circle App Kit token rates (Arc)", asOf: new Date().toISOString() });
    }),
  );
} else {
  log.info("x402 pay link disabled (set COLLECTIONS_ADDRESS and use a network with a verified Gateway API)");
}

app.listen(api.API_PORT, () => log.info({ port: api.API_PORT, treasury: TREASURY }, "Athena API listening"));
