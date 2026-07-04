/**
 * wallets/setup.ts — Phase 1.1: broker agent wallet.
 *
 * Broker-only. Providers moved to Circle Developer-Controlled Wallets (see
 * wallets/setupCircleProviders.ts) — they never sign anything
 * (createGatewayMiddleware only needs an address to receive payment at), so
 * there's no reason for them to be plain EOAs. The broker stays a plain EOA
 * because GatewayClient.pay() (from @circle-fin/x402-batching) requires a
 * raw private key in its constructor — verified against the real published
 * .d.ts, Circle custody structurally cannot provide one.
 *
 * This used to also generate 3 provider EOAs and stage a "backendWallets"
 * section in shared/addresses.json. Both are gone now — worth knowing if
 * you're wondering where that went: the provider EOAs it used to make are
 * preserved as PROVIDER{1,2,3}_LEGACY_PK / _LEGACY_WALLET_ADDRESS in
 * .env.local (still funded, still ERC-8004-registered under their old
 * tokenIds, just no longer part of the active flow), and the
 * "backendWallets" section was pure duplication of shared/addresses.json's
 * "agents" section once every agent had a real registration there.
 *
 * Idempotent: if backend/.env.local already has BROKER_PK, this refuses to
 * regenerate it (pass --force to override) — overwriting a funded,
 * ERC-8004-registered wallet's key is unrecoverable.
 *
 * Usage:
 *   npm run wallets:setup
 *   npm run wallets:setup -- --force
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { loadAddresses } from "../lib/config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_LOCAL_PATH = join(__dirname, "..", ".env.local");

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

// Upserts KEY=VALUE, preserving every other line (legacy provider entries,
// RPC_URL, entity secret, comments) exactly as-is.
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

function main() {
  const force = process.argv.includes("--force");
  const existing = parseEnvFile(ENV_LOCAL_PATH);

  if (existing.BROKER_PK && !force) {
    console.log("BROKER_PK already exists in backend/.env.local — skipping generation.");
    console.log("(pass --force to regenerate; this abandons the funded, ERC-8004-registered wallet)\n");
    printSummary(existing.BROKER_WALLET_ADDRESS!);
    return;
  }

  console.log("=== Athena Backend B — Broker Wallet Setup (Phase 1.1) ===\n");

  const pk = generatePrivateKey();
  const address = privateKeyToAccount(pk).address;

  upsertEnvLine(ENV_LOCAL_PATH, "BROKER_PK", pk);
  upsertEnvLine(ENV_LOCAL_PATH, "BROKER_WALLET_ADDRESS", address);
  console.log("Wrote BROKER_PK / BROKER_WALLET_ADDRESS to backend/.env.local\n");

  printSummary(address);
}

function printSummary(address: string) {
  const addresses = loadAddresses();

  console.log(`Broker wallet: ${address}\n`);

  console.log("── Next steps ──────────────────────────────────────────────");
  console.log("  1. Fund with testnet USDC (native gas + ERC-20 balance):");
  console.log("       Faucet: https://faucet.circle.com (select Arc Testnet)");
  console.log(`       or:     circle wallet fund --address ${address} --chain ARC-TESTNET\n`);
  console.log("  2. Deposit into Gateway (funds the stream's nanopayments):");
  console.log(`       circle gateway deposit --amount 10 --address ${address} --chain ARC-TESTNET --method direct\n`);
  console.log("  3. Approve AthenaCommit to pull the bond:");
  console.log(
    `       cast send ${addresses.contracts.usdc} "approve(address,uint256)" ${addresses.contracts.athenaCommit} <bondAmount> --rpc-url arc_testnet --private-key $BROKER_PK\n`
  );
  console.log("  4. Register on ERC-8004 (if not already): npm run wallets:register-broker");
  console.log("     (contracts/scripts/register-agents.ts's DEPLOYER_PK slot registers Backend");
  console.log("      A's own deploy key, not this wallet — see wallets/registerBroker.ts's header)");
}

main();
