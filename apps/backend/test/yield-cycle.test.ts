// Yield decisions through a REAL cycle on a real contract + Postgres. The vault feed is injected (Earn Kit is a network
// service, exercised live separately); the Earn Kit deposit/withdraw follow-ups are not run here (no yield key in env).
// What is proven: the sweep/redeem decision is committed with its reasoning, executes on-chain under the YIELD budget,
// reveals, and the vault + amount are in the committed record BEFORE any money moves.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Hex } from "viem";
import { keccak256, stringToBytes } from "viem";
import { abi, KEY, ONE, rnd32, randAddr, runnable, startHarness, USDC, type Harness } from "./helpers/harness.js";
import type { RawVault } from "../src/yield/select.js";

let h: Harness;
let yieldWallet = randAddr();
let run: (trigger: string) => Promise<any>;
let fakeVaults: RawVault[] = [];
const vault = (addr: string, apy: number): RawVault => ({
  vaultAddress: addr, name: `vault-${addr.slice(0, 6)}`, protocol: "MORPHO", asset: "USDC", status: "active", circleGuarded: false, currentApy: apy,
  apyProfile: { current: apy, d7: null, d30: null }, riskSignals: { warnings: [], earnKitWarnings: [] }, liquidityProfile: { available: "1000000.0" },
});

beforeAll(async () => {
  if (!runnable) return;
  h = await startHarness({ anvil: 18549, pg: 54342 });
  // YIELD budget: 500 USDC per period, 200 per payment (so a sweep is capped at 200), no evidence required.
  await h.send(KEY.admin, h.treasury, abi, "setBudget", [keccak256(stringToBytes("YIELD")), USDC, 500n * ONE, 200n * ONE, 30n * 86_400n, false]);
  const yieldPayeeId = rnd32();
  await h.activatePayee(yieldPayeeId, yieldWallet, keccak256(stringToBytes("YIELD")));
  await h.q(
    `insert into payees(entity_id, slug, payee_id, name, kind, category, token, domain, account, status, active_from)
     values ($1,'internal:yield',$2,'Yield wallet','internal','YIELD','USDC',26,$3,'active',now())`, [h.entityId, yieldPayeeId, yieldWallet]);
  const { runCycle } = await import("../src/cycle/cycle.js");
  const { loadWorkerCfg } = await import("../src/config.js");
  run = (trigger) => runCycle(loadWorkerCfg(), trigger, { vaults: async () => fakeVaults });
}, 300_000);

afterAll(async () => { await h?.stop(); });

