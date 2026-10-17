import { parseAbi } from "viem";
import { getTreasuryAddress } from "@/lib/api";

// Only the functions the browser calls. Everything else is the worker's job. Signatures match AthenaTreasury.sol.
export const treasuryAbi = parseAbi([
  "function approveEscalation(bytes32 decisionId)",
  "function rejectEscalation(bytes32 decisionId)",
  "function approvePayee(bytes32 payeeId)",
  "function rejectPayee(bytes32 payeeId)",
  "function suspendPayee(bytes32 payeeId)",
  "function payReceivable(bytes32 receivableId, uint256 amount)",
]);
export const erc20Abi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);
export const TOKEN_ADDRESS = {
  USDC: "0x3600000000000000000000000000000000000000",
  EURC: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
} as const;

let cached: Promise<`0x${string}`> | null = null;
export const treasuryAddress = () => (cached ??= getTreasuryAddress());

/** Short, human message for a wallet/contract error (custom errors show as their name). */
export function errorText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  const named = m.match(/reverted with the following (?:reason|signature)?:?\s*([A-Za-z0-9_()]+)/i) ?? m.match(/\b([A-Z][A-Za-z]+)\(0x[0-9a-f]+\)/);
  if (/user rejected|denied/i.test(m)) return "Rejected in wallet.";
  return named ? `Contract refused: ${named[1]}` : m.split("\n")[0]!.slice(0, 200);
}
