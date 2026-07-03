/**
 * agents/provider2.ts — Provider 2: market analytics (24h volume, market cap).
 * Gateway-protected x402 endpoint, $0.000001 USDC per call.
 */

import "../lib/config.js";
import { requireEnv } from "../lib/chain.js";
import { createProviderApp, type ProviderCallResult } from "./providerServer.js";

const PORT = Number(process.env.PROVIDER2_PORT ?? 3002);
const SELLER_ADDRESS = requireEnv("PROVIDER2_WALLET_ADDRESS");

interface CoinGeckoMarket {
  symbol: string;
  current_price: number;
  total_volume: number;
  market_cap: number;
  price_change_percentage_24h: number | null;
}

async function fetchMarketAnalytics(): Promise<ProviderCallResult> {
  const res = await fetch("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=ethereum");
  if (!res.ok) throw new Error(`CoinGecko returned ${res.status}`);

  const [market] = (await res.json()) as CoinGeckoMarket[];
  if (!market || typeof market.current_price !== "number") {
    throw new Error("Malformed CoinGecko markets response");
  }

  return {
    data: {
      symbol: market.symbol.toUpperCase(),
      priceUsd: market.current_price,
      volume24hUsd: market.total_volume,
      marketCapUsd: market.market_cap,
      change24hPct: market.price_change_percentage_24h,
    },
    // Slightly discount quality if the 24h change field came back null —
    // still usable data, just incomplete.
    qualityScore: market.price_change_percentage_24h === null ? 0.85 : 1.0,
  };
}

const app = createProviderApp({
  sellerAddress: SELLER_ADDRESS,
  pricePerCallUsdc: "$0.000001",
  route: "/analytics/eth",
  handler: fetchMarketAnalytics,
});

app.listen(PORT, () => {
  console.log(`Provider 2 (market analytics) listening on :${PORT}`);
  console.log(`  Unpaid request: curl -i http://localhost:${PORT}/analytics/eth  (expect 402)`);
});
