// Worker process — the ONLY holder of the operator key. Runs the indexer continuously and the treasury cycle on a
// schedule and on events (debounced). Kill switch: OPERATOR_ENABLED=false stops new cycles, but indexing and
// recovery (reveals) keep running so nothing is ever left unrevealed.
import "./config.js";
import cron from "node-cron";
import pg from "pg";
import { commonCfg, loadWorkerCfg } from "./config.js";
import { pool } from "./db.js";
import { log } from "./log.js";
import { pub, treasuryAbi, TREASURY } from "./chain/readClient.js";
import { operatorWallet } from "./chain/clients.js";
import { indexOnce, startIndexerLoop } from "./indexer/indexer.js";
import { recoverDecisions } from "./decisions/lifecycle.js";
import { runCycle } from "./cycle/cycle.js";

const w = loadWorkerCfg();

async function preflight() {
  // Config drift between contract and backend is the kind of quiet mismatch that later becomes an arrears freeze.
  const onchain = (await pub.readContract({ address: TREASURY, abi: treasuryAbi, functionName: "revealDeadlineBlocks" })) as bigint;
  if (onchain !== commonCfg.REVEAL_DEADLINE_BLOCKS) {
    throw new Error(`REVEAL_DEADLINE_BLOCKS=${commonCfg.REVEAL_DEADLINE_BLOCKS} but contract revealDeadlineBlocks=${onchain}`);
  }
  const hasOp = (await pub.readContract({
    address: TREASURY, abi: treasuryAbi, functionName: "hasRole",
    args: [await pub.readContract({ address: TREASURY, abi: treasuryAbi, functionName: "OPERATOR_ROLE" }), operatorWallet.account!.address],
  })) as boolean;
  if (!hasOp) throw new Error(`${operatorWallet.account!.address} does not hold OPERATOR_ROLE on ${TREASURY}`);
}

// Coalesce bursts of triggers into one follow-up run.
let pending: { trigger: string; dryRun: boolean } | null = null;
let running = false;
let debounce: NodeJS.Timeout | undefined;

function request(trigger: string, dryRun: boolean, debounceMs: number) {
  // Latest request wins, except a real run is never downgraded to a dry run by a coalesced scheduled tick.
  pending = { trigger, dryRun: dryRun && (pending === null || pending.dryRun || trigger === "dry_run") };
  clearTimeout(debounce);
  debounce = setTimeout(drain, debounceMs);
}

async function drain() {
  if (running || !pending) return;
  running = true;
  const next = pending;
  pending = null;
  try {
    const r = await runCycle(w, next.trigger, { dryRun: next.dryRun });
    log.info({ trigger: next.trigger, result: r }, "cycle finished");
  } catch (e) {
    log.error({ err: String(e) }, "cycle threw");
  } finally {
    running = false;
    if (pending) debounce = setTimeout(drain, 1_000);
  }
}

// LISTEN is a long-lived connection. On a flaky network it can go half-open WITHOUT emitting an error, after which the worker
// silently stops hearing manual triggers and payment/escalation events. So: heartbeat it, and reconnect on any failure.
let listenClient: pg.Client | null = null;
let listenRetry = 0;

function onNotification(m: pg.Notification) {
  if (!m.payload) return;
  let p: { type?: string; trigger?: string; dryRun?: boolean } = {};
  try { p = JSON.parse(m.payload); } catch { return; }
  if (m.channel === "athena_trigger") return request(p.trigger ?? "manual", Boolean(p.dryRun), 0);
  // Event triggers (Phase 37.2): invoice → 60s, payment in → 60s, escalation resolved → 30s.
  if (p.type === "invoice.validated") request("invoice", false, 60_000);
  else if (p.type === "payment.in") request("payment_in", false, 60_000);
  else if (p.type === "escalation.resolved") request("escalation_resolved", false, 30_000);
}

async function listen(): Promise<void> {
  const old = listenClient;
  listenClient = null;
  if (old) { old.removeAllListeners(); old.end().catch(() => undefined); }
  const c = new pg.Client({ connectionString: commonCfg.DATABASE_URL, keepAlive: true, connectionTimeoutMillis: 15_000 });
  const lost = (why: string) => {
    if (listenClient !== c) return; // already replaced
    listenClient = null;
    const delay = Math.min(30_000, 1_000 * 2 ** listenRetry++);
    log.warn({ why, retryInMs: delay }, "LISTEN connection lost — reconnecting");
    setTimeout(() => listen().catch((e) => { log.error({ err: String(e) }, "LISTEN reconnect failed"); lost("reconnect failed"); }), delay);
  };
  c.on("error", (e) => lost(String(e)));
  c.on("end", () => lost("connection ended"));
  await c.connect();
  await c.query("LISTEN athena_events");
  await c.query("LISTEN athena_trigger");
  c.on("notification", onNotification);
  listenClient = c;
  listenRetry = 0;
}

/** Every 30 s prove the LISTEN connection is alive (a query round-trip with a 10 s deadline); otherwise force a reconnect. */
function startListenHeartbeat() {
  setInterval(async () => {
    const c = listenClient;
    if (!c) return;
    try {
      await Promise.race([c.query("select 1"), new Promise((_, rej) => setTimeout(() => rej(new Error("heartbeat timeout")), 10_000))]);
    } catch (e) {
      log.warn({ err: String(e) }, "LISTEN heartbeat failed — reconnecting");
      c.emit("error", e instanceof Error ? e : new Error(String(e)));
    }
  }, 30_000).unref();
}

async function main() {
  await preflight();
  await indexOnce();
  await recoverDecisions(); // finish or cancel anything left half-done by a crash, and reveal everything resolved
  startIndexerLoop(2_000);
  cron.schedule(w.CYCLE_CRON, () => request("schedule", false, 0));
  await listen();
  startListenHeartbeat();
  setInterval(() => recoverDecisions().catch((e) => log.error({ err: String(e) }, "recover tick failed")), 60_000);
  log.info({ treasury: TREASURY, network: commonCfg.NETWORK, cron: w.CYCLE_CRON, enabled: w.OPERATOR_ENABLED }, "Athena worker running");
  void pool;
}

main().catch((e) => { log.error({ err: String(e) }, "worker failed to start"); process.exit(1); });
