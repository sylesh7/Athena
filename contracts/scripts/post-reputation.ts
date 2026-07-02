/**
 * post-reputation.ts
 *
 * Calls ERC-8004 ReputationRegistry.giveFeedback() after a stream resolves.
 * Must be called from a SEPARATE validator wallet — owner cannot give feedback
 * for their own agent (ERC-8004 anti-self-dealing rule).
 *
 * Usage:
 *   VALIDATOR_PK=0x... npm run reputation
 *
 * Set env vars before running:
 *   AGENT_ID=1                          # ERC-8004 tokenId of the agent being rated
 *   SCORE=85                            # 0-100 integer (85 = 0.85 prediction accuracy)
 *   TAG=routing                         # Short label
 *   COMMENT="Stream completed, prediction accurate within 5%"
 *   EVIDENCE_TX=0x...                   # Arcscan tx hash of the reveal transaction
 */

import { createWalletClient, createPublicClient, http, parseAbi, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { keccak256, toBytes, encodePacked } from "viem";

const arcTestnet = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
  blockExplorers: { default: { name: "Arcscan", url: "https://testnet.arcscan.app" } },
} as const;

const REPUTATION_REGISTRY = "0x8004B663056A597Dffe9eCcC1965A193B7388713" as Address;

// NOTE: score is int128, not uint8 — use the exact ABI type
const reputationAbi = parseAbi([
  "function giveFeedback(uint256 agentId, int128 score, uint8 feedbackType, string calldata tag, string calldata metadataURI, string calldata evidenceURI, string calldata comment, bytes32 feedbackHash) external",
  "function readAllFeedback(uint256 agentId) external view returns (bytes memory)",
]);

async function main() {
  const validatorPk = process.env.VALIDATOR_PK as `0x${string}`;
  if (!validatorPk) throw new Error("VALIDATOR_PK not set");

  const agentId   = BigInt(process.env.AGENT_ID   ?? "1");
  const score     = BigInt(process.env.SCORE       ?? "85"); // 0–100
  const tag       = process.env.TAG       ?? "routing";
  const comment   = process.env.COMMENT   ?? "Stream completed";
  const evidenceTx = process.env.EVIDENCE_TX ?? "";

  const evidenceURI = evidenceTx
    ? `https://testnet.arcscan.app/tx/${evidenceTx}`
    : "";

  // Canonical feedback JSON — hash this for integrity
  const feedbackObj = JSON.stringify({
    agentId: agentId.toString(),
    score: score.toString(),
    tag,
    comment,
    evidenceURI,
    timestamp: Date.now(),
  });

  const feedbackHash = keccak256(toBytes(feedbackObj));

  const metadataURI = `data:application/json,${encodeURIComponent(feedbackObj)}`;

  const account = privateKeyToAccount(validatorPk);
  const walletClient = createWalletClient({
    account,
    chain: arcTestnet as any,
    transport: http(),
  });
  const publicClient = createPublicClient({
    chain: arcTestnet as any,
    transport: http(),
  });

  console.log("=== Post Reputation Feedback ===");
  console.log("Validator:", account.address);
  console.log("AgentId:  ", agentId.toString());
  console.log("Score:    ", score.toString(), "/ 100");
  console.log("Tag:      ", tag);
  console.log("Comment:  ", comment);
  console.log("");

  const txHash = await walletClient.writeContract({
    address: REPUTATION_REGISTRY,
    abi: reputationAbi,
    functionName: "giveFeedback",
    args: [
      agentId,
      score as unknown as bigint, // int128
      1,                          // feedbackType: 1 = quality review
      tag,
      metadataURI,
      evidenceURI,
      comment,
      feedbackHash,
    ],
  });

  console.log("tx:", txHash);
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  console.log("✓ Reputation recorded");
  console.log("  Arcscan:", `https://testnet.arcscan.app/tx/${txHash}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
