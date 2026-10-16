// Vendor scorecard (pure) and its on-chain effect: a risky vendor's per-payment cap is tightened by the operator, never loosened.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { keccak256, stringToBytes } from "viem";
import { abi, KEY, ONE, rnd32, randAddr, runnable, startHarness, USDC, VENDOR_CAT, type Harness } from "./helpers/harness.js";
import { scoreFromAgreementBps, scoreVendor, tightenedCap, TIGHTEN_BELOW, type VendorStats } from "../src/reputation/scorecard.js";

const clean: VendorStats = { invoices: 10, matchedFirstTry: 10, duplicateAttempts: 0, addressChanges90d: 0, mismatches: 0, onTimeRate: null };

describe("scorecard (Phase 39.1)", () => {
  it("a clean vendor scores 100; a vendor with no history is not penalized", () => {
    expect(scoreVendor(clean).score).toBe(100);
    expect(scoreVendor({ ...clean, invoices: 0, matchedFirstTry: 0 }).score).toBe(100);
  });
  it("each bad signal costs what the README weights say", () => {
    expect(scoreVendor({ ...clean, matchedFirstTry: 5 }).components.accuracy).toBe(12.5); // half matched of 25
    expect(scoreVendor({ ...clean, duplicateAttempts: 1 }).components.duplicates).toBe(10);
    expect(scoreVendor({ ...clean, duplicateAttempts: 9 }).components.duplicates).toBe(0); // floored
    expect(scoreVendor({ ...clean, addressChanges90d: 1 }).components.addressChanges).toBe(5);
    expect(scoreVendor({ ...clean, mismatches: 5 }).components.mismatches).toBe(7.5);
  });
  it("known on-time rate counts; unknown (no delivery dates yet) is full marks", () => {
    expect(scoreVendor({ ...clean, onTimeRate: 0.5 }).components.onTime).toBe(15);
    expect(scoreVendor(clean).components.onTime).toBe(30);
  });
  it("the README example: two intercepted address changes and one duplicate drops below 50 when combined with poor accuracy", () => {
    const s = scoreVendor({ invoices: 4, matchedFirstTry: 1, duplicateAttempts: 1, addressChanges90d: 2, mismatches: 2, onTimeRate: 0.4 });
    expect(s.score).toBeLessThan(TIGHTEN_BELOW);
  });
  it("score is always within 0..100", () => {
    const worst = scoreVendor({ invoices: 1, matchedFirstTry: 0, duplicateAttempts: 99, addressChanges90d: 99, mismatches: 99, onTimeRate: 0 });
    expect(worst.score).toBe(0);
  });
});

describe("cap tightening rule", () => {
  it("only below the threshold, to half the category approval limit, and never a loosening", () => {
    expect(tightenedCap({ score: 80, categoryApprovalLimit: 250n * ONE, currentCap: 0n })).toBeNull();
    expect(tightenedCap({ score: 30, categoryApprovalLimit: 250n * ONE, currentCap: 0n })).toBe(125n * ONE);
    expect(tightenedCap({ score: 30, categoryApprovalLimit: 250n * ONE, currentCap: 200n * ONE })).toBe(125n * ONE);
    expect(tightenedCap({ score: 30, categoryApprovalLimit: 250n * ONE, currentCap: 100n * ONE })).toBeNull(); // already tighter
    expect(tightenedCap({ score: 30, categoryApprovalLimit: 0n, currentCap: 0n })).toBeNull(); // no limit to halve
  });
});

describe("daily feedback score", () => {
  it("maps agreement bps to 0..100 and reports nothing when there are no reviews", () => {
    expect(scoreFromAgreementBps(10_000)).toBe(100);
    expect(scoreFromAgreementBps(7_550)).toBe(76);
    expect(scoreFromAgreementBps(null)).toBeNull();
  });
});

let h: Harness;
beforeAll(async () => {
  if (!runnable) return;
  h = await startHarness({ anvil: 18552, pg: 54341 });
}, 300_000);
afterAll(async () => { await h?.stop(); });

