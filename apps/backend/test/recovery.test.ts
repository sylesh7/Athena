// Crash recovery, revert handling and the keeper (Phases 29.3 and 38) against a real contract and Postgres.
// These are the paths that stop the operator drifting into audit arrears, so each "crash" is simulated by doing only
// the first half of the lifecycle and then asking recoverDecisions() to finish it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import { createWalletClient, http, keccak256, stringToBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { actionHash, KIND, type Action } from "@athena/shared/action";
import { abi, KEY, ONE, rnd32, randAddr, runnable, startHarness, USDC, VENDOR_CAT, type Harness } from "./helpers/harness.js";

let h: Harness;
let vendor: Address;
let payeeId: Hex;
let life: typeof import("../src/decisions/lifecycle.js");
let rec: typeof import("../src/decisions/record.js");
let keeperCheck: typeof import("../src/keeper/check.js");
let seq = 0;
let cycleId = "";

const state = async (id: string) => (await h.q<any>("select * from decisions where decision_id = $1", [id]))[0];
const onchain = async (id: Hex) => (await h.pub.readContract({ address: h.treasury, abi, functionName: "getDecision", args: [id] })) as { state: number; revealed: boolean; flaggedOverdue: boolean };

/** Persist a sealed PAY decision (as the cycle would) without committing it. */
async function persistPay(amountUsdc: bigint, opts: { obligationStatus?: string } = {}) {
  const obligationId = rnd32();
  const evidenceHash = rnd32();
  await h.q(
    `insert into obligations(entity_id, obligation_id, payee_id, source, category, token, amount, due_date, criticality, evidence_hash, status)
     select $1,$2,p.id,'manual','VENDOR','USDC',$3,current_date,2,$4,$5 from payees p where p.slug = 'vendor:rec'`,
    [h.entityId, obligationId, (amountUsdc * ONE).toString(), evidenceHash, opts.obligationStatus ?? "open"]);
  const action: Action = { kind: KIND.PAY, obligationId, payeeId, token: USDC, amount: amountUsdc * ONE, maxFee: 0n, evidenceHash };
  const decisionId = keccak256(stringToBytes(`rec-${seq}-${Math.random()}`));
  const record: import("../src/decisions/record.js").DecisionRecord = {
    schema: "athena.decision.v1", decisionId, treasury: h.treasury, chainId: 5042002, network: "testnet", cycleId, seq: seq++, kind: "PAY_NOW",
    action: null, actionHash: "",
    subject: { obligation: { id: obligationId, payee: "Recovery Co", payeeId, invoiceNumber: null, amount: action.amount.toString(), dueDate: "2026-10-10", terms: null }, treasury: null },
    saw: { block: "1", snapshotHash: rnd32(), spendable: "0", reserve: "0", budget: null },
    forecast: { forecastHash: rnd32(), minBalanceStress: "0", firstShortfall: null, runwayDays: null },
    rule: { policyVersion: "policy.v1", checks: [{ name: "test", passed: true, detail: "" }], discountAprBps: null, bestVaultApyBps: null, expectEscalation: null },
    evidence: { evidenceHash, matchStatus: "matched" },
    planner: { mode: "default_policy", model: null, proposed: null, rationale: "recovery test", alternativesConsidered: [], overruled: false, overruleReason: null, truncated: false },
    followUp: null, createdAt: new Date().toISOString(),
  };
  const sealed = rec.sealRecord(record, action);
  await life.persistDecision({
    entityId: h.entityId, cycleId, seq: record.seq, decisionId: decisionId as Hex, kind: "PAY_NOW", obligationId, sealed,
    planner: { proposed: null, overruled: false, overruleReason: null }, followUp: null, scenario: true,
  });
  return { decisionId: decisionId as Hex, obligationId, action, sealed };
}
const row = async (id: string) => (await h.q<any>("select * from decisions where decision_id = $1", [id]))[0] as import("../src/decisions/lifecycle.js").DecisionRow;

beforeAll(async () => {
  if (!runnable) return;
  h = await startHarness({ anvil: 18548, pg: 54331 });
  vendor = randAddr();
  payeeId = rnd32();
  await h.activatePayee(payeeId, vendor);
  await h.q(
    `insert into payees(entity_id, slug, payee_id, name, kind, category, token, domain, account, status, active_from)
     values ($1,'vendor:rec',$2,'Recovery Co','vendor','VENDOR','USDC',26,$3,'active',now())`, [h.entityId, payeeId, vendor]);
  cycleId = (await h.q<{ id: string }>("insert into cycles(entity_id, trigger, status) values ($1,'scenario-recovery','done') returning id", [h.entityId]))[0]!.id;
  life = await import("../src/decisions/lifecycle.js");
  rec = await import("../src/decisions/record.js");
  keeperCheck = await import("../src/keeper/check.js");
}, 300_000);

afterAll(async () => { await h?.stop(); });

