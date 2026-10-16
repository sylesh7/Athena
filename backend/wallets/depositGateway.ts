/**
 * wallets/depositGateway.ts — deposits USDC into Circle Gateway for a wallet
 * whose raw private key we hold directly (the broker, or a throwaway
 * test-client wallet) — NOT via the `circle` CLI.
 *
 * The CLI only manages wallets it created itself, or Circle
 * Developer-Controlled Wallets reachable via `circle wallet login --type
 * agent`. Our broker is deliberately a plain EOA with a key we hold
 * ourselves (GatewayClient.pay() requires a raw private key — Circle
 * custody structurally can't provide one) — the CLI has no record of it,
 * hence "No local wallet matches ... Run circle wallet login". This script
 * uses the same GatewayClient SDK the stream loop and smoke test already
 * use, which signs directly with the key we already have.
 *
 * Usage:
 *   PK=0x... AMOUNT=10 npm run wallets:deposit-gateway
 */

import { GatewayClient } from "@circle-fin/x402-batching/client";
import { requireEnv } from "../lib/chain.js";

async function main() {
  const pk = requireEnv("PK") as `0x${string}`;
  const amount = process.env.AMOUNT ?? "10";

  const gateway = new GatewayClient({
    chain: "arcTestnet",
    privateKey: pk,
    ...(process.env.RPC_URL ? { rpcUrl: process.env.RPC_URL } : {}),
  });

  console.log(`Depositing ${amount} USDC into Gateway for ${gateway.address}...`);
  const result = await gateway.deposit(amount);
  console.log(
    `✓ Deposited. approvalTx=${result.approvalTxHash ?? "(skipped, already approved)"}  depositTx=${result.depositTxHash}`
  );

  const balances = await gateway.getBalances();
  console.log(`Gateway balance now: ${balances.gateway.formattedAvailable} USDC available`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
