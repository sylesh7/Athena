// Phases 28.3 + 29 — commit, execute, reveal, and crash recovery. The operator never drifts into audit arrears:
// reveals go out within seconds of resolution, and recoverDecisions() runs at worker start and every cycle.
import type { Hex } from "viem";
import { q } from "../db.js";
import { log } from "../log.js";
import { operatorWallet } from "../chain/clients.js";
import { DecisionState, pub, readDecision } from "../chain/readClient.js";
import { Reverted, sendTreasury } from "../chain/tx.js";
import { deserializeAction, type SealedDecision, type SerializedAction } from "./record.js";

export interface DecisionRow {
  decision_id: string;
  kind: string;
  state: string;
  action: SerializedAction | null;
  action_hash: string;
  record_bytes: string;
  decision_hash: string;
  revealed: boolean;
  obligation_id: string | null;
  follow_up: unknown;
  created_at: Date;
}

/** Persist BEFORE committing: the exact bytes must exist in the DB before the hash is on-chain. */
export async function persistDecision(args: {
  entityId: string; cycleId: string; seq: number; decisionId: Hex; kind: string; obligationId: string | null;
  sealed: SealedDecision; planner: { proposed: unknown; overruled: boolean; overruleReason: string | null };
  followUp: unknown | null; scenario?: boolean;
}): Promise<void> {
  const { sealed } = args;
  await q(
    `insert into decisions(entity_id, cycle_id, decision_id, seq, kind, obligation_id, action, action_hash,
       record_json, record_bytes, decision_hash, planner_proposed, planner_overruled, overrule_reason, follow_up, scenario, state)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'recorded')`,
    [
      args.entityId, args.cycleId, args.decisionId, args.seq, args.kind, args.obligationId,
      sealed.record.action, sealed.actionHash, sealed.canon.json, sealed.canon.bytes, sealed.canon.sha256,
      JSON.stringify(args.planner.proposed ?? null), args.planner.overruled, args.planner.overruleReason,
      args.followUp === null ? null : JSON.stringify(args.followUp), args.scenario ?? false,
    ],
  );
}

export async function commitDecision(d: DecisionRow): Promise<void> {
  const { hash } = await sendTreasury(operatorWallet, "commit", [d.decision_id, d.decision_hash, d.action_hash], `commit ${d.kind}`);
  await q("update decisions set state = $2, commit_tx = $3 where decision_id = $1",
    [d.decision_id, /^0x0{64}$/.test(d.action_hash) ? "noop" : "committed", hash]);
}

async function waitForBlockAfter(block: bigint): Promise<void> {
  while ((await pub.getBlockNumber({ cacheTime: 0 })) <= block) await new Promise((r) => setTimeout(r, 500));
}

export type ExecOutcome = "executed" | "escalated" | "cancelled" | "synced";

/** Execute exactly what was committed. A network error leaves it Committed; recovery re-reads the chain. */
export async function executeDecision(d: DecisionRow): Promise<ExecOutcome> {
  if (!d.action) throw new Error(`decision ${d.decision_id} has no action to execute`);
  const onchain = await readDecision(d.decision_id as Hex);
  if (onchain.state !== DecisionState.Committed) { await syncFromChain(d, onchain.state); return "synced"; }

  await waitForBlockAfter(onchain.committedBlock);
  try {
    const { hash, logs } = await sendTreasury(operatorWallet, "execute", [d.decision_id, deserializeAction(d.action)], `execute ${d.kind}`);
    const after = await readDecision(d.decision_id as Hex);
    const escalated = after.state === DecisionState.Escalated;
    await q("update decisions set state = $2, execute_tx = $3 where decision_id = $1", [d.decision_id, escalated ? "escalated" : "executed", hash]);
    void logs;
    return escalated ? "escalated" : "executed";
  } catch (e) {
    if (e instanceof Reverted) return handleRevert(d, e);
    throw e;
  }
}

