/**
 * cctp/manualPayout.ts — manually trigger the Phase 4 CCTP payout outside of
 * a real stream, for testing the burn -> attest -> mint flow on its own.
 *
 * This costs real testnet gas on two chains and can take up to 3 hours
 * waiting on Circle's attestation — it is never run automatically. The
 * normal path is stream/streamLoop.ts's post-reveal hook (gated behind
 * ENABLE_CCTP_PAYOUT=true and predictionMet=true for a Provider-3 stream).
 *
 * Usage:
 *   npm run cctp:payout -- --amount 1.0
 *   (amount is in USDC, defaults to 1.0; recipient defaults to PROVIDER3_WALLET_ADDRESS)
 */

import "../lib/config.js";
import { requireEnv, requirePkEnv } from "../lib/chain.js";
import { usdcToUnits } from "../lib/config.js";
import { payProvider3OnBase } from "./crossChainPayout.js";

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

async function main() {
  const brokerPk = requirePkEnv("BROKER_PK");
  const recipientAddress = (argValue("--recipient") ?? requireEnv("PROVIDER3_WALLET_ADDRESS")) as `0x${string}`;
  const amountUsdc = Number(argValue("--amount") ?? "1.0");
  const amountUnits = usdcToUnits(amountUsdc);

  console.log("=== Manual CCTP payout (Phase 4) ===");
  console.log(`Recipient (Base Sepolia): ${recipientAddress}`);
  console.log(`Amount: ${amountUsdc} USDC (${amountUnits} atomic units)`);
  console.log("");
  console.log("Step 1/3: depositForBurn on Arc...");

  const result = await payProvider3OnBase({ brokerPk, amountUnits, recipientAddress });

  console.log("");
  console.log("=== Done ===");
  console.log(`Burn tx (Arc):        https://testnet.arcscan.app/tx/${result.burnTxHash}`);
  console.log(`Mint tx (Base Sepolia): https://sepolia.basescan.org/tx/${result.mintTxHash}`);
}

main().catch((err) => {
  console.error("CCTP payout failed:", err);
  process.exit(1);
});
