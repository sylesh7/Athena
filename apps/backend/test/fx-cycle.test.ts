// FX decisions through a real cycle (real contract + Postgres). The price feed is injected; the swap itself was run live on
// Arc testnet separately (1 USDC → 1.198447 EURC). Here: the buy decision is sized from the reference rate, capped by the
// FX budget's approval limit, committed with its reasoning, executed under the FX budget, and revealed.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { keccak256, stringToBytes } from "viem";
import { abi, EURC, KEY, ONE, rnd32, randAddr, runnable, startHarness, USDC, type Harness } from "./helpers/harness.js";

let h: Harness;
const fxWallet = randAddr();
let run: (limit?: { fail?: boolean }) => Promise<any>;
const ref = { usdc: 1_000_000n, eurc: 1_100_000n }; // 1 EURC = $1.10, 1 USDC = $1.00

beforeAll(async () => {
  if (!runnable) return;
  h = await startHarness({ anvil: 18551, pg: 54334 });
  await h.send(KEY.admin, h.treasury, abi, "setSupportedToken", [EURC, true]);
  await h.send(KEY.admin, h.treasury, abi, "setBudget", [keccak256(stringToBytes("FX")), USDC, 100n * ONE, 50n * ONE, 30n * 86_400n, false]);
  const fxPayee = rnd32();
  await h.activatePayee(fxPayee, fxWallet, keccak256(stringToBytes("FX")));
  await h.q(
    `insert into payees(entity_id, slug, payee_id, name, kind, category, token, domain, account, status, active_from)
     values ($1,'internal:fx',$2,'FX wallet','internal','FX','USDC',26,$3,'active',now())`, [h.entityId, fxPayee, fxWallet]);
  // a euro vendor with a 30 EURC invoice due in 5 days
  await h.q(
    `insert into payees(entity_id, slug, payee_id, name, kind, category, token, domain, account, status, active_from)
     values ($1,'vendor:eu',$2,'Traduction SARL','vendor','VENDOR','EURC',26,$3,'active',now())`, [h.entityId, rnd32(), randAddr()]);
  await h.q(
    `insert into obligations(entity_id, obligation_id, payee_id, source, category, token, amount, due_date, criticality, evidence_hash, status)
     select $1,$2,p.id,'manual','VENDOR','EURC',$3,(current_date + 5),2,$4,'open' from payees p where p.slug = 'vendor:eu'`,
    [h.entityId, rnd32(), (30n * ONE).toString(), rnd32()]);
  const { runCycle } = await import("../src/cycle/cycle.js");
  const { loadWorkerCfg } = await import("../src/config.js");
  run = (o) => runCycle(loadWorkerCfg(), "scenario-fx", { fxPrices: async () => { if (o?.fail) throw new Error("price feed down"); return ref; } });
}, 300_000);

afterAll(async () => { await h?.stop(); });

describe.skipIf(!runnable)("FX decisions in the cycle (Phase 34)", () => {
  it("does nothing, without crashing, when the reference price feed is down", async () => {
    expect((await run({ fail: true })).status).toBe("done");
    expect(Number((await h.q<any>("select count(*)::int n from decisions where kind = 'FX'"))[0].n)).toBe(0);
  }, 120_000);

  it("buys EURC for the euro invoice: sized from the reference rate + margin, capped by the approval limit, then executed and revealed", async () => {
    const before = await h.balance(fxWallet);
    expect((await run()).status).toBe("done");

    const d = (await h.q<any>("select * from decisions where kind = 'FX'"))[0];
    expect(d.state).toBe("executed");
    expect(d.revealed).toBe(true);
    // need = 30 EURC (due) + 0 floor − 0 spendable; USDC = 30 × 1.10 / 1.00 = 33, +2% margin = 33.66 → under the 50 approval limit
    expect(await h.balance(fxWallet)).toBe(before + 33_660_000n);
    expect(d.follow_up).toMatchObject({ type: "fx_swap", usdcAmount: "33660000", status: "pending" });
    const rec = JSON.parse(d.record_json);
    expect(rec.planner.rationale).toContain("33660000 USDC");
    expect(rec.rule.checks.map((c: any) => c.name)).toEqual(expect.arrayContaining(["eurc_need", "budget", "reference_rate"]));
    expect(rec.saw.budget.category).toBe("FX");
  }, 180_000);

  it("does NOT buy the same euros twice while the first swap is still in flight (follow-up pending)", async () => {
    const before = await h.balance(fxWallet);
    await run(); await run(); // follow-up never completes in this env (no Circle FX config), so it stays pending
    expect(await h.balance(fxWallet)).toBe(before);
    expect(Number((await h.q<any>("select count(*)::int n from decisions where kind = 'FX'"))[0].n)).toBe(1);
  }, 240_000);

  it("buys only the REMAINING need once the obligation grows, capped at the approval limit (no escalation for an over-limit buy)", async () => {
    await h.q("update obligations set amount = $1 where token = 'EURC'", [(300n * ONE).toString()]); // wants ~336 USDC, ~30.6 EURC already bought
    const before = await h.balance(fxWallet);
    await run();
    expect(await h.balance(fxWallet)).toBe(before + 50n * ONE); // approval limit 50, budget remaining 66.34
    const states = (await h.q<any>("select state from decisions where kind = 'FX' order by created_at")).map((r: any) => r.state);
    expect(states).toEqual(["executed", "executed"]);
  }, 180_000);

  it("stops buying once the FX budget is spent", async () => {
    await run(); // remaining 16.34 → a third, smaller buy
    const n3 = Number((await h.q<any>("select count(*)::int n from decisions where kind = 'FX'"))[0].n);
    await run(); await run(); // remaining ~0 (< any useful amount) — eventually no further decisions
    const n5 = Number((await h.q<any>("select count(*)::int n from decisions where kind = 'FX'"))[0].n);
    expect(n5).toBeLessThanOrEqual(n3 + 1);
    const spent = (await h.q<any>("select coalesce(sum((action->>'amount')::numeric),0)::text s from decisions where kind = 'FX' and state = 'executed'"))[0].s;
    expect(BigInt(spent)).toBeLessThanOrEqual(100n * ONE); // never beyond the on-chain FX budget
  }, 300_000);
});
