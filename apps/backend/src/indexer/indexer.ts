// Phase 17 — the database mirrors the chain. Inserts are idempotent (unique tx_hash+log_index),
// so a crash mid-chunk is replayed safely. Arc has immediate finality: no reorg handling needed.
import { parseAbi, parseEventLogs, type Log } from "viem";
import { net } from "@athena/shared/addresses";
import { pub, treasuryAbi, TREASURY } from "../chain/readClient.js";
import { commonCfg } from "../config.js";
import { q, notify } from "../db.js";
import { updatedAvgDaysLate } from "../ar/dunning.js";
import { log } from "../log.js";

// Catch-up chunking is ADAPTIVE: start large (a treasury has few events, so big ranges are cheap when the RPC allows them), halve on
// "range too large" errors, and back off + retry on rate limits. The public Arc RPC rate-limits eth_getLogs aggressively (observed
// live while catching up ~1M blocks), so catch-up is also paced. A dedicated/Canteen RPC makes this a non-issue.
const MAX_CHUNK = BigInt(process.env.INDEXER_CHUNK ?? "50000"); // blocks per getLogs range at most (default 50,000)
const MIN_CHUNK = MAX_CHUNK < 500n ? MAX_CHUNK : 500n;
// Once the RPC rejects a range size we remember it for the life of the process, so catch-up does not keep probing larger sizes.
let learnedCeiling = MAX_CHUNK;
const sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isRateLimit = (e: unknown) => /rate limit|429|-32005|too many requests/i.test(String((e as Error)?.message ?? e) + String((e as { code?: unknown })?.code ?? ""));
const isRangeTooLarge = (e: unknown) => /range|too many results|exceed|10000|query returned more than/i.test(String((e as Error)?.message ?? e));

async function withBackoff<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await fn(); } catch (e) {
      if (!isRateLimit(e) || attempt >= 8) throw e;
      const wait = Math.min(30_000, 1_000 * 2 ** attempt);
      log.warn({ attempt, wait }, "RPC rate limit — backing off");
      await sleepMs(wait);
    }
  }
}
const transferEvent = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"])[0];

type Ev = { eventName: string; args: Record<string, any>; blockNumber: bigint; transactionHash: `0x${string}`; logIndex: number };

async function lastIndexed(): Promise<bigint> {
  const rows = await q<{ last_block: string }>("select last_block from indexer_state where contract = 'treasury'");
  return rows[0] ? BigInt(rows[0].last_block) : commonCfg.TREASURY_DEPLOY_BLOCK - 1n;
}
const setLastIndexed = (b: bigint) =>
  q(
    `insert into indexer_state(contract, last_block) values ('treasury', $1)
     on conflict (contract) do update set last_block = excluded.last_block`,
    [b.toString()],
  );

const jsonSafe = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));

