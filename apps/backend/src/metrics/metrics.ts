// Phase 42 — every traction number is computed from the database (a mirror of the chain) and labelled by network.
// Scenario runs (decisions.scenario = true) never inflate the operating totals.
import { q } from "../db.js";
import { derived, type Snapshot } from "../snapshot/snapshot.js";

export interface Metrics {
  network: string;
  asOf: string;
  businessesOperated: number;
  usdcReceived: string;
  usdcPaidOut: string;
  obligationsSettledOnTimeNoHuman: number;
  decisionsMade: number;
  decisionsEscalated: number;
  escalationAgreementBps: number | null;
  decisionAgreementBps: number | null;
  invoicesProcessed: number;
  duplicatesCaught: number;
  payeeChangesIntercepted: number;
  discountsCaptured: string;
  fundsUnderManagement: string | null;
  yieldEarned: string;
  crossChainPayoutsMinted: number;
  servicePurchases: { count: number; amount: string };
  decisionsRevealedOnChain: number;
  auditArrearsEvents: number;
}

const n = async (sql: string, p: unknown[] = []): Promise<number> => Number((await q<{ v: string }>(sql, p))[0]?.v ?? 0);
const s = async (sql: string, p: unknown[] = []): Promise<string> => (await q<{ v: string | null }>(sql, p))[0]?.v ?? "0";
const ratioBps = (num: number, den: number) => (den === 0 ? null : Math.round((num * 10_000) / den));

export async function computeMetrics(network: string, snapshot: Snapshot | null): Promise<Metrics> {
  const approved = await n("select count(*) v from escalations where status = 'approved'");
  const rejected = await n("select count(*) v from escalations where status = 'rejected'");
  const agree = await n("select count(*) v from reviews where verdict = 'agree'");
  const reviews = await n("select count(*) v from reviews");

  return {
    network,
    asOf: new Date().toISOString(),
    businessesOperated: await n("select count(distinct entity_id) v from decisions where scenario = false and state in ('executed','approved','noop')"),
    usdcReceived: await s("select coalesce(sum(amount_paid),0)::text v from receivables"),
    usdcPaidOut: await s(
      `select coalesce(sum((action->>'amount')::numeric),0)::text v from decisions
       where scenario = false and state in ('executed','approved') and kind in ('PAY_NOW','PAY_EARLY')`),
    obligationsSettledOnTimeNoHuman: await n(
      `select count(*) v from obligations o where o.status = 'paid' and o.paid_at::date <= o.due_date
         and not exists (select 1 from decisions d where d.obligation_id = o.obligation_id and d.state in ('escalated','approved','rejected'))`),
    decisionsMade: await n("select count(*) v from decisions where scenario = false and state in ('executed','noop','approved')"),
    decisionsEscalated: await n("select count(*) v from decisions where scenario = false and (state in ('escalated','approved','rejected') or escalation_reason is not null)"),
    escalationAgreementBps: ratioBps(approved, approved + rejected),
    decisionAgreementBps: ratioBps(agree, reviews),
    invoicesProcessed: await n("select count(*) v from invoices where status in ('obligated','rejected')"),
    duplicatesCaught: await n("select count(*) v from invoices where hold_reason in ('duplicate','probable_duplicate')"),
    payeeChangesIntercepted: await n("select count(*) v from payee_address_history where source = 'invoice'"),
    discountsCaptured: await s(
      `select coalesce(sum(o.amount - (d.action->>'amount')::numeric),0)::text v from decisions d join obligations o on o.obligation_id = d.obligation_id
       where d.kind = 'PAY_EARLY' and d.state in ('executed','approved') and d.scenario = false`),
    fundsUnderManagement: snapshot ? derived(snapshot).fundsUnderManagement.toString() : null,
    yieldEarned: await s("select coalesce(sum(value - principal),0)::text v from yield_positions"),
    crossChainPayoutsMinted: await n("select count(*) v from cross_chain_transfers where direction = 'cctp_out' and status = 'minted'"),
    servicePurchases: { count: await n("select count(*) v from service_purchases where ok"), amount: await s("select coalesce(sum(amount),0)::text v from service_purchases where ok") },
    decisionsRevealedOnChain: await n("select count(*) v from chain_events where event_name = 'DecisionRevealed'"),
    auditArrearsEvents: await n("select count(*) v from chain_events where event_name = 'AuditArrears'"),
  };
}

export async function snapshotMetrics(network: string, snapshot: Snapshot | null): Promise<Metrics> {
  const m = await computeMetrics(network, snapshot);
  await q("insert into metrics_snapshots(network, data) values ($1,$2)", [network, JSON.stringify(m)]);
  return m;
}
