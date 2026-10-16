// Read-only chain access. Safe to import from the API process (holds no keys).
import { createPublicClient, fallback, http, type Abi } from "viem";
import { chainFor } from "@athena/shared/chains";
import treasuryAbiJson from "@athena/shared/abis/AthenaTreasury.json" with { type: "json" };
import { commonCfg } from "../config.js";

export const chain = chainFor(commonCfg.NETWORK);
export const treasuryAbi = treasuryAbiJson as Abi;
export const TREASURY = commonCfg.TREASURY_ADDRESS as `0x${string}`;

// viem's http transport has no timeout by default; an unresponsive RPC would hang the operator.
export const transport = fallback([
  http(commonCfg.RPC_URL, { timeout: 10_000, retryCount: 2 }),
  http(commonCfg.RPC_URL_FALLBACK, { timeout: 10_000, retryCount: 2 }),
]);

export const pub = createPublicClient({ chain, transport });

export const DecisionState = {
  None: 0, Committed: 1, Executed: 2, Escalated: 3, Approved: 4, Rejected: 5, Cancelled: 6, NoOp: 7,
} as const;

export interface OnchainDecision {
  decisionHash: `0x${string}`;
  actionHash: `0x${string}`;
  committedBlock: bigint;
  resolvedBlock: bigint;
  state: number;
  revealed: boolean;
  flaggedOverdue: boolean;
}

export async function readDecision(id: `0x${string}`, blockNumber?: bigint): Promise<OnchainDecision> {
  return (await pub.readContract({
    address: TREASURY, abi: treasuryAbi, functionName: "getDecision", args: [id],
    ...(blockNumber !== undefined ? { blockNumber } : {}),
  })) as OnchainDecision;
}