export async function indexOnce(): Promise<{ from: bigint; to: bigint; events: number }> {
  // cacheTime: 0 — viem caches getBlockNumber for ~4s by default, which would make the indexer lag a just-mined block.
  const head = await pub.getBlockNumber({ cacheTime: 0 });
  const from = (await lastIndexed()) + 1n;
  let total = 0;
  if (from > head) return { from, to: head, events: 0 };

  const tokens = net(commonCfg.NETWORK).tokens;
  let chunk = learnedCeiling;
  for (let start = from; start <= head; ) {
    const end = start + chunk - 1n > head ? head : start + chunk - 1n;
    let logs: Log[];
    let tokenLogs: unknown[];
    try {
      logs = (await withBackoff(() => pub.getLogs({ address: TREASURY, fromBlock: start, toBlock: end }))) as Log[];
      // ERC-20 transfers INTO the treasury, filtered by emitting token contract (Arc also emits EIP-7708
      // logs for native-value transfers; filtering by token address avoids double counting).
      tokenLogs = (await withBackoff(() => pub.getLogs({
        address: [tokens.USDC as `0x${string}`, tokens.EURC as `0x${string}`],
        event: transferEvent,
        args: { to: TREASURY },
        fromBlock: start,
        toBlock: end,
      }))) as unknown[];
    } catch (e) {
      if (isRangeTooLarge(e) && chunk > MIN_CHUNK) {
        chunk = chunk / 2n > MIN_CHUNK ? chunk / 2n : MIN_CHUNK;
        learnedCeiling = chunk;
        log.warn({ chunk: chunk.toString() }, "RPC rejected the range — shrinking chunk");
        continue;
      }
      throw e;
    }
    if (end - start >= 1_000n && head - end > 1_000n) await sleepMs(250); // pace catch-up
    const events = parseEventLogs({ abi: treasuryAbi, logs }) as unknown as Ev[];

    for (const e of events) {
      await q(
        `insert into chain_events(block_number, tx_hash, log_index, event_name, args)
         values ($1,$2,$3,$4,$5) on conflict (tx_hash, log_index) do nothing`,
        [e.blockNumber.toString(), e.transactionHash, e.logIndex, e.eventName, jsonSafe(e.args)],
      );
    }
    for (const e of events) await project(e);
    await reconcileInflows(tokenLogs as any[], events);
    await setLastIndexed(end);
    total += events.length;
    if (head - from > 5_000n) log.info({ from: start.toString(), to: end.toString(), head: head.toString(), chunk: chunk.toString(), events: events.length }, "indexer catch-up");
    start = end + 1n; // advance — without this the loop re-indexes the same range forever
    if (chunk < learnedCeiling) chunk = chunk * 2n > learnedCeiling ? learnedCeiling : chunk * 2n; // recover only up to what the RPC has accepted
  }
  return { from, to: head, events: total };
}

// ── projections ─────────────────────────────────────────────────────────────────────────────

const ESC_STATUS: Record<string, string> = { EscalationApproved: "approved", EscalationRejected: "rejected" };

