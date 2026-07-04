/**
 * wallets/registerBroker.ts — fixes a real on-chain identity mismatch: the
 * ERC-8004 "broker" registration (tokenId 845252) was minted to
 * 0x588F6b3169F60176c1143f8BaB47bCf3DeEbECdc — Backend A's own deploy key,
 * since contracts/scripts/register-agents.ts registers the broker slot
 * using DEPLOYER_PK. That is NOT the wallet that actually signs
 * commit()/reveal() in stream/streamLoop.ts (BROKER_WALLET_ADDRESS,
 * 0x27594e2b85e53d3a80095ac25DaD4d8a379F64A3) — verified by reading
 * IdentityRegistry.ownerOf(845252) on-chain, not assumed.
 *
 * Unlike the providers, the broker is a plain EOA with a real private key
 * (GatewayClient.pay() requires one), so this can use the same
 * viem-based register-agents.ts flow — just pointed at the correct key.
 * The old tokenId 845252 remains valid on-chain, permanently owned by
 * 0x588F...; it's just no longer referenced anywhere in this project.
 *
 * Usage: npm run wallets:register-broker
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAbi } from "viem";
import { publicClient, requireEnv, requirePkEnv, walletClientFromPk } from "../lib/chain.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADDRESSES_PATH = join(__dirname, "../../shared/addresses.json");

const IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e" as const;

const identityRegistryAbi = parseAbi([
  "function register(string calldata metadataURI) external returns (uint256 tokenId)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
]);

function makeMetadataURI() {
  const json = JSON.stringify({
    name: "Athena Broker",
    description: "Trust-minimized AI broker that commits routing predictions on-chain and streams USDC nanopayments",
    agent_type: "broker",
    capabilities: ["routing", "commit-reveal", "nanopayments", "mcp-monitor"],
    version: "1.0.0",
  });
  return `data:application/json,${encodeURIComponent(json)}`;
}

async function main() {
  const brokerPk = requirePkEnv("BROKER_PK");
  const brokerAddress = requireEnv("BROKER_WALLET_ADDRESS");
  const broker = walletClientFromPk(brokerPk);

  console.log("=== Re-registering broker on ERC-8004 with its real operational wallet ===\n");
  console.log(`Broker wallet: ${brokerAddress}`);

  const txHash = await broker.writeContract({
    address: IDENTITY_REGISTRY,
    abi: identityRegistryAbi,
    functionName: "register",
    args: [makeMetadataURI()],
  });
  console.log(`tx: ${txHash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  const transferLog = receipt.logs.find(
    (log) =>
      log.address.toLowerCase() === IDENTITY_REGISTRY.toLowerCase() &&
      log.topics[1] === "0x0000000000000000000000000000000000000000000000000000000000000000"
  );
  if (!transferLog?.topics[3]) throw new Error(`Could not find Transfer event in tx ${txHash}`);
  const tokenId = BigInt(transferLog.topics[3]);

  console.log(`✓ tokenId: ${tokenId}`);
  console.log(`✓ arcscan: https://testnet.arcscan.app/tx/${txHash}`);

  const addressesFile = JSON.parse(readFileSync(ADDRESSES_PATH, "utf8"));
  addressesFile.agents.broker = {
    address: brokerAddress,
    tokenId: tokenId.toString(),
    name: "Athena Broker",
    role: "broker",
    registrationTx: txHash,
    arcscan: `https://testnet.arcscan.app/tx/${txHash}`,
  };
  writeFileSync(ADDRESSES_PATH, JSON.stringify(addressesFile, null, 2) + "\n");

  console.log("\n=== DONE — shared/addresses.json's agents.broker updated ===");
  console.log("Old tokenId 845252 (owned by 0x588F...) is still valid on-chain, just unreferenced now.");
  console.log("Ping Backend A + Frontend (H5) with the new tokenId.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
