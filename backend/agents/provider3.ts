/**
 * agents/provider3.ts — Provider 3: price feed aggregation.
 * Cross-checks CoinGecko and Coinbase spot prices and reports a quality
 * score based on how well the independent sources agree — real aggregation,
 * not a passthrough of a single upstream.
 * Gateway-protected x402 endpoint, $0.000001 USDC per call.
 */

import "../lib/config.js";
import { requireEnv } from "../lib/chain.js";
import { createProviderApp, type ProviderCallResult } from "./providerServer.js";

const PORT = Number(process.env.PROVIDER3_PORT ?? 3003);
const SELLER_ADDRESS = requireEnv("PROVIDER3_WALLET_ADDRESS");

async function fetchCoinGeckoPrice(): Promise<number> {
  const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd");
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
  const json = (await res.json()) as { ethereum?: { usd?: number } };
  const price = json.ethereum?.usd;
  if (typeof price !== "number") throw new Error("Malformed CoinGecko response");
  return price;
}

async function fetchCoinbasePrice(): Promise<number> {
  const res = await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot");
  if (!res.ok) throw new Error(`Coinbase ${res.status}`);
  const json = (await res.json()) as { data?: { amount?: string } };
  const price = Number(json.data?.amount);
  if (!Number.isFinite(price)) throw new Error("Malformed Coinbase response");
  return price;
}

async function fetchAggregatedPrice(): Promise<ProviderCallResult> {
  const results = await Promise.allSettled([fetchCoinGeckoPrice(), fetchCoinbasePrice()]);
  const prices = results.filter((r): r is PromiseFulfilledResult<number> => r.status === "fulfilled").map((r) => r.value);

  if (prices.length === 0) {
    throw new Error("All upstream price sources failed: " + results.map((r) => (r.status === "rejected" ? r.reason?.message : "")).join("; "));
  }

  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
  const spread = prices.length > 1 ? Math.max(...prices) - Math.min(...prices) : 0;
  const spreadPct = avg > 0 ? spread / avg : 0;

  // Quality reflects both (a) how many of the 2 configured sources responded,
  // and (b) how tightly they agree — a >1% spread between two spot quotes is
  // a meaningful disagreement worth downgrading confidence for.
  const completeness = prices.length / results.length;
  const agreement = Math.max(0, 1 - spreadPct * 100);
  const qualityScore = Math.min(1, completeness * agreement);

  return {
    data: {
      pair: "ETH/USD",
      price: avg,
      sourcesUsed: prices.length,
      sourcesConfigured: results.length,
      spreadPct: spreadPct * 100,
    },
    qualityScore,
  };
}

const app = createProviderApp({
  sellerAddress: SELLER_ADDRESS,
  pricePerCallUsdc: "$0.000001",
  route: "/price/feed",
  handler: fetchAggregatedPrice,
});

app.listen(PORT, () => {
  console.log(`Provider 3 (price feed aggregation) listening on :${PORT}`);
  console.log(`  Unpaid request: curl -i http://localhost:${PORT}/price/feed  (expect 402)`);
});
