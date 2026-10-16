// Phase 38 — the keeper's check, separated from env/process wiring so it can be tested. Reads only the chain.
import { parseAbiItem, type Abi, type Address, type PublicClient, type WalletClient } from "viem";

const committed = parseAbiItem("event DecisionCommitted(bytes32 indexed decisionId, bytes32 decisionHash, bytes32 actionHash, uint64 blockNumber)");
const COMMITTED_STATE = 1;

export interface KeeperDeps {
  pub: PublicClient;
  wallet: WalletClient;
  treasury: Address;
  abi: Abi;
  deployBlock: bigint;
  onFlag?: (decisionId: `0x${string}`, hash: `0x${string}`) => void;
  onError?: (decisionId: `0x${string}`, err: unknown) => void;
}

/** Flags every decision whose record is past the reveal deadline. Returns the ids it flagged. */
export async function flagOverdueOnce(d: KeeperDeps): Promise<`0x${string}`[]> {
  const head = await d.pub.getBlockNumber({ cacheTime: 0 });
  const deadline = (await d.pub.readContract({ address: d.treasury, abi: d.abi, functionName: "revealDeadlineBlocks" })) as bigint;
  // Look back 3 deadlines: anything older than that was either flagged long ago or revealed.
  const since = head > deadline * 3n ? head - deadline * 3n : d.deployBlock;
  const from = since > d.deployBlock ? since : d.deployBlock;
  const flagged: `0x${string}`[] = [];

  for (let start = from; start <= head; start += 2_000n) {
    const end = start + 1_999n > head ? head : start + 1_999n;
    const logs = await d.pub.getLogs({ address: d.treasury, event: committed, fromBlock: start, toBlock: end });
    for (const l of logs) {
      const id = l.args.decisionId!;
      const dec = (await d.pub.readContract({ address: d.treasury, abi: d.abi, functionName: "getDecision", args: [id] })) as {
        state: number; revealed: boolean; flaggedOverdue: boolean; committedBlock: bigint; resolvedBlock: bigint;
      };
      if (dec.revealed || dec.flaggedOverdue) continue;
      const anchor = dec.state === COMMITTED_STATE ? dec.committedBlock : dec.resolvedBlock;
      if (anchor !== 0n && head > anchor + deadline) {
        try {
          const { request } = await d.pub.simulateContract({ account: d.wallet.account!, address: d.treasury, abi: d.abi, functionName: "flagOverdue", args: [id] });
          const hash = await d.wallet.writeContract(request);
          await d.pub.waitForTransactionReceipt({ hash });
          flagged.push(id);
          d.onFlag?.(id, hash);
        } catch (err) {
          d.onError?.(id, err);
        }
      }
    }
  }
  return flagged;
}