async function project(e: Ev): Promise<void> {
  const a = e.args;
  const tx = e.transactionHash;
  switch (e.eventName) {
    case "DecisionCommitted": {
      const noop = /^0x0{64}$/.test(a.actionHash);
      await q("update decisions set state = $2, commit_tx = $3 where decision_id = $1 and state in ('recorded','committed')", [
        a.decisionId, noop ? "noop" : "committed", tx,
      ]);
      await notify("decision.committed", { decisionId: a.decisionId, tx });
      break;
    }
    case "DecisionExecuted": {
      // A human-approved escalation also emits DecisionExecuted (the payment itself); keep the more informative 'approved' state.
      await q("update decisions set state = case when state = 'approved' then state else 'executed' end, execute_tx = $2 where decision_id = $1", [a.decisionId, tx]);
      await q(
        "update obligations set status = 'paid', paid_tx = $2, paid_at = now(), decision_id = $3 where obligation_id = $1 and status <> 'paid'",
        [a.obligationId, tx, a.decisionId],
      );
      await notify("decision.executed", { decisionId: a.decisionId, tx });
      break;
    }
    case "DecisionEscalated": {
      await q("update decisions set state = 'escalated', escalation_reason = $2 where decision_id = $1", [a.decisionId, Number(a.reason)]);
      await q(
        `insert into escalations(decision_id, reason, expires_at) values ($1,$2,to_timestamp($3))
         on conflict (decision_id) do nothing`,
        [a.decisionId, Number(a.reason), Number(a.expiresAt)],
      );
      await q("update obligations set status = 'escalated' where obligation_id in (select obligation_id from decisions where decision_id = $1)", [a.decisionId]);
      await notify("decision.escalated", { decisionId: a.decisionId, reason: Number(a.reason) });
      break;
    }
    case "EscalationApproved":
    case "EscalationRejected": {
      const approved = e.eventName === "EscalationApproved";
      await q("update decisions set state = $2 where decision_id = $1", [a.decisionId, approved ? "approved" : "rejected"]);
      await q(
        "update escalations set status = $2, resolved_tx = $3, resolved_by = $4, resolved_at = now() where decision_id = $1",
        [a.decisionId, ESC_STATUS[e.eventName], tx, a.approver],
      );
      // Rejected: the obligation goes back to 'open' so the next cycle re-plans it. (Approval: the
      // DecisionExecuted event does not fire for approvals, so mark paid from the decision's action.)
      const d = (await q<{ obligation_id: string | null }>("select obligation_id from decisions where decision_id = $1", [a.decisionId]))[0];
      if (d?.obligation_id) {
        if (approved) await q("update obligations set status = 'paid', paid_tx = $2, paid_at = now(), decision_id = $3 where obligation_id = $1", [d.obligation_id, tx, a.decisionId]);
        else await q("update obligations set status = 'open' where obligation_id = $1 and status = 'escalated'", [d.obligation_id]);
      }
      await notify("escalation.resolved", { decisionId: a.decisionId, status: ESC_STATUS[e.eventName] });
      break;
    }
    case "DecisionCancelled": {
      await q("update decisions set state = 'cancelled' where decision_id = $1", [a.decisionId]);
      await q("update obligations set status = 'open' where obligation_id in (select obligation_id from decisions where decision_id = $1) and status in ('escalated','scheduled')", [a.decisionId]);
      break;
    }
    case "DecisionRevealed": {
      const row = (await q<{ record_bytes: string }>("select record_bytes from decisions where decision_id = $1", [a.decisionId]))[0];
      if (row && row.record_bytes.toLowerCase() !== String(a.preimage).toLowerCase()) {
        // The chain holds different bytes than our DB — something rewrote history. P1.
        log.error({ decisionId: a.decisionId }, "P1: revealed bytes differ from stored record_bytes");
        await notify("audit.mismatch", { decisionId: a.decisionId });
      }
      await q("update decisions set revealed = true, reveal_tx = $2 where decision_id = $1", [a.decisionId, tx]);
      await notify("decision.revealed", { decisionId: a.decisionId, tx });
      break;
    }
    case "CrossChainPaymentInitiated": {
      await q(
        `insert into cross_chain_transfers(decision_id, direction, source_domain, destination_domain, amount, burn_tx, status)
         select $1,'cctp_out',26,$2,$3,$4,'burned'
         where not exists (select 1 from cross_chain_transfers where burn_tx = $4)`,
        [a.decisionId, Number(a.destinationDomain), a.amount, tx],
      );
      await notify("crosschain.stage", { decisionId: a.decisionId, stage: "burned" });
      break;
    }
    case "PayeeProposed": {
      await q("update payees set status = 'proposed' where payee_id = $1 and status in ('draft','proposed')", [a.payeeId]);
      if (a.isChange) {
        await q(
          `insert into payee_address_history(payee_id, old_account, new_account, new_remote, source, proposed_tx, status)
           select id, account, $2, $3, 'manual', $4, 'proposed' from payees where payee_id = $1`,
          [a.payeeId, a.account, a.remoteRecipient, tx],
        );
      }
      break;
    }
    case "PayeeApproved": {
      await q("update payees set status = 'active', active_from = to_timestamp($2) where payee_id = $1", [a.payeeId, Number(a.activeFrom)]);
      await q(
        `update payees p set account = h.new_account
         from payee_address_history h where h.payee_id = p.id and h.status = 'proposed' and p.payee_id = $1 and h.new_account is not null`,
        [a.payeeId],
      );
      await q("update payee_address_history set status = 'approved', approved_tx = $2 where status = 'proposed' and payee_id in (select id from payees where payee_id = $1)", [a.payeeId, tx]);
      break;
    }
    case "PayeeRejected": {
      await q("update payees set status = case when account is null and remote_recipient is null then 'rejected' else status end where payee_id = $1", [a.payeeId]);
      await q("update payee_address_history set status = 'rejected' where status = 'proposed' and payee_id in (select id from payees where payee_id = $1)", [a.payeeId]);
      break;
    }
    case "PayeeSuspended":
      await q("update payees set status = 'suspended' where payee_id = $1", [a.payeeId]);
      break;
    case "PayeeCapChanged":
      await q("update payees set per_tx_cap = $2 where payee_id = $1", [a.payeeId, a.newCap]);
      break;
    case "ReceivableRegistered":
      await q("update receivables set status = 'open', register_tx = $2 where receivable_id = $1 and status = 'draft'", [a.receivableId, tx]);
      break;
    case "ReceivablePaid": {
      await q(
        `update receivables set amount_paid = $2,
           status = case when $2::numeric >= amount_due then 'paid' else 'partial' end
         where receivable_id = $1`,
        [a.receivableId, a.totalPaid],
      );
      // A fully-paid receivable teaches the forecast: update the customer's payment history (running average lateness).
      const paid = (await q<{ due_date: string; customer_id: string; status: string; avg: string; paid_count: number }>(
        `select r.due_date::text, r.customer_id, r.status, c.avg_days_late::text as avg, c.paid_count
         from receivables r join customers c on c.id = r.customer_id where r.receivable_id = $1`, [a.receivableId]))[0];
      if (paid?.status === "paid") {
        const next = updatedAvgDaysLate({ avg: Number(paid.avg), paidCount: paid.paid_count, paidOn: new Date().toISOString().slice(0, 10), dueDate: paid.due_date });
        await q("update customers set paid_count = paid_count + 1, avg_days_late = $2 where id = $1", [paid.customer_id, next]);
      }
      await notify("payment.in", { receivableId: a.receivableId, amount: String(a.amount) });
      break;
    }
    case "AuditArrears":
      log.error({ decisionId: a.decisionId, overdueCount: String(a.overdueCount) }, "P1: operator in audit arrears");
      await notify("audit.arrears", { decisionId: a.decisionId, overdueCount: String(a.overdueCount) });
      break;
    case "AuditCleared":
      await notify("audit.cleared", { decisionId: a.decisionId });
      break;
    default:
      break; // Funded, ReserveMoved, BudgetSet, ... are in chain_events; no table projection needed
  }
}

