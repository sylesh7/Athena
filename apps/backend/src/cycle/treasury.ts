// Treasury-level decisions (yield deposit / redeem; later FX, consolidation, service top-ups). Same path as obligation
// decisions: build a canonical record → persist BEFORE commit → the cycle commits, executes and reveals them. The model is
// not involved: these use the deterministic default policy (README Phase 25), and every decision's reasoning is in its record.
import type { Hex } from "viem";
import { keccak256, stringToBytes, zeroHash } from "viem";
import { net } from "@athena/shared/addresses";
import { KIND, type Action } from "@athena/shared/action";
import { decisionId as makeDecisionId } from "@athena/shared/ids";
import { q } from "../db.js";
import { log } from "../log.js";
import { pub, treasuryAbi, TREASURY } from "../chain/readClient.js";
import { persistDecision, type DecisionRow } from "../decisions/lifecycle.js";
import { sealRecord, type DecisionKind, type DecisionRecord } from "../decisions/record.js";
import { derived, type Snapshot } from "../snapshot/snapshot.js";
import type { Forecast } from "../forecast/forecast.js";
import { planRedeem, planSweep, surplusUnits, type RawVault } from "../yield/select.js";
import { eurcNeed, expectedEurcOut, usdcForEurc } from "../fx/rates.js";

export interface TreasuryCtx {
  entityId: string; cycleId: string; snap: Snapshot; snapHash: string; forecastHash: string; fc: Forecast;
  firstSeq: number; scenario: boolean; network: "testnet" | "mainnet";
  yield: { enabled: boolean; minSweepUnits: bigint; horizonDays: number; vaults: () => Promise<RawVault[]> };
  /** FX: buy EURC when euro obligations are due soon and the treasury lacks EURC. Reference prices are injected (App Kit feed). */
  fx: { enabled: boolean; eurcDueSoon: bigint; marginBps: bigint; prices: () => Promise<{ usdc: bigint; eurc: bigint }> };
  /** Gateway: USDC the collections wallet may sweep into the treasury (available minus unsettled x402 credits). */
  gateway: { consolidatable: bigint };
  /** Services: keep the spend wallet's Gateway balance topped up (x402 purchases draw from it). */
  services: { enabled: boolean; spendGatewayBalance: bigint };
}

const ZERO = zeroHash as Hex;

async function internalPayee(entityId: string, slug: string): Promise<{ payeeId: Hex; payable: boolean } | null> {
  const r = (await q<{ payee_id: string; status: string }>("select payee_id, status from payees where entity_id = $1 and slug = $2", [entityId, slug]))[0];
  if (!r || r.status !== "active") return null;
  const ok = (await pub.readContract({ address: TREASURY, abi: treasuryAbi, functionName: "isPayable", args: [r.payee_id as Hex] })) as boolean;
  return { payeeId: r.payee_id as Hex, payable: ok };
}

interface Item {
  kind: DecisionKind; action: Action | null; rationale: string;
  subject: NonNullable<DecisionRecord["subject"]["treasury"]>; followUp: unknown; checks: DecisionRecord["rule"]["checks"];
}

