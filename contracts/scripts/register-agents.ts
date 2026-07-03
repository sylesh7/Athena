/**
 * register-agents.ts
 *
 * Registers Athena broker + 3 provider agents on ERC-8004 IdentityRegistry.
 * Run AFTER AthenaCommit is deployed and addresses.json has athenaCommit filled in.
 *
 * Usage:
 *   cd contracts/scripts
 *   npm install
 *   DEPLOYER_PK=0x... PROVIDER1_PK=0x... PROVIDER2_PK=0x... PROVIDER3_PK=0x... npm run register
 *
 * Output:
 *   Writes tokenIds back into ../../shared/addresses.json "agents" key.
 *   PING Frontend with this file after it updates (Handoff H5).
 */

import { createWalletClient, createPublicClient, http, parseAbi, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADDRESSES_PATH = join(__dirname, "../../shared/addresses.json");

// ── Arc Testnet chain definition ──────────────────────────────────────────────
// NOTE: nativeCurrency decimals = 18 (native interface). ERC-20 USDC is 6 decimals.
// Never use native balance for payment amounts — always read ERC-20 balanceOf.
const CANTEEN_RPC = process.env.RPC ?? "https://rpc.testnet.arc-node.thecanteenapp.com/v1/swrm_8c204da93fca2d8c58651fbf1fae35596838c36c8e21c04a8cea977489432adb";

const arcTestnet = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [CANTEEN_RPC] } },
  blockExplorers: { default: { name: "Arcscan", url: "https://testnet.arcscan.app" } },
} as const;

// ── ERC-8004 ABIs ─────────────────────────────────────────────────────────────
const identityRegistryAbi = parseAbi([
  "function register(string calldata metadataURI) external returns (uint256 tokenId)",
  "function ownerOf(uint256 tokenId) external view returns (address)",
  "function tokenURI(uint256 tokenId) external view returns (string)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
]);

// ── Contract addresses ────────────────────────────────────────────────────────
const IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e" as Address;

// ── Agent metadata templates ──────────────────────────────────────────────────
// For production: host on IPFS (Pinata / Web3.Storage) and use ipfs:// URI.
// For hackathon: use data: URI to avoid IPFS dependency.
function makeMetadataURI(name: string, description: string, agentType: string, capabilities: string[]) {
  const json = JSON.stringify({
    name,
    description,
    agent_type: agentType,
    capabilities,
    version: "1.0.0",
  });
  return `data:application/json,${encodeURIComponent(json)}`;
}

const AGENT_DEFS = [
  {
    key: "broker",
    envKey: "DEPLOYER_PK",
    name: "Athena Broker",
    description: "Trust-minimized AI broker that commits routing predictions on-chain and streams USDC nanopayments",
    agentType: "broker",
    capabilities: ["routing", "commit-reveal", "nanopayments", "mcp-monitor"],
  },
  {
    key: "provider1",
    envKey: "PROVIDER1_PK",
    name: "Athena Crypto Provider",
    description: "Provides real-time crypto price feeds via x402-protected endpoints",
    agentType: "provider",
    capabilities: ["crypto-prices", "x402", "usdc-payments"],
  },
  {
    key: "provider2",
    envKey: "PROVIDER2_PK",
    name: "Athena Market Analytics Provider",
    description: "Provides market analytics and sentiment data via x402-protected endpoints",
    agentType: "provider",
    capabilities: ["market-analytics", "x402", "usdc-payments"],
  },
  {
    key: "provider3",
    envKey: "PROVIDER3_PK",
    name: "Athena Price Feed Provider",
    description: "Provides high-frequency price feed data via x402 — operates on Base Sepolia for CCTP demo",
    agentType: "provider",
    capabilities: ["price-feed", "x402", "usdc-payments", "cross-chain"],
  },
] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function registerAgent(
  privateKey: `0x${string}`,
  metadataURI: string
): Promise<{ address: Address; tokenId: bigint; txHash: `0x${string}` }> {
  const account = privateKeyToAccount(privateKey);

  const walletClient = createWalletClient({
    account,
    chain: arcTestnet as any,
    transport: http(),
  });

  const publicClient = createPublicClient({
    chain: arcTestnet as any,
    transport: http(),
  });

  const txHash = await walletClient.writeContract({
    address: IDENTITY_REGISTRY,
    abi: identityRegistryAbi,
    functionName: "register",
    args: [metadataURI],
    chain: arcTestnet as any,
  });

  console.log(`  tx: ${txHash}`);
  console.log(`  waiting for confirmation...`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  // Parse tokenId from Transfer event (from=0x0 = mint)
  const transferLog = receipt.logs.find(
    (log: { address: string; topics: (string | undefined)[] }) =>
      log.address.toLowerCase() === IDENTITY_REGISTRY.toLowerCase() &&
      log.topics[1] === "0x0000000000000000000000000000000000000000000000000000000000000000"
  );

  if (!transferLog?.topics[3]) {
    throw new Error(`Could not find Transfer event in tx ${txHash}`);
  }

  const tokenId = BigInt(transferLog.topics[3]);
  return { address: account.address, tokenId, txHash };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Athena Agent ERC-8004 Registration ===");
  console.log("Network: Arc Testnet (chainId 5042002)");
  console.log("IdentityRegistry:", IDENTITY_REGISTRY);
  console.log("");

  const addresses = JSON.parse(readFileSync(ADDRESSES_PATH, "utf8"));
  if (!addresses.agents) addresses.agents = {};

  for (const agent of AGENT_DEFS) {
    if (addresses.agents[agent.key]?.tokenId) {
      console.log(`  ✓ ${agent.key} already registered (tokenId: ${addresses.agents[agent.key].tokenId}) — skipping`);
      console.log("");
      continue;
    }
    const pkEnv = process.env[agent.envKey];
    if (!pkEnv) {
      console.warn(`⚠  Skipping ${agent.key}: ${agent.envKey} not set`);
      continue;
    }

    console.log(`Registering ${agent.key} (${agent.name})...`);
    const metadataURI = makeMetadataURI(
      agent.name,
      agent.description,
      agent.agentType,
      agent.capabilities as unknown as string[]
    );

    const { address, tokenId, txHash } = await registerAgent(pkEnv as `0x${string}`, metadataURI);

    addresses.agents[agent.key] = {
      address,
      tokenId: tokenId.toString(),
      name: agent.name,
      role: agent.agentType,
      registrationTx: txHash,
      arcscan: `https://testnet.arcscan.app/tx/${txHash}`,
    };

    console.log(`  ✓ address: ${address}`);
    console.log(`  ✓ tokenId: ${tokenId}`);
    console.log(`  ✓ arcscan: https://testnet.arcscan.app/tx/${txHash}`);
    console.log("");
  }

  writeFileSync(ADDRESSES_PATH, JSON.stringify(addresses, null, 2));
  console.log("=== DONE — shared/addresses.json updated ===");
  console.log("PING Frontend with tokenIds now (Handoff H5)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