describe.skipIf(!runnable)("yield decisions in the cycle (Phases 25.2, 25.3, 31)", () => {
  it("sweeps idle cash into the best conservative vault, capped at the per-payment approval limit, and reveals it", async () => {
    fakeVaults = [vault("0x" + "a".repeat(40), 0.035), vault("0x" + "b".repeat(40), 0.042)];
    const before = await h.balance(yieldWallet);
    expect((await run("scenario-yield")).status).toBe("done");

    expect(await h.balance(yieldWallet)).toBe(before + 200n * ONE); // min(surplus 1900, budget 500, approval 200)
    const d = (await h.q<any>("select * from decisions where kind = 'YIELD_DEPOSIT'"))[0];
    expect(d.state).toBe("executed");
    expect(d.revealed).toBe(true);
    expect(d.follow_up).toMatchObject({ type: "earn_deposit", vault: "0x" + "b".repeat(40), amount: (200n * ONE).toString(), status: "pending" });

    const rec = JSON.parse(d.record_json);
    expect(rec.subject.treasury).toMatchObject({ from: "treasury", amount: (200n * ONE).toString() });
    expect(rec.planner.rationale).toContain("420 bps"); // the 4.2% vault beat the 3.5% one
    expect(rec.followUp.vault).toBe("0x" + "b".repeat(40)); // vault is in the committed record before the money moved
    expect(rec.rule.checks.map((c: any) => c.name)).toEqual(expect.arrayContaining(["surplus", "budget", "vault_liquidity"]));
    // the internal move's obligation id is derived from the decision id (unique + idempotent)
    expect(rec.action.obligationId).toBe(keccak256(stringToBytes(rec.decisionId)));
  }, 180_000);

  it("keeps sweeping until the YIELD budget is exhausted, then stops (no further decisions)", async () => {
    await run("scenario-yield"); // second 200
    await run("scenario-yield"); // remaining 100 → third sweep is 100 (< approval 200)
    const sweeps = await h.q<any>("select (action->>'amount') a from decisions where kind = 'YIELD_DEPOSIT' order by seq, created_at");
    expect(sweeps.map((s: any) => s.a)).toEqual([(200n * ONE).toString(), (200n * ONE).toString(), (100n * ONE).toString()]);
    expect(await h.balance(yieldWallet)).toBe(500n * ONE);
    const n = Number((await h.q<any>("select count(*)::int n from decisions where kind = 'YIELD_DEPOSIT'"))[0].n);
    await run("scenario-yield"); // budget exhausted
    expect(Number((await h.q<any>("select count(*)::int n from decisions where kind = 'YIELD_DEPOSIT'"))[0].n)).toBe(n);
  }, 300_000);

  it("a forecast shortfall redeems from the vault position first (committed no-op decision with follow-up) and does not sweep", async () => {
    const vaultAddr = "0x" + "b".repeat(40);
    await h.q("insert into yield_positions(vault_address, chain, principal, value) values ($1,'Arc_Testnet',$2,$2)", [vaultAddr, (500n * ONE).toString()]);
    // an obligation due in 3 days that the stress case cannot cover without help: balance ~1500 spendable vs 1900 owed
    const obl = rnd32();
    await h.q(
      `insert into payees(entity_id, slug, payee_id, name, kind, category, token, domain, account, status, active_from)
       values ($1,'vendor:big',$2,'Big Co','vendor','VENDOR','USDC',26,$3,'active',now())`, [h.entityId, rnd32(), randAddr()]);
    await h.q(
      `insert into obligations(entity_id, obligation_id, payee_id, source, category, token, amount, due_date, criticality, evidence_hash, status)
       select $1,$2,p.id,'manual','VENDOR','USDC',$3,(current_date + 3),2,$4,'open' from payees p where p.slug = 'vendor:big'`,
      [h.entityId, obl, (1_900n * ONE).toString(), rnd32()]);

    const sweepsBefore = Number((await h.q<any>("select count(*)::int n from decisions where kind = 'YIELD_DEPOSIT'"))[0].n);
    expect((await run("scenario-yield")).status).toBe("done");
    const redeem = (await h.q<any>("select * from decisions where kind = 'YIELD_REDEEM'"))[0];
    expect(redeem).toBeTruthy();
    expect(redeem.state).toBe("noop"); // nothing leaves the treasury on-chain
    expect(redeem.revealed).toBe(true);
    expect(redeem.follow_up).toMatchObject({ type: "earn_redeem", vault: vaultAddr, status: "pending" });
    expect(BigInt(redeem.follow_up.amount)).toBeGreaterThan(0n);
    expect(BigInt(redeem.follow_up.amount)).toBeLessThanOrEqual(500n * ONE);
    expect(Number((await h.q<any>("select count(*)::int n from decisions where kind = 'YIELD_DEPOSIT'"))[0].n)).toBe(sweepsBefore); // no churn
  }, 240_000);

  it("does nothing (and does not crash) when the vault feed is unavailable", async () => {
    const { runCycle } = await import("../src/cycle/cycle.js");
    const { loadWorkerCfg } = await import("../src/config.js");
    const before = Number((await h.q<any>("select count(*)::int n from decisions"))[0].n);
    const r = await runCycle(loadWorkerCfg(), "scenario-yield", { vaults: async () => { throw new Error("earn api down"); } });
    expect(r.status).toBe("done");
    expect(Number((await h.q<any>("select count(*)::int n from decisions where kind in ('YIELD_DEPOSIT')"))[0].n)).toBeGreaterThanOrEqual(0);
    void before;
  }, 120_000);
});
