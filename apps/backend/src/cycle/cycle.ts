// Phase 37 — one function runs a full treasury cycle end to end, safely.
// recover → sync → ingest/validate → payees/receivables → snapshot → forecast → policy → plan → validate →
// record → commit → execute → reveal. Implemented here: the obligation (AP) spine. Yield/FX/consolidation/service
// decisions plug into the same persist → commit → execute → reveal path (README phases 31–36).
import { randomUUID } from "node:crypto";
import type { Hex } from "viem";
import { net } from "@athena/shared/addresses";
import { KIND, type Action } from "@athena/shared/action";
import { canonicalRecord } from "@athena/shared/canonical";
import { decisionId as makeDecisionId } from "@athena/shared/ids";
import type { WorkerCfg } from "../config.js";
import { q, withCycleLock, notify } from "../db.js";
import { log } from "../log.js";
import { pub, treasuryAbi, TREASURY } from "../chain/readClient.js";
import { operatorWallet } from "../chain/clients.js";
import { recoverDecisions, persistDecision, commitDecision, executeDecision, revealDecision, OperatorHalt, type DecisionRow } from "../decisions/lifecycle.js";
import { ONCHAIN_KINDS, sealRecord, type DecisionKind, type DecisionRecord } from "../decisions/record.js";
import { indexOnce } from "../indexer/indexer.js";
import { forecast, type Forecast, type ForecastInputs } from "../forecast/forecast.js";
import { buildOptions, defaultOrder, type ObligationInput } from "../policy/options.js";
import { defaultPlan, validateObligationPlan, type ValidatedObligation } from "../planner/validate.js";
import { planWithLlm } from "../planner/llm.js";
import { resolveLlm } from "../llm/tool.js";
import { derived, takeSnapshot, type Snapshot } from "../snapshot/snapshot.js";
import { processExtractionQueue } from "../ingest/extract.js";
import { processValidationQueue } from "../validate/pipeline.js";
import { processAddressChanges, processPayeeDrafts, rescreenDue } from "../payees/onboarding.js";
import { registerDraftReceivables } from "../ar/receivables.js";
import { expireEscalations, notifyPendingEscalations } from "../escalations/notifier.js";
import { relayPending } from "../cctp/relayer.js";
import { snapshotMetrics } from "../metrics/metrics.js";

const POLICY_VERSION = "policy.v1";
const CYCLE_TIME_BUDGET_MS = 5 * 60_000;
const MIN_GAS_NATIVE = 2n * 10n ** 18n; // 2 USDC in the 18-decimal NATIVE unit (gas only)

type Step = { name: string; ms: number; ok: boolean; error?: string };

interface ObRow {
  obligation_id: string; payee_row_id: string; payee_name: string; payee_id: string; category: string; token: "USDC" | "EURC";
  amount: string; due_date: string; invoice_date: string | null; terms: any; criticality: number; evidence_hash: string | null;
  status: string; planned_pay_date: string | null; invoice_number: string | null; per_tx_cap: string; scorecard: any; risk_tier: string;
  vendor_notes: string | null; payee_status: string;
}

const today = () => new Date().toISOString().slice(0, 10);
const dateStr = (d: Date | string | null) => (d === null ? null : typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10));