describe.skipIf(!runnable)("crash recovery (Phase 29.3)", () => {
  it("crash after persist, before commit: nothing on-chain, dropped as failed after the grace period", async () => {
    const d = await persistPay(10n);
    await life.recoverDecisions();
    expect((await state(d.decisionId)).state).toBe("recorded"); // inside the 10-minute grace period: left alone
    await h.q("update decisions set created_at = now() - interval '11 minutes' where decision_id = $1", [d.decisionId]);
    await life.recoverDecisions();
    expect((await state(d.decisionId)).state).toBe("failed");
    expect((await onchain(d.decisionId)).state).toBe(0);
  }, 60_000);

  it("crash between commit and execute: recovery executes it and reveals the stored bytes", async () => {
    const before = await h.balance(vendor);
    const d = await persistPay(40n);
    await life.commitDecision(await row(d.decisionId)); // …and then the worker "dies"
    expect((await onchain(d.decisionId)).state).toBe(1); // Committed
    await life.recoverDecisions();

    expect(await h.balance(vendor)).toBe(before + 40n * ONE);
    const oc = await onchain(d.decisionId);
    expect(oc.revealed).toBe(true);
    const s = await state(d.decisionId);
    expect(s.state).toBe("executed");
    expect(s.revealed).toBe(true);
  }, 90_000);

  it("crash between execute and reveal: recovery only reveals (no second payment)", async () => {
    const d = await persistPay(25n);
    await life.commitDecision(await row(d.decisionId));
    await life.executeDecision(await row(d.decisionId)); // executed, then "crash" before reveal
    const paid = await h.balance(vendor);
    expect((await onchain(d.decisionId)).revealed).toBe(false);

    await life.recoverDecisions();
    expect(await h.balance(vendor)).toBe(paid); // idempotent
    expect((await onchain(d.decisionId)).revealed).toBe(true);
    // what the chain emitted equals what we stored
    const ev = (await h.pub.getContractEvents({ address: h.treasury, abi, eventName: "DecisionRevealed", args: { decisionId: d.decisionId }, fromBlock: 0n })) as any[];
    expect(ev[0].args.preimage.toLowerCase()).toBe(d.sealed.canon.bytes.toLowerCase());
  }, 90_000);

  it("a committed decision that is no longer current is cancelled and revealed, and the obligation reopens", async () => {
    const d = await persistPay(15n);
    await life.commitDecision(await row(d.decisionId));
    await h.q("update obligations set status = 'paid' where obligation_id = $1", [d.obligationId]); // paid some other way
    const before = await h.balance(vendor);
    await life.recoverDecisions();
    expect(await h.balance(vendor)).toBe(before); // never executed
    expect((await state(d.decisionId)).state).toBe("cancelled");
    expect((await onchain(d.decisionId)).revealed).toBe(true);
  }, 90_000);

  it("a revert at execute (payee suspended after commit) cancels, reveals, and reopens the obligation", async () => {
    const d = await persistPay(12n);
    await life.commitDecision(await row(d.decisionId));
    await h.send(KEY.approver, h.treasury, abi, "suspendPayee", [payeeId]);
    const out = await life.executeDecision(await row(d.decisionId));
    expect(out).toBe("cancelled");
    await life.revealDecision(await row(d.decisionId));
    expect((await state(d.decisionId)).state).toBe("cancelled");
    expect((await onchain(d.decisionId)).revealed).toBe(true);
    expect((await h.q<any>("select status from obligations where obligation_id = $1", [d.obligationId]))[0].status).toBe("open");
    await h.send(KEY.approver, h.treasury, abi, "reactivatePayee", [payeeId]);
  }, 90_000);

  it("an ActionMismatch halts the operator instead of cancelling quietly", async () => {
    const d = await persistPay(11n);
    await life.commitDecision(await row(d.decisionId));
    // corrupt the stored action (simulating a serialization bug): the contract must refuse and the worker must halt
    await h.q("update decisions set action = jsonb_set(action, '{amount}', '\"999\"') where decision_id = $1", [d.decisionId]);
    await expect(life.executeDecision(await row(d.decisionId))).rejects.toBeInstanceOf(life.OperatorHalt);
    expect((await onchain(d.decisionId)).state).toBe(1); // still Committed — nothing moved

    // …and once the stored action is repaired, recovery completes it normally.
    await h.q("update decisions set action = $2 where decision_id = $1", [d.decisionId, JSON.stringify(rec.serializeAction(d.action))]);
    await life.recoverDecisions();
    expect((await onchain(d.decisionId)).revealed).toBe(true);
    expect((await state(d.decisionId)).state).toBe("executed");
  }, 90_000);
});

describe.skipIf(!runnable)("the keeper and the audit breaker (Phase 38 / S13)", () => {
  it("flags an unrevealed decision past the deadline; the operator is frozen until it reveals", async () => {
    // Shrink the deadline so the test doesn't need 7,200 blocks.
    await h.send(KEY.admin, h.treasury, abi, "setConfig", [0n, 3n * 86_400n, 30n, 1_000, 100]);

    const d = await persistPay(5n);
    await life.commitDecision(await row(d.decisionId));
    await life.executeDecision(await row(d.decisionId)); // executed, reveal WITHHELD (SKIP_REVEAL)

    // nothing to flag yet
    const keeperWallet = createWalletClient({ chain: h.pub.chain!, transport: http(h.rpc), account: privateKeyToAccount(KEY.stranger) });
    const deps = { pub: h.pub as never, wallet: keeperWallet as never, treasury: h.treasury, abi, deployBlock: h.deployBlock };
    expect(await keeperCheck.flagOverdueOnce(deps)).toEqual([]);

    await h.pub.request({ method: "anvil_mine" as never, params: ["0x24"] as never }); // 36 blocks > 30
    const flagged = await keeperCheck.flagOverdueOnce(deps);
    expect(flagged).toContain(d.decisionId);
    expect(((await h.pub.readContract({ address: h.treasury, abi, functionName: "overdueCount" })) as bigint)).toBe(1n);

    // the operator can no longer commit…
    const d2 = await persistPay(1n);
    await expect(life.commitDecision(await row(d2.decisionId))).rejects.toMatchObject({ errorName: "AuditInArrears" });

    // …until it publishes the overdue record (reveal is permissionless and works in arrears)
    await life.revealDecision(await row(d.decisionId));
    expect(((await h.pub.readContract({ address: h.treasury, abi, functionName: "overdueCount" })) as bigint)).toBe(0n);
    await life.commitDecision(await row(d2.decisionId)); // unfrozen
    expect((await onchain(d2.decisionId)).state).toBe(1);
  }, 120_000);
});
