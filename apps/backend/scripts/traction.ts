// Daily traction report for the hackathon update (`arc-canteen update traction`). Read-only; prints markdown to paste.
// Counts only real house operations: scenario/seed decisions are excluded by trigger label.
import { q, pool } from "../src/db.js";

const one = async (sql: string) => (await q<Record<string, string>>(sql))[0] ?? {};
const dec = await one(`select count(*)::int total, count(*) filter (where revealed)::int revealed, count(*) filter (where state='executed')::int executed from decisions d where not exists (select 1 from cycles c where c.id = d.cycle_id and c.trigger like 'scenario%')`);
const cyc = await one(`select count(*)::int n, count(*) filter (where status='done')::int ok from cycles where trigger not like 'scenario%'`);
const paid = await one(`select coalesce(sum(amount),0)::text amt, count(*)::int n from obligations where status = 'paid'`);
const rec = await one(`select count(*) filter (where status='paid')::int paid, count(*)::int total from receivables`);
const esc = await one(`select count(*)::int total, count(*) filter (where status<>'pending')::int resolved from escalations`);
const llm = await one(`select (coalesce(sum(cost_micro_usd),0)/1e6)::numeric(10,4)::text usd, count(*)::int calls from llm_usage`);
const usdc = (s: string) => (Number(s) / 1e6).toFixed(2);
console.log(`### Athena traction — ${new Date().toISOString().slice(0, 10)}
- Cycles run: ${cyc.ok}/${cyc.n} succeeded
- Decisions: ${dec.total} committed, ${dec.executed} executed, ${dec.revealed} revealed on-chain (hash verified)
- Obligations settled: ${paid.n} (${usdc(paid.amt!)} USDC)
- Receivables paid: ${rec.paid}/${rec.total}
- Escalations: ${esc.total} raised, ${esc.resolved} resolved by humans
- LLM spend: $${llm.usd} over ${llm.calls} calls`);
await pool.end();
