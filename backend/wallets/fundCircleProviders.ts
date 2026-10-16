/**
 * wallets/fundCircleProviders.ts — requests native + USDC testnet tokens
 * for the 3 Circle-custodied provider wallets via Circle's own faucet API,
 * instead of manually visiting faucet.circle.com for each address.
 *
 * Real API call (Circle's DeveloperAccount faucet), not a stub — this is
 * necessary before wallets:circle-register-agents can succeed, since a
 * brand-new wallet has no native gas to pay for its own registration tx.
 *
 * Usage: npm run wallets:circle-fund
 */

import { createRequire } from "node:module";
import { requireEnv } from "../lib/chain.js";

const require = createRequire(import.meta.url);
const dcw = require("@circle-fin/developer-controlled-wallets") as {
  initiateDeveloperControlledWalletsClient: (input: { apiKey: string; entitySecret: string }) => {
    requestTestnetTokens: (input: {
      address: string;
      blockchain: string;
      native?: boolean;
      usdc?: boolean;
    }) => Promise<unknown>;
  };
};

const PROVIDER_ENV_PREFIXES = ["PROVIDER1", "PROVIDER2", "PROVIDER3"] as const;

async function main() {
  const apiKey = requireEnv("CIRCLE_API_KEY");
  const entitySecret = requireEnv("CIRCLE_ENTITY_SECRET");
  const client = dcw.initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });

  console.log("=== Requesting Arc Testnet faucet funds for Circle provider wallets ===\n");

  for (const prefix of PROVIDER_ENV_PREFIXES) {
    const address = requireEnv(`${prefix}_WALLET_ADDRESS`);
    console.log(`${prefix}: requesting native + USDC for ${address}...`);
    try {
      await client.requestTestnetTokens({ address, blockchain: "ARC-TESTNET", native: true, usdc: true });
      console.log(`  ✓ requested`);
    } catch (err) {
      console.error(`  ✗ failed:`, err instanceof Error ? err.message : err);
    }
  }

  console.log("\nFaucet drips can take a minute or two to land. Check balances with:");
  console.log("  npm test   (Tier 0's funding status check)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
