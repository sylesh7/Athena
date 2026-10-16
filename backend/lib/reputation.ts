/**
 * lib/reputation.ts — posts ERC-8004 reputation feedback after a stream settles.
 *
 * Must run from a separate validator wallet — ERC-8004's ReputationRegistry
 * blocks an agent's own owner from giving itself feedback (anti-self-dealing,
 * see contracts/src/interfaces/IERC8004.sol). Configure VALIDATOR_PK in
 * backend/.env.local to a wallet that is NOT the broker's or any provider's
 * own key.
 *
 * Called automatically from stream/streamLoop.ts after every settle — posts
 * feedback for both the provider (quality/latency accuracy) and the broker
 * (routing decision accuracy), matching README.md step 7: "ERC-8004
 * ReputationRegistry updated for both broker and provider." Previously this
 * logic only existed as contracts/scripts/post-reputation.ts, a fully manual
 * script nobody's automated path ever called.
 */

import { keccak256, parseAbi, toBytes } from "viem";
import { addresses } from "./config.js";
import { publicClient, walletClientFromPk } from "./chain.js";

const reputationAbi = parseAbi([
  "function giveFeedback(uint256 agentId, int128 score, uint8 feedbackType, string calldata tag, string calldata metadataURI, string calldata evidenceURI, string calldata comment, bytes32 feedbackHash) external",
]);

function findTokenIdByAddress(address: string): string | undefined {
  return Object.values(addresses.agents).find((a) => a.address.toLowerCase() === address.toLowerCase())?.tokenId;
}

interface FeedbackInput {
  agentId: string;
  score: number; // 0-100
  tag: string;
  comment: string;
  evidenceTxHash: `0x${string}`;
}

async function giveFeedback(validatorPk: `0x${string}`, input: FeedbackInput): Promise<`0x${string}`> {
  const validator = walletClientFromPk(validatorPk);
  const evidenceURI = `${addresses.explorer}/tx/${input.evidenceTxHash}`;

  // Canonical feedback JSON, hashed for on-chain integrity — same pattern as
  // the original manual post-reputation.ts script.
  const feedbackObj = JSON.stringify({
    agentId: input.agentId,
    score: input.score,
    tag: input.tag,
    comment: input.comment,
    evidenceURI,
    timestamp: Date.now(),
  });
  const feedbackHash = keccak256(toBytes(feedbackObj));
  const metadataURI = `data:application/json,${encodeURIComponent(feedbackObj)}`;

  const txHash = await validator.writeContract({
    address: addresses.contracts.erc8004Reputation as `0x${string}`,
    abi: reputationAbi,
    functionName: "giveFeedback",
    args: [
      BigInt(input.agentId),
      BigInt(input.score), // int128 — score is always non-negative here (0-100)
      1, // feedbackType: 1 = quality review
      input.tag,
      metadataURI,
      evidenceURI,
      input.comment,
      feedbackHash,
    ],
  });
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return txHash;
}

export interface PostStreamReputationInput {
  brokerAddress: string;
  providerAddress: string;
  predictionMet: boolean;
  avgQualityScore: number | null; // average across callHistory; null if zero calls completed
  revealTxHash: `0x${string}`;
}

/**
 * Fire-and-forget from streamLoop.ts — a reputation-posting failure should
 * never block or delay the stream's own on-chain settlement (same convention
 * as the existing CCTP payout hook). Logs loudly on failure or missing
 * config rather than throwing.
 */
export async function postStreamReputation(input: PostStreamReputationInput): Promise<void> {
  const validatorPk = process.env.VALIDATOR_PK as `0x${string}` | undefined;
  if (!validatorPk) {
    console.warn(
      "VALIDATOR_PK not set — skipping ERC-8004 reputation feedback (README.md step 7: " +
        '"ReputationRegistry updated for both broker and provider"). Set VALIDATOR_PK in ' +
        "backend/.env.local to a wallet that is NOT the broker's or any provider's own key " +
        "(ERC-8004 blocks an agent from rating itself)."
    );
    return;
  }

  const providerTokenId = findTokenIdByAddress(input.providerAddress);
  const brokerTokenId = findTokenIdByAddress(input.brokerAddress);
  if (!providerTokenId || !brokerTokenId) {
    console.error(
      `Could not resolve ERC-8004 tokenId for broker (${input.brokerAddress}) or provider ` +
        `(${input.providerAddress}) from shared/addresses.json's agents section — skipping feedback.`
    );
    return;
  }

  // Prefer the real observed average quality across the stream's actual
  // calls (a genuine 0-100 accuracy signal) over a flat binary; fall back to
  // a simple predictionMet-based score only if zero calls ever completed.
  const score =
    input.avgQualityScore !== null
      ? Math.max(0, Math.min(100, Math.round(input.avgQualityScore * 100)))
      : input.predictionMet
        ? 100
        : 0;
  const outcome = input.predictionMet ? "prediction met" : "prediction failed, bond slashed";

  try {
    const providerTx = await giveFeedback(validatorPk, {
      agentId: providerTokenId,
      score,
      tag: "quality",
      comment: `Stream settled — ${outcome}. Provider avg quality this stream: ${input.avgQualityScore?.toFixed(2) ?? "n/a (no calls completed)"}.`,
      evidenceTxHash: input.revealTxHash,
    });
    console.log(`ERC-8004 feedback posted for provider (tokenId ${providerTokenId}): ${providerTx}`);
  } catch (err) {
    console.error(`Failed to post ERC-8004 feedback for provider (tokenId ${providerTokenId}):`, err);
  }

  try {
    const brokerTx = await giveFeedback(validatorPk, {
      agentId: brokerTokenId,
      score,
      tag: "routing",
      comment: `Stream settled — ${outcome}. Broker's routing decision and prediction accuracy for this stream.`,
      evidenceTxHash: input.revealTxHash,
    });
    console.log(`ERC-8004 feedback posted for broker (tokenId ${brokerTokenId}): ${brokerTx}`);
  } catch (err) {
    console.error(`Failed to post ERC-8004 feedback for broker (tokenId ${brokerTokenId}):`, err);
  }
}
