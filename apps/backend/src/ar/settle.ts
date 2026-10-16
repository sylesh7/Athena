// Phase 35.3 — settle x402 receipts on-chain. x402 payments are credited to the collections wallet's Gateway balance
// (batched). To keep the rule "every inflow names its receivable" we (1) withdraw the credit to the collections wallet on Arc,
// then (2) approve + payReceivable(receivableId, amount). A receivable is marked paid only when the indexer sees
// ReceivablePaid — never because the HTTP request succeeded.
//
// State machine per receipt (idempotent across crashes): pending → withdrawn → settled. A failure at either step leaves the
// receipt where it was (with the error recorded) so the next tick resumes there; it never withdraws twice.
import { parseAbi } from "viem";
import { formatAmount } from "@athena/shared/money";
import { net } from "@athena/shared/addresses";
import { commonCfg } from "../config.js";
import { q } from "../db.js";
import { log } from "../log.js";
import { collectionsWallet } from "../chain/clients.js";
import { pub, treasuryAbi, TREASURY } from "../chain/readClient.js";
import { send, sendTreasury } from "../chain/tx.js";
import { safeWithdraw } from "../gateway/safeWithdraw.js";

interface Receipt { id: number; receivable_id: string; amount: string; status: "pending" | "withdrawn" }

const erc20 = parseAbi(["function approve(address,uint256) returns (bool)"]);

export async function settleX402Receipts(collectionsPk: string | undefined): Promise<number> {
  if (!collectionsPk || !collectionsWallet) return 0;
  const usdc = net(commonCfg.NETWORK).tokens.USDC as `0x${string}`;
  const rows = await q<Receipt>("select id, receivable_id, amount::text, status from x402_receipts where status in ('pending','withdrawn') order by id limit 5");
  let settled = 0;
  for (const r of rows) {
    try {
      // How much the contract will still accept: never overpay (the contract would revert Overpayment anyway).
      const rec = (await pub.readContract({ address: TREASURY, abi: treasuryAbi, functionName: "getReceivable", args: [r.receivable_id] })) as { amountDue: bigint; amountPaid: bigint; exists: boolean };
      const outstanding = rec.exists ? rec.amountDue - rec.amountPaid : 0n;
      const amount = BigInt(r.amount) < outstanding ? BigInt(r.amount) : outstanding;
      if (amount === 0n) {
        await q("update x402_receipts set status = 'failed', error = $2, updated_at = now() where id = $1", [r.id, "receivable already fully paid (or unknown) — credit left in the collections wallet for a human"]);
        continue;
      }

      if (r.status === "pending") {
        // Crash-safe same-chain withdraw to the collections wallet itself (attestation persisted before minting).
        const w = await safeWithdraw({ pk: collectionsPk, amount: BigInt(r.amount), recipient: collectionsWallet.account!.address, purpose: "x402_settle" });
        // Burned = done, even if the mint hasn't landed: the attestation is saved and retryPendingMints() finishes it. Marking the
        // receipt 'withdrawn' now means a retry NEVER burns a second time; payReceivable below simply waits for the funds.
        await q("update x402_receipts set status = 'withdrawn', withdraw_tx = $2, error = $3, updated_at = now() where id = $1", [r.id, w.mintTx ?? null, w.minted ? null : `mint pending (gateway_transfers #${w.transferId})`]);
      }
      await send({ wallet: collectionsWallet, address: usdc, abi: erc20, functionName: "approve", args: [TREASURY, amount], label: "approve x402 settle" });
      const { hash } = await sendTreasury(collectionsWallet, "payReceivable", [r.receivable_id, amount], "payReceivable (x402)");
      await q("update x402_receipts set status = 'settled', settle_tx = $2, error = null, updated_at = now() where id = $1", [r.id, hash]);
      settled++;
    } catch (err) {
      log.error({ receiptId: r.id, err: String(err) }, "x402 settlement step failed — will resume next tick");
      await q("update x402_receipts set error = $2, updated_at = now() where id = $1", [r.id, String(err).slice(0, 300)]);
    }
  }
  return settled;
}