// ── Phase 17.3: reconcile inflows — the omission check ───────────────────────────────────────
async function reconcileInflows(tokenLogs: any[], events: Ev[]): Promise<void> {
  for (const t of tokenLogs) {
    const sameTx = events.filter((e) => e.transactionHash === t.transactionHash);
    const explained = sameTx.some(
      (e) =>
        (e.eventName === "Funded" && String(e.args.token).toLowerCase() === String(t.address).toLowerCase() && e.args.amount === t.args.value) ||
        (e.eventName === "ReceivablePaid" && String(e.args.token).toLowerCase() === String(t.address).toLowerCase() && e.args.amount === t.args.value),
    );
    if (explained) continue;

    // Gateway consolidation: match an open follow-up by token/amount (amount net of fee, so allow <=).
    const matched = await q(
      `update decisions set follow_up = jsonb_set(follow_up, '{status}', '"done"')
       where decision_id = (
         select decision_id from decisions
         where kind = 'CONSOLIDATE' and coalesce(follow_up->>'status','') in ('pending','minting')
           and (follow_up->>'amount')::numeric >= $1::numeric
           and created_at > now() - interval '2 hours'
         order by created_at limit 1)
       returning decision_id`,
      [t.args.value.toString()],
    );
    if (matched.length > 0) continue;

    await q(
      `insert into unattributed_inflows(tx_hash, token, from_addr, amount) values ($1,$2,$3,$4)
       on conflict do nothing`,
      [t.transactionHash, t.address, t.args.from, t.args.value.toString()],
    );
    log.warn({ tx: t.transactionHash }, "unattributed inflow");
    await notify("inflow.unattributed", { tx: t.transactionHash });
  }
}

export function startIndexerLoop(intervalMs = 2_000): () => void {
  let stopped = false;
  (async () => {
    while (!stopped) {
      try {
        await indexOnce();
      } catch (err) {
        log.error({ err: String(err) }, "indexer tick failed");
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  })();
  return () => { stopped = true; };
}