export async function runCycle(w: WorkerCfg, trigger: string, opts: { dryRun?: boolean } = {}) {
  if (!w.OPERATOR_ENABLED) return { status: "skipped" as const, reason: "operator disabled" };
  const dryRun = opts.dryRun ?? w.DRY_RUN;

  const out = await withCycleLock(async () => {
    const entity = (await q<{ id: string }>("select id from entities where treasury_address ilike $1 limit 1", [TREASURY]))[0];
    if (!entity) throw new Error(`no entities row for treasury ${TREASURY}`);
    const cycleId = randomUUID();
    await q("insert into cycles(id, entity_id, trigger, dry_run) values ($1,$2,$3,$4)", [cycleId, entity.id, trigger, dryRun]);
    const steps: Step[] = [];
    const startedAt = Date.now();
    const step = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
      const t0 = Date.now();
      try {
        const r = await fn();
        steps.push({ name, ms: Date.now() - t0, ok: true });
        await notify("cycle.step", { cycleId, step: name, ok: true });
        return r;
      } catch (e) {
        steps.push({ name, ms: Date.now() - t0, ok: false, error: String(e) });
        throw e;
      } finally {
        await q("update cycles set validation = jsonb_build_object('steps', $2::jsonb) where id = $1", [cycleId, JSON.stringify(steps)]);
      }
    };
    const finish = async (status: "done" | "failed" | "skipped", error?: string) => {
      await q("update cycles set status = $2, error = $3, finished_at = now() where id = $1", [cycleId, status, error ?? null]);
      return { status, cycleId, ...(error ? { error } : {}) } as const;
    };

    try {
      await step("recover", () => recoverDecisions());
      await step("sync", () => indexOnce());

      // Document → obligation pipeline (Phases 20–24). Each step can only hold or create obligations, never pay.
      const extractLlm = resolveLlm(w, w.EXTRACTOR_MODEL);
      await step("ingest", async () => {
        if (!extractLlm) { log.warn("no LLM key/EXTRACTOR_MODEL — invoice extraction skipped"); return 0; }
        return processExtractionQueue({ llm: extractLlm });
      });
      await step("validate", () => processValidationQueue());
      await step("payees", async () => {
        await processPayeeDrafts(w.CIRCLE_API_KEY);
        await processAddressChanges(w.CIRCLE_API_KEY);
      });
      await step("receivables", () => registerDraftReceivables(w.CIRCLE_API_KEY));

      // Gas floor: below 2 USDC native, run dry and alert instead of failing mid-commit.
      const gas = await pub.getBalance({ address: operatorWallet.account!.address });
      const effectiveDry = dryRun || gas < MIN_GAS_NATIVE;
      if (!dryRun && effectiveDry) log.error({ gas: gas.toString() }, "P2: operator gas below floor — running dry");

      const snapRes = await step("snapshot", () => takeSnapshot());
      const snap = snapRes.snapshot;
      await q("update cycles set snapshot = $2, snapshot_hash = $3 where id = $1", [cycleId, JSON.stringify(snap), snapRes.hash]);
      if (snap.treasury.paused) return await finish("skipped", "treasury paused");
      await step("screen", () => rescreenDue(w.CIRCLE_API_KEY, (cat, tok) =>
        BigInt(snap.budgets.find((b) => b.category === cat && b.token === tok)?.perTxApprovalLimit ?? "0")));

      const day = today();
      const obRows = await q<ObRow>(
        `select o.obligation_id, p.id as payee_row_id, p.name as payee_name, p.payee_id, o.category, o.token, o.amount::text, o.due_date::text,
                i.invoice_date::text, o.terms, o.criticality, o.evidence_hash, o.status, o.planned_pay_date::text,
                i.invoice_number, p.per_tx_cap::text, p.scorecard, p.risk_tier, i.extracted->>'notes' as vendor_notes, p.status as payee_status
         from obligations o join payees p on p.id = o.payee_id left join invoices i on i.id = o.invoice_id
         where o.entity_id = $1 and o.status in ('open','scheduled','held')`, [entity.id]);

      const d = derived(snap);
      const fcBase = await step("forecast_inputs", () => loadForecastInputs(entity.id, day, d.spendableUsdc));
      const fcFull: ForecastInputs = {
        ...fcBase,
        obligations: obRows.filter((r) => r.token === "USDC").map((r) => ({ payDate: r.planned_pay_date ?? r.due_date, amount: BigInt(r.amount) })),
      };
      const fc: Forecast = forecast(fcFull, w.FORECAST_HORIZON_DAYS, w.STRESS_INFLOW_DELAY_DAYS, w.STRESS_RECEIVABLE_HAIRCUT_BPS);
      const forecastHash = canonicalRecord(fc).sha256;
      await q("update cycles set forecast = $2, forecast_hash = $3 where id = $1", [cycleId, JSON.stringify(fc), forecastHash]);

      // Policy facts: payability confirmed on-chain, budgets from the pinned snapshot.
      const inputs = await step("policy", async () => Promise.all(obRows.map((r) => toObligationInput(r, snap))));
      const bestVaultApy = snap.yield.reduce((m, y) => Math.max(m, y.apyBps ?? 0), 0);
      const options = buildOptions({
        today: day, obligations: inputs, spendable: { USDC: d.spendableUsdc, EURC: d.spendableEurc },
        bestVaultApyBps: BigInt(bestVaultApy), earlyPayMarginBps: w.EARLY_PAY_MARGIN_BPS,
      });
      const order = defaultOrder(inputs);
      const criticality = Object.fromEntries(inputs.map((o) => [o.obligationId, o.criticality]));
      await q("update cycles set policy_facts = $2 where id = $1", [cycleId, JSON.stringify({ policyVersion: POLICY_VERSION, options, defaultOrder: order })]);

      // Plan: LLM if available, otherwise (or on failure) the deterministic default.
      // PLANNER_MODEL=none runs the deterministic default plan only (offline/dev/tests).
      const plannerLlm = resolveLlm(w, w.PLANNER_MODEL);
      const llm = options.length === 0 || !plannerLlm ? null : await step("plan", () => planWithLlm({
        llm: plannerLlm,
        facts: {
          cycleId, block: snap.block, today: day, spendableUsdc: d.spendableUsdc.toString(),
          minBalanceStress: fc.minBalanceStress.amount, firstShortfall: fc.shortfalls[0]?.date ?? null,
          bestVaultApyBps: String(bestVaultApy), options, criticality, defaultOrder: order,
          vendorNotes: Object.fromEntries(obRows.filter((r) => r.vendor_notes).map((r) => [r.obligation_id, r.vendor_notes!])),
        },
      }));
      const plan = llm?.plan ?? defaultPlan(options, order);
      await q("update cycles set plan = $2 where id = $1", [cycleId, JSON.stringify({ mode: llm ? "llm" : "default_policy", model: llm ? w.PLANNER_MODEL : null, plan })]);

      const validated = await step("validate_plan", async () => validateObligationPlan({
        today: day, proposed: plan, options, criticality, defaultOrder: order,
        base: fcBase, // obligations excluded: the validator places each planned one itself
        horizon: w.FORECAST_HORIZON_DAYS, stressDelayDays: w.STRESS_INFLOW_DELAY_DAYS, haircutBps: w.STRESS_RECEIVABLE_HAIRCUT_BPS,
      }));

      // Only STATE CHANGES become decisions (an unchanged SCHEDULE across ten cycles is one decision, not ten).
      const changed = validated.items.filter((it) => isStateChange(it, obRows.find((r) => r.obligation_id === it.obligationId)!));
      const rows: DecisionRow[] = [];
      let seq = 0;
      for (const it of changed) {
        if (Date.now() - startedAt > CYCLE_TIME_BUDGET_MS) { log.warn("cycle time budget exceeded — stopping new commits"); break; }
        const r = obRows.find((x) => x.obligation_id === it.obligationId)!;
        const opt = options.find((o) => o.obligationId === it.obligationId)!;
        const kind = it.final.choice as DecisionKind;
        const decisionId = makeDecisionId(TREASURY, cycleId, seq);
        const action = ONCHAIN_KINDS.has(kind) ? buildPayAction(r, it, snap) : null;
        const record: DecisionRecord = {
          schema: "athena.decision.v1", decisionId, treasury: TREASURY, chainId: snap.chainId, network: snap.network, cycleId, seq, kind,
          action: null, actionHash: "",
          subject: {
            obligation: { id: r.obligation_id, payee: r.payee_name, payeeId: r.payee_id, invoiceNumber: r.invoice_number, amount: it.final.amount.toString(), dueDate: r.due_date, terms: r.terms ?? null },
            treasury: null,
          },
          saw: {
            block: snap.block, snapshotHash: snapRes.hash, spendable: d.spendableUsdc.toString(), reserve: d.reserve.toString(),
            budget: (() => { const b = snap.budgets.find((x) => x.category === r.category && x.token === r.token); return b ? { category: b.category, remaining: b.remaining, approvalLimit: b.perTxApprovalLimit } : null; })(),
          },
          forecast: { forecastHash, minBalanceStress: fc.minBalanceStress.amount, firstShortfall: fc.shortfalls[0]?.date ?? null, runwayDays: fc.runwayDays },
          rule: {
            policyVersion: POLICY_VERSION,
            checks: [...it.checks, ...validated.checks],
            discountAprBps: opt.payEarly?.aprBps ?? null, bestVaultApyBps: String(bestVaultApy), expectEscalation: opt.expectEscalation ?? null,
          },
          evidence: { evidenceHash: r.evidence_hash, matchStatus: r.evidence_hash ? "matched" : null },
          planner: {
            mode: llm ? "llm" : "default_policy", model: llm ? w.PLANNER_MODEL : null, proposed: it.proposed ?? null,
            rationale: it.proposed?.rationale ?? opt.defaultReason, alternativesConsidered: it.proposed?.alternativesConsidered ?? [],
            overruled: it.overruled, overruleReason: it.overruleReason, truncated: false,
          },
          followUp: null, createdAt: new Date().toISOString(),
        };
        const sealed = sealRecord(record, action);
        // 1. Persist BEFORE committing — the exact bytes must exist before the hash is on-chain.
        await persistDecision({
          entityId: entity.id, cycleId, seq, decisionId, kind, obligationId: r.obligation_id, sealed,
          planner: { proposed: it.proposed ?? null, overruled: it.overruled, overruleReason: it.overruleReason }, followUp: null,
          scenario: trigger.startsWith("scenario"),
        });
        seq++;
        const row = (await q<DecisionRow>("select * from decisions where decision_id = $1", [decisionId]))[0]!;
        rows.push(row);
        // Reflect the plan in the obligation row so the next cycle sees "no change".
        if (kind === "SCHEDULE") await q("update obligations set status = 'scheduled', planned_pay_date = $2 where obligation_id = $1", [r.obligation_id, it.final.plannedDate]);
        else if (kind === "HOLD") await q("update obligations set status = 'held' where obligation_id = $1", [r.obligation_id]);
      }

      await step("commit", async () => { if (!effectiveDry) for (const row of rows) await commitDecision(row); });
      if (!effectiveDry) {
        await step("execute", async () => {
          for (const row of rows) {
            if (!ONCHAIN_KINDS.has(row.kind as DecisionKind)) continue;
            const fresh = (await q<DecisionRow>("select * from decisions where decision_id = $1", [row.decision_id]))[0]!;
            await executeDecision(fresh);
          }
        });
        await step("reveal", async () => {
          if (w.SKIP_REVEAL) { log.warn("SKIP_REVEAL set — withholding reveals (scenario S13 only)"); return; }
          for (const row of rows) {
            const fresh = (await q<DecisionRow>("select * from decisions where decision_id = $1", [row.decision_id]))[0]!;
            await revealDecision(fresh);
          }
        });
      }
      // Follow-ups and housekeeping never block settlement: they run after the cycle's own commit/execute/reveal.
      await step("escalations", async () => {
        await expireEscalations();
        await notifyPendingEscalations({
          telegramToken: w.TELEGRAM_BOT_TOKEN, telegramChatId: w.TELEGRAM_CHAT_ID, frontendUrl: w.FRONTEND_URL,
          tokenSymbol: (addr) => (addr.toLowerCase() === net(snap.network).tokens.EURC.toLowerCase() ? "EURC" : "USDC"),
        });
      });
      await step("followups", () => relayPending(w.RELAYER_PK));
      await step("metrics", () => snapshotMetrics(snap.network, snap));
      return await finish("done");
    } catch (e) {
      if (e instanceof OperatorHalt) { log.error({ reason: e.message }, "operator halted"); return await finish("failed", `halt: ${e.message}`); }
      log.error({ err: String(e) }, "cycle failed");
      return await finish("failed", String(e));
    }
  });
  return out === "locked" ? ({ status: "skipped" as const, reason: "another cycle holds the lock" }) : out;
}

