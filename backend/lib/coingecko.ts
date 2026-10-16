/**
 * lib/coingecko.ts — one place all provider agents fetch CoinGecko through, so
 * the API key is attached consistently. Without a key the free public endpoint
 * rate-limits hard (HTTP 429), which is exactly what broke real streams mid-run
 * ("Payment failed: CoinGecko returned 429"). A CoinGecko Demo key (the `CG-`
 * prefixed kind) lifts that limit and is sent via the `x-cg-demo-api-key`
 * header on the same public base URL.
 *
 * Set COINGECKO_API_KEY in .env.local. If it's absent this still works — it
 * just falls back to the unauthenticated endpoint and its low rate limit.
 */

const BASE_URL = "https://api.coingecko.com/api/v3";

/**
 * Fetch a CoinGecko API path (e.g. "/simple/price?ids=ethereum&vs_currencies=usd").
 * Reads the key at call time (not module load) so it doesn't matter whether
 * lib/config.ts has populated process.env yet.
 */
export function coinGeckoFetch(path: string): Promise<Response> {
  const headers: Record<string, string> = { accept: "application/json" };
  const apiKey = process.env.COINGECKO_API_KEY;
  if (apiKey) headers["x-cg-demo-api-key"] = apiKey;
  return fetch(`${BASE_URL}${path}`, { headers });
}
