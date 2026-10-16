// Spend guard around every LLM call. The worker/API run unattended, so a bug (a loop, a retry storm, a huge invoice)
// must not be able to drain the key: each call's WORST-CASE cost is checked against a total and a daily cap, read from
// the llm_usage table, BEFORE the request is made. When a cap would be exceeded the call is refused with BudgetExceeded
// and callers fall back (planner → deterministic default plan; extraction → invoice stays queued, retried next cycle).
import { loadWorkerCfg } from "../config.js";
import { q } from "../db.js";
import { log } from "../log.js";
import { callTool, type LlmCreds, type ToolRequest } from "./tool.js";
import { checkBudget, costMicroUsd, estimateInputTokens, toMicro, usd } from "./pricing.js";

export class BudgetExceeded extends Error {}

export type Purpose = "extract" | "plan";

const priceOverride = (w: ReturnType<typeof loadWorkerCfg>) =>
  w.LLM_PRICE_IN_PER_M && w.LLM_PRICE_OUT_PER_M
    ? { in: toMicro(w.LLM_PRICE_IN_PER_M), out: toMicro(w.LLM_PRICE_OUT_PER_M) }
    : undefined;

export async function spentMicroUsd(): Promise<{ total: bigint; today: bigint }> {
  const r = (await q<{ total: string; today: string }>(
    `select coalesce(sum(cost_micro_usd),0)::text as total,
            coalesce(sum(cost_micro_usd) filter (where at >= date_trunc('day', now())),0)::text as today
     from llm_usage`))[0]!;
  return { total: BigInt(r.total), today: BigInt(r.today) };
}

export async function guardedCall(purpose: Purpose, creds: LlmCreds, req: ToolRequest): Promise<unknown> {
  const w = loadWorkerCfg();
  const override = priceOverride(w);
  const inEst = estimateInputTokens((req.system.length + (req.text?.length ?? 0)) + JSON.stringify(req.schema).length, req.pdfBase64?.length ?? 0);
  const worstCase = costMicroUsd(creds.model, inEst, req.maxTokens, override);
  const spent = await spentMicroUsd();
  const verdict = checkBudget({
    spentTotal: spent.total, spentToday: spent.today, worstCase,
    capTotal: toMicro(w.LLM_BUDGET_USD), capDaily: toMicro(w.LLM_DAILY_BUDGET_USD),
  });
  if (!verdict.ok) {
    log.warn({ purpose, model: creds.model }, `LLM call refused: ${verdict.reason}`);
    throw new BudgetExceeded(verdict.reason);
  }

  try {
    const res = await callTool(creds, req);
    const cost = costMicroUsd(creds.model, res.inputTokens, res.outputTokens, override);
    await q("insert into llm_usage(provider, model, purpose, input_tokens, output_tokens, cost_micro_usd, ok) values ($1,$2,$3,$4,$5,$6,true)",
      [creds.provider, creds.model, purpose, res.inputTokens, res.outputTokens, cost.toString()]);
    log.info({ purpose, model: creds.model, inputTokens: res.inputTokens, outputTokens: res.outputTokens, cost: usd(cost), totalSpent: usd(spent.total + cost) }, "llm call");
    return res.output;
  } catch (err) {
    // A failed call may still have been billed (e.g. a timeout after generation). Count the worst case it could have cost
    // so repeated failures can never evade the cap.
    await q("insert into llm_usage(provider, model, purpose, input_tokens, output_tokens, cost_micro_usd, ok) values ($1,$2,$3,$4,$5,$6,false)",
      [creds.provider, creds.model, purpose, inEst, 0, costMicroUsd(creds.model, inEst, 0, override).toString()]);
    throw err;
  }
}
