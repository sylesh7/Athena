// Circle's SDKs (app-kit, adapter-circle-wallets, earn-kit's defaults) ship Arc Testnet chain definitions whose RPC is
// https://rpc.testnet.arc.network — a hostname that no longer resolves (verified: ENOTFOUND). The working endpoint is
// https://rpc.testnet.arc.io. Until the SDKs update, rewrite ONLY that exact hostname on outbound fetches. Nothing else is
// touched, and it is installed once, by the modules that use those SDKs.
const DEAD = "rpc.testnet.arc.network";
const LIVE = process.env.RPC_URL_FALLBACK ? new URL(process.env.RPC_URL_FALLBACK).host : "rpc.testnet.arc.io";

let installed = false;
export function installArcRpcRewrite(): void {
  if (installed) return;
  installed = true;
  const orig = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (raw.includes(DEAD)) {
        const next = raw.replace(DEAD, LIVE);
        return orig(typeof input === "string" || input instanceof URL ? next : new Request(next, input), init);
      }
    } catch { /* fall through to the untouched request */ }
    return orig(input, init);
  }) as typeof fetch;
}

export const rewriteHost = (url: string): string => url.replace(DEAD, LIVE);
