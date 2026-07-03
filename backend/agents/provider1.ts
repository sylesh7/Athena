/**
 * agents/provider1.ts — Provider 1: real-time crypto price data.
 * Gateway-protected x402 endpoint, $0.000001 USDC per call.
 */

import "../lib/config.js"; // loads .env / .env.local before anything reads process.env
import { requireEnv } from "../lib/chain.js";
import { createProviderApp, type ProviderCallResult } from "./providerServer.js";

const PORT = Number(process.env.PROVIDER1_PORT ?? 3001);
const SELLER_ADDRESS = requireEnv("PROVIDER1_WALLET_ADDRESS");

async function fetchUsdcEthPrice(): Promise<ProviderCallResult> {
  const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd");
  if (!res.ok) throw new Error(`CoinGecko returned ${res.status}`);

  const json = (await res.json()) as { ethereum?: { usd?: number } };
  const price = json.ethereum?.usd;
  if (typeof price !== "number") throw new Error("Malformed CoinGecko response");

  // USDC is USD-pegged 1:1, so ETH/USD is the USDC/ETH quote inverted at par.
  return {
    data: { pair: "USDC/ETH", price },
    qualityScore: 1.0,
  };
}

const app = createProviderApp({
  sellerAddress: SELLER_ADDRESS,
  pricePerCallUsdc: "$0.000001",
  route: "/price/usdc-eth",
  handler: fetchUsdcEthPrice,
});

app.listen(PORT, () => {
  console.log(`Provider 1 (crypto price) listening on :${PORT}`);
  console.log(`  Unpaid request: curl -i http://localhost:${PORT}/price/usdc-eth  (expect 402)`);
});
