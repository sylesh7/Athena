/**
 * wallets/registerCircleProviders.ts — registers the 3 Circle-custodied
 * provider wallets (created by wallets/setupCircleProviders.ts) on ERC-8004,
 * signing via Circle's Transaction API instead of a raw private key.
 *
 * Why this can't just be contracts/scripts/register-agents.ts: that script
 * signs with `privateKeyToAccount(pk)` via viem, and Circle-custodied
 * wallets never expose a raw private key. This calls the same
 * `IdentityRegistry.register(string)` function, but via
 * `createContractExecutionTransaction({ walletId, ... })` — Circle signs and
 * broadcasts it server-side.
 *
 * This DOES write to shared/addresses.json's "agents" section, which the
 * top-level README says Backend A owns exclusively. The exception here is
 * real, not a convention I'm ignoring: register-agents.ts (Backend A's
 * script) structurally cannot perform this specific registration (no raw
 * PK to sign with), so there is no other tool that can update this record.
 * The 3 old EOA registrations (tokenIds 845255-845257) remain valid
 * on-chain forever — they just become unlinked from this config once the
 * new tokenIds are written here. Ping Backend A after running this.
 *
 * Usage: npm run wallets:circle-register-agents
 */

import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeEventLog, parseAbi } from "viem";
import { publicClient, requireEnv } from "../lib/chain.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADDRESSES_PATH = join(__dirname, "../../shared/addresses.json");

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
  getTransaction: (input: {
    id: string;
    waitForTxHash: true;
    signal?: AbortSignal;
  }) => Promise<{ data: { transaction: { txHash: string } } }>;
}

const IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e" as const;

const transferEventAbi = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
]);

const PROVIDERS = [
  {
    key: "provider1",
    envPrefix: "PROVIDER1",
    name: "Athena Crypto Provider",
    description: "Provides real-time crypto price feeds via x402-protected endpoints",
    capabilities: ["crypto-prices", "x402", "usdc-payments"],
  },
  {
    key: "provider2",
    envPrefix: "PROVIDER2",
    name: "Athena Market Analytics Provider",
    description: "Provides market analytics and sentiment data via x402-protected endpoints",
    capabilities: ["market-analytics", "x402", "usdc-payments"],
  },
  {
    key: "provider3",
    envPrefix: "PROVIDER3",
    name: "Athena Price Feed Provider",
    description: "Provides high-frequency price feed data via x402 — operates on Base Sepolia for CCTP demo",
    capabilities: ["price-feed", "x402", "usdc-payments", "cross-chain"],
  },
] as const;

function makeMetadataURI(name: string, description: string, capabilities: string[]) {
  const json = JSON.stringify({ name, description, agent_type: "provider", capabilities, version: "1.0.0" });
  return `data:application/json,${encodeURIComponent(json)}`;
}

async function main() {
  const apiKey = requireEnv("CIRCLE_API_KEY");
  const entitySecret = requireEnv("CIRCLE_ENTITY_SECRET");
  const client = dcw.initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });

  console.log("=== Registering Circle-custodied providers on ERC-8004 ===\n");

  const addressesFile = JSON.parse(readFileSync(ADDRESSES_PATH, "utf8"));
  addressesFile.agents ??= {};

  for (const p of PROVIDERS) {
    const walletId = requireEnv(`${p.envPrefix}_WALLET_ID`);
    const address = requireEnv(`${p.envPrefix}_WALLET_ADDRESS`);

    console.log(`Registering ${p.key} (walletId=${walletId})...`);
    const metadataURI = makeMetadataURI(p.name, p.description, p.capabilities as unknown as string[]);

    const created = await client.createContractExecutionTransaction({
      walletId,
      contractAddress: IDENTITY_REGISTRY,
      abiFunctionSignature: "register(string)",
      abiParameters: [metadataURI],
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    });
    const txId = created.data?.id;
    if (!txId) throw new Error(`Circle did not return a transaction id for ${p.key}`);

    // Circle signs + broadcasts server-side; waitForTxHash polls internally
    // until it's mined enough to have a hash. Explicit timeout — an
    // unresponsive poll should fail loudly, not hang forever (see
    // lib/chain.ts's RPC_TIMEOUT_MS comment for why this matters).
    const { data } = await client.getTransaction({
      id: txId,
      waitForTxHash: true,
      signal: AbortSignal.timeout(120_000),
    });
    const txHash = data.transaction.txHash as `0x${string}`;
    console.log(`  tx: ${txHash}`);

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    const transferLog = receipt.logs.find((log) => log.address.toLowerCase() === IDENTITY_REGISTRY.toLowerCase());
    if (!transferLog) throw new Error(`No Transfer event found in tx ${txHash} for ${p.key}`);
    const decoded = decodeEventLog({ abi: transferEventAbi, data: transferLog.data, topics: transferLog.topics });
    const tokenId = decoded.args.tokenId;

    addressesFile.agents[p.key] = {
      address,
      tokenId: tokenId.toString(),
      name: p.name,
      role: "provider",
      registrationTx: txHash,
      arcscan: `https://testnet.arcscan.app/tx/${txHash}`,
      custody: "circle-dcw",
      circleWalletId: walletId,
    };

    console.log(`  ✓ tokenId: ${tokenId}`);
    console.log(`  ✓ arcscan: https://testnet.arcscan.app/tx/${txHash}\n`);
  }

  writeFileSync(ADDRESSES_PATH, JSON.stringify(addressesFile, null, 2) + "\n");
  console.log("=== DONE — shared/addresses.json updated ===");
  console.log("This touched Backend A's owned file (see this script's header comment for why) —");
  console.log("ping them and Frontend (H5) with the new tokenIds.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
