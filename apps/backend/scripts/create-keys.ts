// Generates the EOA keys the backend needs (README "Wallet and key topology") and prints an env snippet.
// Run ONCE and keep the output: re-running creates NEW keys. Nothing is written to disk — paste into .env.local.
// ADMIN and APPROVER are deliberately NOT generated here: they are human wallets (hardware wallet / MetaMask) and
// their private keys must never touch a server.
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const roles = ["OPERATOR", "KEEPER", "YIELD", "SPEND", "COLLECTIONS", "VALIDATOR", "RELAYER"] as const;

console.log("# paste into apps/backend/.env.local (git-ignored). The comment is the PUBLIC address to fund with testnet USDC.");
for (const r of roles) {
  const pk = generatePrivateKey();
  console.log(`${r}_PK=${pk}   # ${privateKeyToAccount(pk).address}`);
}
