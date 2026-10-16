import { createPublicClient, createWalletClient, http, type Address, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { addresses } from "./config.js";

// Arc Testnet — chainId 5042002. nativeCurrency is the 18-decimal native interface
// (gas only). ALL payment/bond amounts go through the 6-decimal ERC-20 USDC at
// addresses.contracts.usdc instead — never use this native interface for amounts.
export const arcTestnet = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: { http: [rpcUrl()] },
  },
  blockExplorers: {
    default: { name: "Arcscan", url: addresses.explorer },
  },
} as const satisfies Chain;

/**
 * RPC selection: prefer an explicit RPC_URL env override, otherwise the public
 * Arc RPC. shared/addresses.json's "rpc" field embeds a Canteen auth token in
 * the URL path — that file is committed to git, so we deliberately do NOT
 * default to it here. Set RPC_URL locally (in .env.local, gitignored) if you
 * want the faster Canteen-hosted proxy.
 */
function rpcUrl(): string {
  return process.env.RPC_URL || addresses.rpc_public;
}

// Explicit timeout matters here: viem's http() transport has no timeout by
// default, so an unresponsive RPC (a Canteen proxy hiccup, a network blip)
// would otherwise hang every caller — the stream loop, the entrypoint,
// the smoke test — indefinitely instead of erroring in a way retry/backoff
// or an operator can actually see and act on.
const RPC_TIMEOUT_MS = 10_000;

export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(undefined, { timeout: RPC_TIMEOUT_MS }),
});

export function walletClientFromPk(pk: `0x${string}`) {
  const account = privateKeyToAccount(pk);
  return createWalletClient({
    account,
    chain: arcTestnet,
    transport: http(undefined, { timeout: RPC_TIMEOUT_MS }),
  });
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export function requirePkEnv(name: string): `0x${string}` {
  const v = requireEnv(name);
  if (!v.startsWith("0x") || v.length !== 66) {
    throw new Error(`${name} must be a 0x-prefixed 32-byte private key`);
  }
  return v as `0x${string}`;
}

export type { Address };
