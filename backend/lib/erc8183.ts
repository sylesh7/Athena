/**
 * lib/erc8183.ts — wires Athena's broker into the real ERC-8183 job escrow
 * lifecycle for every live stream (README.md step 3/6, BACKEND_A_README.md
 * Phase 2.4).
 *
 * Previously skipped entirely in the automated path (erc8183JobId always
 * bytes32(0), see PENDING.md High #1) on the assumption that it couldn't be
 * done: setBudget()/submit() are provider-role calls, and Athena's provider
 * wallets are Circle Developer-Controlled Wallets with no exposed raw
 * private key. That assumption was wrong — Circle's own Transaction API
 * (`createContractExecutionTransaction`) lets a DCW sign *any* contract call
 * server-side, without ever exposing a key. wallets/registerCircleProviders.ts
 * already proves this pattern works, for a different contract
 * (IdentityRegistry.register). This module does the same thing for
 * IERC8183's provider-role functions.
 *
 * Roles in this flow (see contracts/src/interfaces/IERC8183.sol):
 *   client    — createJob(), fund()      — the broker, via its own raw key
 *               (it already fronts the AthenaCommit bond the same way)
 *   provider  — setBudget(), submit()    — via Circle's Transaction API
 *   evaluator — complete()/reject()      — AthenaCommit itself, called
 *               automatically inside reveal()'s _settleERC8183 — already
 *               correct, nothing to change there.
 */

import { createRequire } from "node:module";
import { decodeEventLog, numberToHex, parseAbi, type Hex } from "viem";
import { addresses } from "./config.js";
import { publicClient, walletClientFromPk } from "./chain.js";

const require = createRequire(import.meta.url);
const dcw = require("@circle-fin/developer-controlled-wallets") as {
  initiateDeveloperControlledWalletsClient: (input: { apiKey: string; entitySecret: string }) => CircleClient;
};

interface CircleClient {
  createContractExecutionTransaction: (input: {
    walletId: string;
    contractAddress: string;
    abiFunctionSignature: string;
    abiParameters: unknown[];
    fee: { type: "level"; config: { feeLevel: "LOW" | "MEDIUM" | "HIGH" } };
  }) => Promise<{ data?: { id?: string } }>;
  getTransaction: (input: { id: string; waitForTxHash: true; signal?: AbortSignal }) => Promise<{
    data: { transaction: { txHash: string } };
  }>;
}

function circleClient(): CircleClient {
  const apiKey = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
  if (!apiKey || !entitySecret) {
    throw new Error(
      "CIRCLE_API_KEY/CIRCLE_ENTITY_SECRET not set — required to sign ERC-8183 provider-role calls " +
        "(setBudget/submit) via Circle's Transaction API."
    );
  }
  return dcw.initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
}

// Executes a contract call AS a Circle-custodied wallet (provider role) —
// Circle signs + broadcasts server-side; we just wait for the tx hash + receipt.
async function executeAsProviderWallet(
  walletId: string,
  contractAddress: string,
  abiFunctionSignature: string,
  abiParameters: unknown[]
): Promise<Hex> {
  const client = circleClient();
  const created = await client.createContractExecutionTransaction({
    walletId,
    contractAddress,
    abiFunctionSignature,
    abiParameters,
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });
  const txId = created.data?.id;
  if (!txId) throw new Error(`Circle did not return a transaction id for ${abiFunctionSignature}`);

  const { data } = await client.getTransaction({
    id: txId,
    waitForTxHash: true,
    signal: AbortSignal.timeout(120_000),
  });
  const txHash = data.transaction.txHash as Hex;
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return txHash;
}

function findAgentByAddress(address: string) {
  return Object.values(addresses.agents).find((a) => a.address.toLowerCase() === address.toLowerCase());
}

// ABIs below match the REAL deployed ERC-8183 (impl 0xa316…, verified on
// Arcscan 2026-07-05), NOT contracts/src/interfaces/IERC8183.sol, which was
// wrong in two ways that both surfaced live: (1) jobId is `uint256`
// everywhere, not `bytes32` — the real `JobCreated` topic
// 0xb0f0239b… decodes only against a uint256 jobId; (2) `JobCreated`'s last
// field is `address hook`, not `string description`. We keep jobId as a
// bigint internally and only convert to a zero-padded bytes32 at the
// AthenaCommit boundary (its `erc8183JobId` param is bytes32, and it casts
// `uint256(erc8183JobId)` internally — proven by Backend A's manual flow
// completing jobId 147246).
const erc8183Abi = parseAbi([
  "function createJob(address provider, address evaluator, uint256 expiredAt, string description, address hook) external returns (uint256 jobId)",
  "function setBudget(uint256 jobId, uint256 amount, bytes optParams) external",
  "function fund(uint256 jobId, bytes optParams) external",
  "function submit(uint256 jobId, bytes32 deliverableHash, bytes optParams) external",
  "event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider, address evaluator, uint256 expiredAt, address hook)",
]);

const erc20ApproveAbi = parseAbi(["function approve(address spender, uint256 amount) external returns (bool)"]);

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

export interface CreateAndFundJobInput {
  brokerPk: Hex;
  providerAddress: `0x${string}`;
  description: string;
  bondAmountUnits: bigint;
}