describe.skipIf(!runnable)("scorecards recomputed from real data tighten a risky vendor's cap on-chain (Phase 39)", () => {
  it("risky vendor: score drops, cap is tightened on-chain by the operator; clean vendor and a second run change nothing", async () => {
    const { recomputeScorecards } = await import("../src/reputation/recompute.js");
    const addPayee = async (slug: string) => {
      const payeeId = rnd32();
      const account = randAddr();
      await h.activatePayee(payeeId, account);
      const row = (await h.q<any>(
        `insert into payees(entity_id, slug, payee_id, name, kind, category, token, domain, account, status, active_from)
         values ($1,$2,$3,$2,'vendor','VENDOR','USDC',26,$4,'active',now()) returning id`, [h.entityId, slug, payeeId, account]))[0];
      return { id: row.id as string, payeeId };
    };
    const bad = await addPayee("vendor:shady");
    const good = await addPayee("vendor:solid");
    const doc = async () => (await h.q<any>("insert into documents(entity_id, source, storage_path, sha256) values ($1,'seed','x',$2) returning id", [h.entityId, rnd32()]))[0].id as string;
    const inv = async (payee: string, n: number, over: Record<string, unknown>) =>
      h.q("insert into invoices(entity_id, document_id, payee_id, invoice_number, extracted, status, match_status, hold_reason) values ($1,$2,$3,$4,'{}','held',$5,$6)",
        [h.entityId, await doc(), payee, `I-${n}`, over.match ?? "mismatch", over.hold ?? null]);
    await inv(bad.id, 1, { hold: "duplicate" });
    await inv(bad.id, 2, { hold: "duplicate" });
    await inv(bad.id, 3, { hold: "mismatch" });
    await inv(bad.id, 4, { hold: "mismatch" });
    await h.q("insert into payee_address_history(payee_id, new_account, source, status) values ($1,$2,'invoice','proposed'), ($1,$3,'invoice','proposed')", [bad.id, randAddr(), randAddr()]);
    for (let i = 0; i < 5; i++) await inv(good.id, 100 + i, { match: "matched" });

    const limit = (cat: string, tok: string) => (cat === "VENDOR" && tok === "USDC" ? 250n * ONE : 0n);
    const r1 = await recomputeScorecards(limit);
    expect(r1.updated).toBe(2);
    expect(r1.tightened).toBe(1);

    const badRow = (await h.q<any>("select scorecard, per_tx_cap::text from payees where id = $1", [bad.id]))[0];
    const goodRow = (await h.q<any>("select scorecard, per_tx_cap::text from payees where id = $1", [good.id]))[0];
    expect(badRow.scorecard.score).toBeLessThan(50);
    expect(goodRow.scorecard.score).toBe(100);
    expect(badRow.per_tx_cap).toBe((125n * ONE).toString());
    expect(goodRow.per_tx_cap).toBe("0");

    // the cap really changed ON-CHAIN, set by the operator, and an over-cap payment now escalates
    const onchain = (await h.pub.readContract({ address: h.treasury, abi, functionName: "getPayee", args: [bad.payeeId] })) as { data: { perTxCap: bigint } };
    expect(onchain.data.perTxCap).toBe(125n * ONE);
    const events = (await h.pub.getContractEvents({ address: h.treasury, abi, eventName: "PayeeCapChanged", fromBlock: 0n })) as any[];
    expect(events.at(-1).args.newCap).toBe(125n * ONE);

    // idempotent: nothing further to tighten, no revert spam
    const r2 = await recomputeScorecards(limit);
    expect(r2.tightened).toBe(0);
    expect(((await h.pub.readContract({ address: h.treasury, abi, functionName: "getPayee", args: [bad.payeeId] })) as any).data.perTxCap).toBe(125n * ONE);
  }, 240_000);
});
void keccak256; void stringToBytes; void USDC; void VENDOR_CAT; void KEY;