/** Returns the persisted (not yet committed) decision rows. Never throws for "nothing to do" or an unavailable vault feed. */
export async function planTreasuryDecisions(ctx: TreasuryCtx): Promise<DecisionRow[]> {
  const items: Item[] = [];
  const d = derived(ctx.snap);
  const usdc = net(ctx.network).tokens.USDC as `0x${string}`;

  if (ctx.yield.enabled) {
    try {
      const yieldPayee = await internalPayee(ctx.entityId, "internal:yield");
      const budget = ctx.snap.budgets.find((b) => b.category === "YIELD" && b.token === "USDC");
      if (!yieldPayee?.payable) log.info("yield: internal:yield payee is not active/payable yet — skipping");
      else if (!budget) log.info("yield: no YIELD/USDC budget configured on the contract yet — skipping");
      else {
        const positions = (await q<{ vault_address: string; value: string }>("select vault_address, value::text from yield_positions where value > 0"))
          .map((p) => ({ vault: p.vault_address, value: BigInt(p.value) }));
        const minOperating = BigInt(ctx.snap.treasury.tokens.USDC.minOperating);
        const horizon = ctx.fc.days.slice(0, ctx.yield.horizonDays + 1);
        const minStress = horizon.reduce((m, x) => { const b = BigInt(x.balanceStress); return b < m ? b : m; }, BigInt(horizon[0]?.balanceStress ?? "0"));
        const next30Out = ctx.fc.days.reduce((a, x) => a + BigInt(x.outflows), 0n);
        const buffer = (() => { const t = next30Out / 10n; return minOperating > t ? minOperating : t; })();

        // A redemption that has not finished returning cash yet is "in flight": planning another (or a sweep) now would double-count.
        const redeemInFlight = Number((await q<{ n: string }>("select count(*)::text n from decisions where kind = 'YIELD_REDEEM' and follow_up->>'status' = 'pending'"))[0]!.n) > 0;
        // 1. Money needed soon? Redeem first (a redemption and a deposit in the same cycle would just churn).
        const redeem = redeemInFlight ? null : planRedeem({ minStressBalance: minStress, buffer, positions });
        if (redeem) {
          items.push({
            kind: "YIELD_REDEEM", action: null, rationale: redeem.rationale,
            subject: { from: `vault:${redeem.vault}`, to: "treasury", amount: redeem.amount.toString() },
            followUp: { type: "earn_redeem", vault: redeem.vault, amount: redeem.amount.toString(), status: "pending" },
            checks: [{ name: "stress_shortfall", passed: true, detail: `minStress ${minStress} < buffer ${buffer}` }],
          });
        } else if (!redeemInFlight) {
          // 2. Otherwise sweep genuine surplus into the best vault.
          const surplus = surplusUnits({ minStressBalanceInHorizon: minStress, minOperating, next30DayOutflows: next30Out });
          const free = d.spendableUsdc;
          // Stay under the budget's per-payment approval limit (0 = none): a larger sweep would just escalate to a human.
          const approval = BigInt(budget.perTxApprovalLimit);
          const room = approval !== 0n && approval < BigInt(budget.remaining) ? approval : BigInt(budget.remaining);
          const sweep = planSweep({
            surplus: surplus < free ? surplus : free, budgetRemaining: room, minSweep: ctx.yield.minSweepUnits,
            vaults: await ctx.yield.vaults(), positions,
          });
          if (sweep) {
            items.push({
              kind: "YIELD_DEPOSIT", rationale: sweep.rationale,
              action: { kind: KIND.PAY, obligationId: ZERO, payeeId: yieldPayee.payeeId, token: usdc, amount: sweep.amount, maxFee: 0n, evidenceHash: ZERO },
              subject: { from: "treasury", to: `vault:${sweep.vault.vault}`, amount: sweep.amount.toString() },
              followUp: { type: "earn_deposit", vault: sweep.vault.vault, amount: sweep.amount.toString(), status: "pending" },
              checks: [
                { name: "surplus", passed: true, detail: `surplus ${surplus} ≥ min sweep ${ctx.yield.minSweepUnits}` },
                { name: "budget", passed: true, detail: `YIELD budget remaining ${budget.remaining}` },
                { name: "vault_liquidity", passed: true, detail: `available ${sweep.vault.availableLiquidity} ≥ 3× deposit` },
              ],
            });
          }
        }
      }
    } catch (err) {
      log.warn({ err: String(err) }, "yield planning skipped (vault feed or policy read failed)");
    }
  }

  // ── Cash shortfall with no yield to redeem → pull from Gateway (collections wallet) ────────────────────────────────
  if (ctx.gateway.consolidatable > 0n && !items.some((i) => i.kind === "YIELD_REDEEM")) {
    try {
      const inflight = Number((await q<{ n: string }>("select count(*)::text n from decisions where kind = 'CONSOLIDATE' and follow_up->>'status' in ('pending','minting')"))[0]!.n) > 0;
      const minOperating = BigInt(ctx.snap.treasury.tokens.USDC.minOperating);
      const horizon = ctx.fc.days.slice(0, ctx.yield.horizonDays + 1);
      const minStress = horizon.reduce((m, x) => { const b = BigInt(x.balanceStress); return b < m ? b : m; }, BigInt(horizon[0]?.balanceStress ?? "0"));
      const next30Out = ctx.fc.days.reduce((a, x) => a + BigInt(x.outflows), 0n);
      const buffer = (() => { const t10 = next30Out / 10n; return minOperating > t10 ? minOperating : t10; })();
      const need = buffer - minStress;
      if (!inflight && need > 0n) {
        const amount = need < ctx.gateway.consolidatable ? need : ctx.gateway.consolidatable;
        items.push({
          kind: "CONSOLIDATE", action: null,
          rationale: `Stress forecast falls ${need} atomic units short of the buffer and there is nothing in yield to redeem; sweeping ${amount} from the collections wallet's Gateway balance straight into the treasury (excluding unsettled x402 receivables).`,
          subject: { from: "gateway:collections", to: "treasury", amount: amount.toString() },
          followUp: { type: "gateway_consolidate", amount: amount.toString(), status: "pending", attempts: 0 },
          checks: [{ name: "stress_shortfall", passed: true, detail: `minStress ${minStress} < buffer ${buffer}` }, { name: "consolidatable", passed: true, detail: `${ctx.gateway.consolidatable} available after x402 reserve` }],
        });
      }
    } catch (err) {
      log.warn({ err: String(err) }, "gateway consolidation planning skipped");
    }
  }

  // ── Keep the services spend wallet funded: top up when its Gateway balance would last < 5 days ──────────────────────
  if (ctx.services.enabled) {
    try {
      const spendPayee = await internalPayee(ctx.entityId, "internal:spend");
      const budget = ctx.snap.budgets.find((b) => b.category === "SERVICES" && b.token === "USDC");
      const spent7 = BigInt((await q<{ s: string }>("select coalesce(sum(amount),0)::text s from service_purchases where ok and created_at > now() - interval '7 days'"))[0]!.s);
      const daily = spent7 / 7n;
      const inflight = Number((await q<{ n: string }>("select count(*)::text n from decisions where kind = 'TOP_UP_SERVICES' and follow_up->>'status' = 'pending'"))[0]!.n) > 0;
      const bootstrap = 1_000_000n; // 1 USDC to get going when there is no spend history yet
      const wanted = daily > 0n ? daily * 14n : bootstrap;
      const low = daily > 0n ? ctx.services.spendGatewayBalance < daily * 5n : ctx.services.spendGatewayBalance < bootstrap / 10n;
      if (low && !inflight && spendPayee?.payable && budget) {
        const approval = BigInt(budget.perTxApprovalLimit);
        const room = approval !== 0n && approval < BigInt(budget.remaining) ? approval : BigInt(budget.remaining);
        const amount = [wanted, room, d.spendableUsdc].reduce((m, x) => (x < m ? x : m));
        if (amount > 0n) {
          items.push({
            kind: "TOP_UP_SERVICES",
            action: { kind: KIND.PAY, obligationId: ZERO, payeeId: spendPayee.payeeId, token: usdc, amount, maxFee: 0n, evidenceHash: ZERO },
            rationale: `The services wallet's Gateway balance (${ctx.services.spendGatewayBalance}) covers < 5 days at the observed spend (${daily}/day); topping up ${amount} (≤ SERVICES budget and approval limit).`,
            subject: { from: "treasury", to: "spend-wallet → Gateway", amount: amount.toString() },
            followUp: { type: "gateway_deposit", amount: amount.toString(), status: "pending" },
            checks: [{ name: "runway", passed: true, detail: `balance ${ctx.services.spendGatewayBalance} < 5 days of ${daily}/day` }, { name: "budget", passed: true, detail: `SERVICES remaining ${budget.remaining}, approval ${budget.perTxApprovalLimit}` }],
          });
        }
      }
    } catch (err) {
      log.warn({ err: String(err) }, "services top-up planning skipped");
    }
  }

  if (ctx.fx.enabled && ctx.fx.eurcDueSoon > 0n) {
    try {
      let need = eurcNeed({ dueSoon: ctx.fx.eurcDueSoon, spendable: d.spendableEurc, floor: BigInt(ctx.snap.treasury.tokens.EURC.minOperating) });
      if (need > 0n) {
        // EURC already bought but not yet returned to the treasury (swap refused/pending/in flight) counts toward the need —
        // otherwise a stuck follow-up would make every cycle buy the same euros again.
        const inflight = (await q<{ usdc: string }>(
          "select coalesce(sum((follow_up->>'usdcAmount')::numeric),0)::text as usdc from decisions where kind = 'FX' and state in ('executed','approved') and follow_up->>'status' in ('pending','swapped')"))[0]!;
        if (BigInt(inflight.usdc) > 0n) {
          const ref0 = await ctx.fx.prices();
          need = need - expectedEurcOut(BigInt(inflight.usdc), ref0.usdc, ref0.eurc);
          if (need < 0n) need = 0n;
        }
      }
      const fxPayee = need > 0n ? await internalPayee(ctx.entityId, "internal:fx") : null;
      const budget = ctx.snap.budgets.find((b) => b.category === "FX" && b.token === "USDC");
      if (need > 0n && !fxPayee?.payable) log.info("fx: internal:fx payee is not active/payable yet — skipping");
      else if (need > 0n && !budget) log.info("fx: no FX/USDC budget configured on the contract yet — skipping");
      else if (need > 0n && fxPayee && budget) {
        const ref = await ctx.fx.prices();
        const wanted = usdcForEurc(need, ref.usdc, ref.eurc, ctx.fx.marginBps);
        const approval = BigInt(budget.perTxApprovalLimit);
        const room = approval !== 0n && approval < BigInt(budget.remaining) ? approval : BigInt(budget.remaining);
        const usdcAmount = [wanted, room, d.spendableUsdc].reduce((m, x) => (x < m ? x : m));
        if (usdcAmount > 0n) {
          items.push({
            kind: "FX", rationale: `Euro obligations of ${ctx.fx.eurcDueSoon} EURC-units fall due within 14 days and the treasury is ${need} EURC short; buying with ${usdcAmount} USDC at the reference rate (+${ctx.fx.marginBps} bps margin).`,
            action: { kind: KIND.PAY, obligationId: ZERO, payeeId: fxPayee.payeeId, token: usdc, amount: usdcAmount, maxFee: 0n, evidenceHash: ZERO },
            subject: { from: "treasury", to: "fx-wallet (USDC→EURC)", amount: usdcAmount.toString() },
            followUp: { type: "fx_swap", usdcAmount: usdcAmount.toString(), status: "pending", attempts: 0 },
            checks: [
              { name: "eurc_need", passed: true, detail: `need ${need} EURC (due ${ctx.fx.eurcDueSoon}, spendable ${d.spendableEurc})` },
              { name: "budget", passed: true, detail: `FX budget remaining ${budget.remaining}, approval limit ${budget.perTxApprovalLimit}` },
              { name: "reference_rate", passed: true, detail: `usdc ${ref.usdc} / eurc ${ref.eurc} micro-USD` },
            ],
          });
        }
      }
    } catch (err) {
      log.warn({ err: String(err) }, "fx planning skipped (reference price feed or policy read failed)");
    }
  }

  const rows: DecisionRow[] = [];
  let seq = ctx.firstSeq;
  for (const it of items) {
    const id = makeDecisionId(TREASURY, ctx.cycleId, seq);
    // Internal moves: obligationId = keccak256(decisionId) makes each one unique and idempotent on-chain.
    const action = it.action ? { ...it.action, obligationId: keccak256(stringToBytes(id)) as Hex } : null;
    const record: DecisionRecord = {
      schema: "athena.decision.v1", decisionId: id, treasury: TREASURY, chainId: ctx.snap.chainId, network: ctx.snap.network, cycleId: ctx.cycleId, seq, kind: it.kind,
      action: null, actionHash: "",
      subject: { obligation: null, treasury: it.subject },
      saw: {
        block: ctx.snap.block, snapshotHash: ctx.snapHash, spendable: d.spendableUsdc.toString(), reserve: d.reserve.toString(),
        budget: (() => { const cat = it.kind === "FX" ? "FX" : it.kind === "TOP_UP_SERVICES" ? "SERVICES" : "YIELD"; const b = ctx.snap.budgets.find((x) => x.category === cat && x.token === "USDC"); return b ? { category: b.category, remaining: b.remaining, approvalLimit: b.perTxApprovalLimit } : null; })(),
      },
      forecast: { forecastHash: ctx.forecastHash, minBalanceStress: ctx.fc.minBalanceStress.amount, firstShortfall: ctx.fc.shortfalls[0]?.date ?? null, runwayDays: ctx.fc.runwayDays },
      rule: { policyVersion: "policy.v1", checks: it.checks, discountAprBps: null, bestVaultApyBps: null, expectEscalation: null },
      evidence: { evidenceHash: null, matchStatus: null },
      planner: { mode: "default_policy", model: null, proposed: null, rationale: it.rationale, alternativesConsidered: [], overruled: false, overruleReason: null, truncated: false },
      followUp: it.followUp, createdAt: new Date().toISOString(),
    };
    const sealed = sealRecord(record, action);
    await persistDecision({
      entityId: ctx.entityId, cycleId: ctx.cycleId, seq, decisionId: id, kind: it.kind, obligationId: null, sealed,
      planner: { proposed: null, overruled: false, overruleReason: null }, followUp: it.followUp, scenario: ctx.scenario,
    });
    rows.push((await q<DecisionRow>("select * from decisions where decision_id = $1", [id]))[0]!);
    seq++;
  }
  return rows;
}
