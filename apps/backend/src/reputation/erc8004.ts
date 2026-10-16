// Phase 39.2 — ERC-8004 identity and reputation (Arc TESTNET only: mainnet addresses are not verified, so this is off there).
// Call shapes were verified live in the v1 broker (register / giveFeedback / getClients / getSummary on the real registries).
// Two rules from the standard: an agent cannot rate itself (feedback comes from the separate VALIDATOR wallet), and
// getSummary REVERTS on an empty client list, so always read getClients first.
import { keccak256, parseAbi, toBytes } from "viem";
import { net } from "@athena/shared/addresses";
import { commonCfg } from "../config.js";
import { q } from "../db.js";
import { log } from "../log.js";
import { pub } from "../chain/readClient.js";
import { validatorWallet } from "../chain/clients.js";
import { send } from "../chain/tx.js";

const identityAbi = parseAbi(["function register(string calldata metadataURI) external returns (uint256 tokenId)"]);
const reputationAbi = parseAbi([
  "function giveFeedback(uint256 agentId, int128 score, uint8 feedbackType, string calldata tag, string calldata metadataURI, string calldata evidenceURI, string calldata comment, bytes32 feedbackHash) external",
  "function getClients(uint256 agentId) external view returns (address[])",
  "function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) external view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)",
]);

const registries = () => {
  const r = net(commonCfg.NETWORK).erc8004;
  if (!r) throw new Error("ERC-8004 is not verified for this network (erc8004 is null in addresses.json) — reputation posting is disabled");
  return r as { identityRegistry: `0x${string}`; reputationRegistry: `0x${string}` };
};

import { scoreFromAgreementBps } from "./scorecard.js";
export { scoreFromAgreementBps };

export async function registerAgentMetadata(args: { send: typeof send; wallet: NonNullable<typeof validatorWallet>; name: string; description: string; treasury: string }): Promise<{ hash: `0x${string}`; tokenId: bigint }> {
  const meta = JSON.stringify({ name: args.name, description: args.description, agent_type: "treasury-operator", treasury: args.treasury, version: "1.0.0" });
  const { hash, logs } = await args.send({
    wallet: args.wallet, address: registries().identityRegistry, abi: identityAbi, functionName: "register",
    args: [`data:application/json,${encodeURIComponent(meta)}`], label: "ERC-8004 register",
  });
  // tokenId is the ERC-721 Transfer(from=0, to, tokenId) log's 4th topic
  const t = (logs as Array<{ address: string; topics: string[] }>).find((l) => l.address.toLowerCase() === registries().identityRegistry.toLowerCase() && l.topics[1] === `0x${"0".repeat(64)}`);
  if (!t?.topics[3]) throw new Error(`could not find the ERC-721 Transfer log in ${hash}`);
  return { hash, tokenId: BigInt(t.topics[3]) };
}

/** Once per UTC day: post Athena's human-agreement rate about the OPERATOR agent, from the validator wallet. */
export async function postDailyFeedback(args: { agentId: string | undefined; agreementBps: number | null }): Promise<string | null> {
  if (!args.agentId || !validatorWallet) return null;
  const score = scoreFromAgreementBps(args.agreementBps);
  if (score === null) return null;
  const day = new Date().toISOString().slice(0, 10);
  const done = await q("select 1 from reputation_posts where day = $1 and subject = 'operator'", [day]);
  if (done.length > 0) return null;

  const evidenceURI = `${net(commonCfg.NETWORK).explorer}/address/${process.env.TREASURY_ADDRESS}`;
  const obj = JSON.stringify({ agentId: args.agentId, score, tag: "treasury", day, evidenceURI });
  const { hash } = await send({
    wallet: validatorWallet, address: registries().reputationRegistry, abi: reputationAbi, functionName: "giveFeedback",
    args: [BigInt(args.agentId), BigInt(score), 1, "treasury", `data:application/json,${encodeURIComponent(obj)}`, evidenceURI, `Human decision agreement ${args.agreementBps} bps`, keccak256(toBytes(obj))],
    label: "ERC-8004 feedback",
  });
  await q("insert into reputation_posts(day, subject, score, tx) values ($1,'operator',$2,$3)", [day, score, hash]);
  log.info({ day, score, hash }, "posted daily ERC-8004 feedback");
  return hash;
}

/** Reads an agent's on-chain summary (two-step: clients first). */
export async function readSummary(agentId: bigint): Promise<{ count: number; average: number | null }> {
  const reg = registries().reputationRegistry;
  const clients = (await pub.readContract({ address: reg, abi: reputationAbi, functionName: "getClients", args: [agentId] })) as readonly `0x${string}`[];
  if (clients.length === 0) return { count: 0, average: null };
  const [count, value] = (await pub.readContract({ address: reg, abi: reputationAbi, functionName: "getSummary", args: [agentId, [...clients], "", ""] })) as [bigint, bigint, number];
  return { count: Number(count), average: count === 0n ? null : Number(value) };
}
