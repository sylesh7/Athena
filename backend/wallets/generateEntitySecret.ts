/**
 * wallets/generateEntitySecret.ts — generates a new Developer-Controlled
 * Wallets entity secret and its registration ciphertext.
 *
 * Deliberately stops short of `registerEntitySecretCiphertext()` — that
 * function calls Circle's live API, permanently ties the secret to your
 * account, and downloads a recovery file. That's a one-way action tied to
 * a real Circle account, so registration is done manually via the Circle
 * Developer Portal (paste the printed ciphertext there) rather than from
 * this script.
 *
 * `generateEntitySecretCiphertext()` itself only does a read-only GET of
 * Circle's RSA public key, then encrypts locally — no account state changes.
 *
 * Usage:
 *   npm run wallets:entity-secret
 *   npm run wallets:entity-secret -- --force   (overwrite an existing secret)
 */

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { requireEnv } from "../lib/chain.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_LOCAL_PATH = join(__dirname, "..", ".env.local");

// `import { generateEntitySecretCiphertext } from "@circle-fin/developer-controlled-wallets"`
// resolves to `undefined` under tsx's ESM loader — its CJS bundle exports
// everything through one very long chained `exports.a=x,exports.b=y,...`
// statement, which trips up tsx's static named-export detection (confirmed:
// plain `node --import`/`node` resolves it fine, only tsx fails). Loading it
// via createRequire sidesteps that loader entirely.
const require = createRequire(import.meta.url);
const { generateEntitySecretCiphertext } = require("@circle-fin/developer-controlled-wallets") as {
  generateEntitySecretCiphertext: (input: { apiKey: string; entitySecret: string }) => Promise<string>;
};

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

// Upserts KEY=VALUE, preserving every other line (comments, other wallets'
// keys) exactly as-is rather than regenerating the whole file.
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

  if (existing.CIRCLE_ENTITY_SECRET && !force) {
    console.log("CIRCLE_ENTITY_SECRET already set in backend/.env.local — skipping generation.");
    console.log("(pass --force to generate a new one; do NOT do this after you've already");
    console.log(" registered the old ciphertext in the Circle Developer Portal — that would");
    console.log(" leave your account's registered secret out of sync with this file.)");
    return;
  }

  const apiKey = requireEnv("CIRCLE_API_KEY");
  const entitySecret = randomBytes(32).toString("hex");

  console.log("Fetching Circle's RSA public key and encrypting locally (read-only, no account changes)...\n");
  const ciphertext = await generateEntitySecretCiphertext({ apiKey, entitySecret });

  upsertEnvLine(ENV_LOCAL_PATH, "CIRCLE_ENTITY_SECRET", entitySecret);

  console.log("=== Entity secret generated ===\n");
  console.log(`Saved to backend/.env.local as CIRCLE_ENTITY_SECRET (first/last 4 hex shown: ${entitySecret.slice(0, 4)}...${entitySecret.slice(-4)})`);
  console.log("This is the plaintext secret — treat it like a master key. Never commit it,");
  console.log("never paste it anywhere except the Circle Developer Portal's own secure field.\n");

  console.log("=== Ciphertext — paste this into the Circle Developer Portal to register ===\n");
  console.log(ciphertext);
  console.log("\nhttps://console.circle.com → Developer Account → Entity Secret Management");
  console.log("(or the QuickStart: https://developers.circle.com/wallets/dev-controlled/entity-secret-management)");
  console.log("\nCircle will give you a recovery file when you register — store that securely too.");
}

main().catch((err) => {
  console.error("Failed to generate entity secret ciphertext:", err);
  process.exit(1);
});
