/**
 * cctp/crossChainPayout.ts — Phase 4 (stretch): CCTP V2 cross-chain payout.
 *
 * After a stream to Provider 3 settles with predictionMet=true, pay them
 * natively on Base Sepolia instead of on Arc: burn USDC on Arc via
 * TokenMessengerV2, wait for Circle's Iris attestation, then mint on Base via
 * MessageTransmitterV2.receiveMessage(). No mocked attestation is ever
 * fabricated — receiveMessage() would simply revert on an invalid signature,
 * so the only way this can "work" is against Circle's real sandbox API.
 *
 * Every ABI and endpoint here was verified against live sources, not the
 * BACKEND_B_README pseudocode (which had two real bugs, both fixed here):
 *
 * 1. `destinationCaller` is `bytes32`, not `address` — the README pseudocode
 *    passed a 20-byte zero-address literal where the deployed
 *    `depositForBurn` signature requires a 32-byte value.
 * 2. `minFinalityThreshold: 1000` is "Fast/Confirmed", not "Standard" as the
 *    README's inline comment claimed — confirmed against Circle's technical
 *    guide (developers.circle.com/cctp/references/technical-guide). Fast
 *    transfers require a nonzero fee; the README's paired `maxFee: 0` only
 *    makes sense with Standard/Finalized, which is `2000`. This module uses
 *    `2000` for both correctness and to avoid needing a pre-funded fee
 *    allowance.
 *
 * ABI sources (fetched from Arcscan's contract API against the *verified
 * implementation* behind each proxy, not guessed from memory):
 *   - depositForBurn: implementation 0xf07c0ad1...52bf6d behind Arc's
 *     TokenMessengerV2 proxy (0x8FE6B999...2DAA)
 *   - receiveMessage: implementation 0xa849059b...a62466 behind Arc's
 *     MessageTransmitterV2 proxy (0xE737e5cE...E275) — Base Sepolia's
 *     MessageTransmitterV2 is deployed at the identical address (CREATE2),
 *     confirmed against developers.circle.com/cctp/references/contract-addresses
 *
 * Iris v2 attestation endpoint verified against Circle's published OpenAPI
 * spec: https://developers.circle.com/openapi/cctp.yaml
 */