/**
 * Creates the ERC-8183 job (broker acts as client), has the provider set its
 * budget (via Circle's Transaction API), then broker approves + funds it.
 * Returns the real jobId to pass into AthenaCommit.commit(). Throws if the
 * provider isn't a Circle-custodied wallet with a known walletId, or if any
 * step fails — callers should catch and fall back to ZERO_BYTES32 rather
 * than let ERC-8183 setup block the core commit-reveal-bond flow, which
 * works independently of this.
 */
export async function createAndFundJob(input: CreateAndFundJobInput): Promise<Hex> {
  const erc8183 = addresses.contracts.erc8183 as `0x${string}`;
  const athenaCommit = addresses.contracts.athenaCommit as `0x${string}`;
  const usdc = addresses.contracts.usdc as `0x${string}`;
  const broker = walletClientFromPk(input.brokerPk);

  const provider = findAgentByAddress(input.providerAddress);
  if (!provider?.circleWalletId) {
    throw new Error(
      `No circleWalletId found for provider ${input.providerAddress} in shared/addresses.json — cannot call ` +
        `setBudget() as this provider (a provider-role call only Circle's Transaction API can sign for a DCW).`
    );
  }

  // expiredAt is a unix timestamp, NOT a block number — confirmed live: passing
  // `currentBlock + 100_000n` (~50.3M, block-number-scale) reverted with the
  // real contract's `ExpiryTooShort()` custom error (decoded via `cast 4byte
  // 0xf7a0748c`), because 50.3M is far less than the real block.timestamp
  // (~1.77B) — i.e. it read as already-expired. IERC8183.sol's own doc
  // comment calling this "Block number" was wrong; fixed here, not there,
  // since the interface doc doesn't affect the deployed contract's behavior.
  const nowBlock = await publicClient.getBlock();
  const expiredAt = nowBlock.timestamp + 86_400n; // 24h from now — generous, not time-critical for a demo

  // 1. Broker creates the job (client role). AthenaCommit is the evaluator,
  // so its reveal()'s automatic complete()/reject() call is authorized.
  const createTxHash = await broker.writeContract({
    address: erc8183,
    abi: erc8183Abi,
    functionName: "createJob",
    args: [input.providerAddress, athenaCommit, expiredAt, input.description, ZERO_ADDRESS],
  });
  const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createTxHash });
  const createdLog = createReceipt.logs.find((log) => log.address.toLowerCase() === erc8183.toLowerCase());
  if (!createdLog) throw new Error(`No JobCreated event found in tx ${createTxHash}`);
  const decoded = decodeEventLog({
    abi: erc8183Abi,
    data: createdLog.data,
    topics: createdLog.topics,
    eventName: "JobCreated",
  });
  const jobId = decoded.args.jobId as bigint; // real jobId is uint256, e.g. 147246

  // 2. Provider sets the budget (provider role) — signed via Circle's
  // Transaction API since this wallet has no exposed raw private key.
  await executeAsProviderWallet(provider.circleWalletId, erc8183, "setBudget(uint256,uint256,bytes)", [
    jobId.toString(),
    input.bondAmountUnits.toString(),
    "0x",
  ]);

  // 3. Broker approves + funds (client role, back to the broker's own raw key).
  const approveTxHash = await broker.writeContract({
    address: usdc,
    abi: erc20ApproveAbi,
    functionName: "approve",
    args: [erc8183, input.bondAmountUnits],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveTxHash });

  const fundTxHash = await broker.writeContract({
    address: erc8183,
    abi: erc8183Abi,
    functionName: "fund",
    args: [jobId, "0x"],
  });
  await publicClient.waitForTransactionReceipt({ hash: fundTxHash });

  // AthenaCommit.commit()'s erc8183JobId param is bytes32; hand it the uint256
  // jobId zero-padded to 32 bytes (the contract recovers it via uint256(...)).
  return numberToHex(jobId, { size: 32 });
}

/**
 * Provider submits its deliverable (provider role, via Circle's Transaction
 * API) — must happen before AthenaCommit.reveal() triggers complete()/reject(),
 * which requires the job to already be in the "Submitted" state. If this
 * throws, AthenaCommit.reveal() itself still settles safely: its
 * _settleERC8183 wraps complete()/reject() in a try/catch and just emits
 * ERC8183Settled(settled=false) rather than reverting the whole reveal — so
 * callers may still proceed to reveal() even if this failed.
 */
export async function submitDeliverable(providerAddress: `0x${string}`, jobId: Hex, deliverableHash: Hex): Promise<void> {
  const erc8183 = addresses.contracts.erc8183 as `0x${string}`;
  const provider = findAgentByAddress(providerAddress);
  if (!provider?.circleWalletId) {
    throw new Error(`No circleWalletId found for provider ${providerAddress} — cannot submit deliverable.`);
  }
  // jobId arrives as the bytes32 form createAndFundJob returned; the real
  // submit() takes a uint256, so decode it back.
  await executeAsProviderWallet(provider.circleWalletId, erc8183, "submit(uint256,bytes32,bytes)", [
    BigInt(jobId).toString(),
    deliverableHash,
    "0x",
  ]);
}