function isStateChange(it: ValidatedObligation, r: ObRow): boolean {
  switch (it.final.choice) {
    case "PAY_NOW":
    case "PAY_EARLY": return true;
    case "SCHEDULE": return r.status !== "scheduled" || r.planned_pay_date !== it.final.plannedDate;
    case "HOLD": return r.status !== "held";
  }
}

function buildPayAction(r: ObRow, it: ValidatedObligation, snap: Snapshot): Action {
  const tokenAddr = net(snap.network).tokens[r.token] as `0x${string}`;
  return {
    kind: KIND.PAY, obligationId: r.obligation_id as Hex, payeeId: r.payee_id as Hex, token: tokenAddr,
    amount: it.final.amount, maxFee: 0n, evidenceHash: (r.evidence_hash ?? "0x" + "0".repeat(64)) as Hex,
  };
}

async function toObligationInput(r: ObRow, snap: Snapshot): Promise<ObligationInput> {
  const budget = snap.budgets.find((b) => b.category === r.category && b.token === r.token) ?? null;
  let payable: ObligationInput["payable"] = { ok: true };
  if (r.payee_status === "suspended") payable = { ok: false, reason: "suspended" };
  else if (r.payee_status !== "active") payable = { ok: false, reason: "not_active" };
  else if (r.risk_tier === "high" || r.risk_tier === "blocked") payable = { ok: false, reason: "risk_hold" };
  else {
    const ok = (await pub.readContract({ address: TREASURY, abi: treasuryAbi, functionName: "isPayable", args: [r.payee_id as Hex] })) as boolean;
    if (!ok) payable = { ok: false, reason: "cooling_down" };
    else if (budget?.requiresEvidence && !r.evidence_hash) payable = { ok: false, reason: "risk_hold" }; // contract would revert EvidenceRequired
  }
  return {
    obligationId: r.obligation_id, payeeName: r.payee_name, category: r.category, token: r.token, amount: BigInt(r.amount),
    dueDate: dateStr(r.due_date)!, invoiceDate: dateStr(r.invoice_date), criticality: r.criticality, terms: r.terms ?? null, payable,
    scorecard: Number(r.scorecard?.score ?? 50), budget: budget ? { remaining: BigInt(budget.remaining), approvalLimit: BigInt(budget.perTxApprovalLimit) } : null,
    payeeCap: BigInt(r.per_tx_cap),
  };
}

async function loadForecastInputs(entityId: string, day: string, startingCash: bigint): Promise<ForecastInputs> {
  const subs = await q<{ next_due: string; interval_days: number; amount: string }>(
    "select next_due::text, interval_days, amount::text from subscriptions where entity_id = $1 and active", [entityId]);
  const recvs = await q<{ due_date: string; amount_due: string; amount_paid: string; avg_days_late: string }>(
    `select r.due_date::text, r.amount_due::text, r.amount_paid::text, c.avg_days_late::text from receivables r join customers c on c.id = r.customer_id
     where r.entity_id = $1 and r.status in ('open','partial')`, [entityId]);
  const addD = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  return {
    today: day, startingCash, obligations: [],
    subscriptions: subs.map((s) => ({ nextDue: s.next_due, intervalDays: s.interval_days, amount: BigInt(s.amount) })),
    receivables: recvs.map((r) => ({ expectedDate: addD(r.due_date, Math.ceil(Number(r.avg_days_late))), outstanding: BigInt(r.amount_due) - BigInt(r.amount_paid) })),
  };
}