import { createPublicClient, createWalletClient, http, pad, parseAbi, type Chain, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { addresses } from "../lib/config.js";
import { publicClient, walletClientFromPk } from "../lib/chain.js";

const ARC_DOMAIN = 26;
const BASE_SEPOLIA_DOMAIN = 6;
const IRIS_API_BASE = "https://iris-api-sandbox.circle.com";

// Same address as Arc Testnet's MessageTransmitterV2 — CCTP V2 contracts are
// deployed via CREATE2 at identical addresses across every supported chain.
// Confirmed via Circle's contract-addresses reference (not assumed).
const BASE_SEPOLIA_MESSAGE_TRANSMITTER = "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275" as const;
// `||`, not `??` — an empty-but-declared BASE_SEPOLIA_RPC= in .env is "" (a
// defined string), which `??` would happily pass through instead of falling
// back to the default. Same class of bug lib/chain.ts's rpcUrl() already
// guards against.
const BASE_SEPOLIA_RPC = process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org";

const baseSepolia = {
  id: 84532,
  name: "Base Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [BASE_SEPOLIA_RPC] } },
  blockExplorers: { default: { name: "Basescan", url: "https://sepolia.basescan.org" } },
} as const satisfies Chain;

const ZERO_BYTES32 = ("0x" + "0".repeat(64)) as Hex;

const tokenMessengerV2Abi = parseAbi([
  "function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold) external",
]);

const messageTransmitterV2Abi = parseAbi([
  "function receiveMessage(bytes calldata message, bytes calldata attestation) external returns (bool)",
]);

interface IrisMessageV2 {
  message: string;
  eventNonce: string;
  attestation: string;
  status: "complete" | "pending_confirmations";
}
interface IrisMessagesV2Response {
  messages: IrisMessageV2[];
  sourceTxHash: string;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Step 1: burn USDC on Arc, targeting Provider 3's address on Base Sepolia.
 * Standard Transfer (minFinalityThreshold=2000, maxFee=0) — free, but waits
 * for hard finality rather than the faster/paid "Fast Transfer" (1000) path.
 */
export async function depositForBurn(opts: {
  brokerPk: Hex;
  amountUnits: bigint; // 6-decimal USDC
  recipientAddress: `0x${string}`; // Provider 3's address — same EOA works on Base, addresses are chain-agnostic
}): Promise<Hex> {
  const broker = walletClientFromPk(opts.brokerPk);
  const mintRecipient = pad(opts.recipientAddress, { size: 32 });

  const txHash = await broker.writeContract({
    address: addresses.contracts.cctpTokenMessengerV2 as `0x${string}`,
    abi: tokenMessengerV2Abi,
    functionName: "depositForBurn",
    args: [
      opts.amountUnits,
      BASE_SEPOLIA_DOMAIN,
      mintRecipient,
      addresses.contracts.usdc as `0x${string}`,
      ZERO_BYTES32, // destinationCaller = anyone can relay
      0n, // maxFee — only valid because minFinalityThreshold is Standard (2000), not Fast (1000)
      2000, // Standard/Finalized
    ],
  });

  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return txHash;
}

/**
 * Step 2: poll Circle's real Iris v2 attestation API until the signed
 * message + attestation are ready. Never fabricates a stand-in attestation —
 * there's nothing to fake, `receiveMessage` cryptographically verifies it.
 */
export async function pollAttestation(
  arcTxHash: Hex,
  opts: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<{ message: Hex; attestation: Hex }> {
  const timeoutMs = opts.timeoutMs ?? 3 * 60 * 60 * 1000; // 3 hours, per the README's timebox
  const intervalMs = opts.intervalMs ?? 20_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const res = await fetch(`${IRIS_API_BASE}/v2/messages/${ARC_DOMAIN}?transactionHash=${arcTxHash}`);

    if (res.status === 404) {
      // Iris hasn't indexed the burn tx yet — not an error, keep polling.
      await sleep(intervalMs);
      continue;
    }
    if (!res.ok) throw new Error(`Iris API returned ${res.status}: ${await res.text()}`);

    const body = (await res.json()) as IrisMessagesV2Response;
    const entry = body.messages?.[0];

    if (entry && entry.status === "complete" && entry.attestation && entry.attestation !== "PENDING") {
      return { message: entry.message as Hex, attestation: entry.attestation as Hex };
    }

    await sleep(intervalMs);
  }

  throw new Error(
    `Attestation not ready after ${timeoutMs}ms. Burn tx is proof of mechanism on Arcscan: ` +
      `https://testnet.arcscan.app/tx/${arcTxHash}`
  );
}

/**
 * Step 3: submit the signed message + attestation to Base Sepolia's
 * MessageTransmitterV2 to complete the mint. Runs against Base Sepolia, not
 * Arc — the broker wallet needs its own Base Sepolia ETH for gas, separate
 * from its Arc gas balance (same address, different chain's faucet).
 */
export async function receiveMessageOnBase(opts: { brokerPk: Hex; message: Hex; attestation: Hex }): Promise<Hex> {
  const account = privateKeyToAccount(opts.brokerPk);
  // Explicit timeout — see lib/chain.ts for why viem's http() default (none)
  // is a real hang risk, not just a style nit.
  const transport = http(undefined, { timeout: 10_000 });
  const walletClient = createWalletClient({ account, chain: baseSepolia, transport });
  const basePublicClient = createPublicClient({ chain: baseSepolia, transport });

  const txHash = await walletClient.writeContract({
    address: BASE_SEPOLIA_MESSAGE_TRANSMITTER,
    abi: messageTransmitterV2Abi,
    functionName: "receiveMessage",
    args: [opts.message, opts.attestation],
  });

  await basePublicClient.waitForTransactionReceipt({ hash: txHash });
  return txHash;
}

/**
 * Full Phase 4 flow: burn on Arc -> poll attestation -> mint on Base.
 * Intended to run after reveal() confirms predictionMet=true for a stream
 * that routed to Provider 3 — see stream/streamLoop.ts's post-reveal hook.
 */
export async function payProvider3OnBase(opts: {
  brokerPk: Hex;
  amountUnits: bigint;
  recipientAddress: `0x${string}`;
}): Promise<{ burnTxHash: Hex; mintTxHash: Hex }> {
  const burnTxHash = await depositForBurn(opts);
  const { message, attestation } = await pollAttestation(burnTxHash);
  const mintTxHash = await receiveMessageOnBase({ brokerPk: opts.brokerPk, message, attestation });
  return { burnTxHash, mintTxHash };
}
