/**
 * wallets/setupCircleProviders.ts — creates the 3 provider wallets as real
 * Circle Developer-Controlled Wallets on ARC-TESTNET, instead of the plain
 * EOAs from wallets/setup.ts.
 *
 * Only providers move to Circle custody — they never sign anything
 * (`createGatewayMiddleware({ sellerAddress })` only needs an address to
 * receive payment at), so this is a real, zero-rework use of Circle's
 * Agent Wallets. The broker stays a plain EOA: `GatewayClient.pay()` (from
 * `@circle-fin/x402-batching`) requires a raw `privateKey` in its
 * constructor — verified against the real published `.d.ts`, not assumed —
 * so it structurally cannot use a Circle-custodied signer.
 *
 * Idempotent: refuses to create new wallets if PROVIDER{1,2,3}_WALLET_ID is
 * already set in .env.local (pass --force to create fresh ones anyway).
 * Creating fresh ones abandons the previous set's funding/registration, so
 * this guard exists for the same reason wallets/setup.ts has one.
 *
 * Usage:
 *   npm run wallets:circle-providers
 */

import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { requireEnv } from "../lib/chain.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_LOCAL_PATH = join(__dirname, "..", ".env.local");

// See wallets/generateEntitySecret.ts — tsx's ESM loader fails to resolve
// named exports from this package's CJS bundle, so createRequire sidesteps it.
const require = createRequire(import.meta.url);
const dcw = require("@circle-fin/developer-controlled-wallets") as {
  initiateDeveloperControlledWalletsClient: (input: { apiKey: string; entitySecret: string }) => CircleClient;
};

interface CircleWallet {
  id: string;
  address: string;
  blockchain: string;
  state: string;
}
interface CircleClient {
  listWalletSets: (input?: { pageSize?: number }) => Promise<{ data?: { walletSets?: { id: string; name?: string }[] } }>;
  createWalletSet: (input: { name: string }) => Promise<{ data?: { walletSet?: { id: string } } }>;
  createWallets: (input: {
    blockchains: string[];
    count: number;
    walletSetId: string;
    accountType?: string;
    metadata?: { name?: string; refId?: string }[];
  }) => Promise<{ data?: { wallets?: CircleWallet[] } }>;
}

const PROVIDERS = [
  { key: "provider1", envPrefix: "PROVIDER1", name: "Athena Crypto Provider" },
  { key: "provider2", envPrefix: "PROVIDER2", name: "Athena Market Analytics Provider" },
  { key: "provider3", envPrefix: "PROVIDER3", name: "Athena Price Feed Provider" },
] as const;

function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return out;
}

function upsertEnvLine(path: string, key: string, value: string) {
  const lines = existsSync(path) ? readFileSync(path, "utf8").split("\n") : [];
  const idx = lines.findIndex((l) => l.trim().startsWith(`${key}=`));
  const newLine = `${key}=${value}`;
  if (idx === -1) {
    if (lines.length && lines[lines.length - 1] === "") lines.pop();
    lines.push(newLine, "");
  } else {
    lines[idx] = newLine;
  }
  writeFileSync(path, lines.join("\n"));
}

async function main() {
  const force = process.argv.includes("--force");
  const existing = parseEnvFile(ENV_LOCAL_PATH);

  if (PROVIDERS.every((p) => existing[`${p.envPrefix}_WALLET_ID`]) && !force) {
    console.log("Circle provider wallets already exist in backend/.env.local — skipping.");
    console.log("(pass --force to create new ones; this abandons the old wallets' funding)");
    for (const p of PROVIDERS) {
      console.log(`  ${p.key}: id=${existing[`${p.envPrefix}_WALLET_ID`]} address=${existing[`${p.envPrefix}_WALLET_ADDRESS`]}`);
    }
    return;
  }

  const apiKey = requireEnv("CIRCLE_API_KEY");
  const entitySecret = requireEnv("CIRCLE_ENTITY_SECRET");
  const client = dcw.initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });

  console.log("=== Creating Circle Developer-Controlled Wallets for providers ===\n");

  // Reuse an existing wallet set if one's already on this account (the
  // smoke test found one earlier) rather than spawning duplicates.
  const walletSets = await client.listWalletSets({ pageSize: 10 });
  let walletSetId = walletSets.data?.walletSets?.[0]?.id;
  if (walletSetId) {
    console.log(`Reusing existing wallet set: ${walletSetId}`);
  } else {
    const created = await client.createWalletSet({ name: "athena-providers" });
    walletSetId = created.data?.walletSet?.id;
    console.log(`Created wallet set: ${walletSetId}`);
  }
  if (!walletSetId) throw new Error("Failed to obtain a wallet set ID");

  const result = await client.createWallets({
    blockchains: ["ARC-TESTNET"],
    count: PROVIDERS.length,
    walletSetId,
    accountType: "EOA",
    metadata: PROVIDERS.map((p) => ({ name: p.name, refId: p.key })),
  });

  const wallets = result.data?.wallets;
  if (!wallets || wallets.length !== PROVIDERS.length) {
    throw new Error(`Expected ${PROVIDERS.length} wallets back, got ${wallets?.length ?? 0}`);
  }

  console.log("");
  for (let i = 0; i < PROVIDERS.length; i++) {
    const p = PROVIDERS[i]!;
    const w = wallets[i]!;
    upsertEnvLine(ENV_LOCAL_PATH, `${p.envPrefix}_WALLET_ID`, w.id);
    upsertEnvLine(ENV_LOCAL_PATH, `${p.envPrefix}_WALLET_ADDRESS`, w.address);
    console.log(`  ${p.key}: id=${w.id} address=${w.address} state=${w.state}`);
  }

  console.log("\nWritten to backend/.env.local as PROVIDER{1,2,3}_WALLET_ID / _WALLET_ADDRESS.");
  console.log("Old plain-EOA provider addresses (and their funds) are untouched — see the");
  console.log("PROVIDER{1,2,3}_LEGACY_* entries if you added them, or the git history of .env.local.");
  console.log("\nNext steps:");
  console.log("  1. Fund these new addresses: faucet.circle.com (select Arc Testnet)");
  console.log("  2. Register them on ERC-8004 — register-agents.ts CANNOT do this (it needs");
  console.log("     raw private keys, which Circle-custodied wallets don't provide).");
  console.log("     Use: npm run wallets:circle-register-agents");
}

main().catch((err) => {
  console.error("Failed to create Circle provider wallets:", err);
  process.exit(1);
});