async function cancelDecision(d: DecisionRow): Promise<void> {
  await sendTreasury(operatorWallet, "cancel", [d.decision_id], `cancel ${d.kind}`);
  await q("update decisions set state = 'cancelled' where decision_id = $1", [d.decision_id]);
  if (d.obligation_id) await q("update obligations set status = 'open' where obligation_id = $1 and status in ('scheduled','escalated')", [d.obligation_id]);
}

export class OperatorHalt extends Error {}

async function handleRevert(d: DecisionRow, e: Reverted): Promise<ExecOutcome> {
  log.warn({ decisionId: d.decision_id, error: e.errorName }, "execute reverted");
  switch (e.errorName) {
    case "AlreadySettled":
    case "PayeeCoolingDown":
    case "PayeeNotActive":
    case "InsufficientFunds":
    case "EvidenceRequired":
    case "TokenMismatch":
    case "FeeTooHigh":
      await cancelDecision(d); // stale or infeasible: cancel, still reveal, next cycle re-plans
      return "cancelled";
    case "ActionMismatch":
      // Bug: the stored action differs from the committed one. Stop the operator until a human looks.
      log.error({ decisionId: d.decision_id }, "P1: ActionMismatch — stopping operator");
      throw new OperatorHalt("ActionMismatch");
    case "AuditInArrears":
      await recoverDecisions();
      throw new OperatorHalt("AuditInArrears");
    case "EnforcedPause":
      throw new OperatorHalt("paused");
    default:
      throw e;
  }
}

export async function revealDecision(d: DecisionRow): Promise<void> {
  const onchain = await readDecision(d.decision_id as Hex);
  if (onchain.revealed) { await q("update decisions set revealed = true where decision_id = $1", [d.decision_id]); return; }
  if (onchain.state === DecisionState.None || onchain.state === DecisionState.Committed) return; // not revealable yet
  // Always reveal the stored bytes verbatim, never re-serialized JSON.
  const { hash } = await sendTreasury(operatorWallet, "reveal", [d.decision_id, d.record_bytes], "reveal");
  await q("update decisions set revealed = true, reveal_tx = $2 where decision_id = $1", [d.decision_id, hash]);
}

async function syncFromChain(d: DecisionRow, state: number): Promise<void> {
  const map: Record<number, string> = {
    [DecisionState.Executed]: "executed", [DecisionState.Escalated]: "escalated", [DecisionState.Approved]: "approved",
    [DecisionState.Rejected]: "rejected", [DecisionState.Cancelled]: "cancelled", [DecisionState.NoOp]: "noop",
  };
  if (map[state]) await q("update decisions set state = $2 where decision_id = $1", [d.decision_id, map[state]]);
}

const isStillCurrent = async (d: DecisionRow): Promise<boolean> => {
  if (Date.now() - new Date(d.created_at).getTime() > 30 * 60_000) return false;
  if (!d.obligation_id) return true;
  const o = await q<{ status: string }>("select status from obligations where obligation_id = $1", [d.obligation_id]);
  return o[0]?.status !== "paid" && o[0]?.status !== "cancelled";
};

/** Runs at worker start and at the start of every cycle: finish or cancel half-done work, reveal everything resolved. */
export async function recoverDecisions(): Promise<void> {
  const rows = await q<DecisionRow>(
    "select * from decisions where revealed = false and state not in ('failed') order by seq",
  );
  for (const d of rows) {
    const c = await readDecision(d.decision_id as Hex);
    switch (c.state) {
      case DecisionState.None: {
        // Recorded but never committed (crash between persist and commit). Nothing on-chain: drop after a grace period.
        if (Date.now() - new Date(d.created_at).getTime() > 10 * 60_000) {
          await q("update decisions set state = 'failed' where decision_id = $1", [d.decision_id]);
        }
        break;
      }
      case DecisionState.Committed:
        if (await isStillCurrent(d)) await executeDecision(d);
        else await cancelDecision(d);
        await revealDecision(d);
        break;
      default:
        await syncFromChain(d, c.state);
        await revealDecision(d);
    }
  }
}
