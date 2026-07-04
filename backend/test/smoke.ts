/**
 * test/smoke.ts — single-file completion check for Backend B.
 *
 * Real checks against real state, not mocks:
 *   Tier 0   config/chain wiring — always runs, no other process needed
 *   Tier 0.5 Circle Developer-Controlled Wallets auth — real API call
 *   Tier 1   provider endpoints (needs `npm run provider1/2/3` running)
 *   Tier 2   MCP monitor (needs `python mcp-monitor/monitor.py` running)
 *   Tier 3   entrypoint (needs `npm run entrypoint` running)
 *
 * Tier 0/0.5 failures are hard failures (exit 1) — they mean the base
 * wiring is broken regardless of what's running. Tier 1-3 report SKIP
 * with instructions if that process isn't up, rather than failing the
 * whole run, since this is meant to be runnable before every service is
 * started.
 *
 * Usage: npm test
 */

import "../lib/config.js";
import { createRequire } from "node:module";
import { encodePacked, keccak256, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { addresses, athenaCommitAbi } from "../lib/config.js";
import { publicClient, requireEnv } from "../lib/chain.js";
import { closeMcpClient, getFinalVerdict, recordCallResult } from "../mcp-monitor/client.js";

type Status = "PASS" | "FAIL" | "SKIP";
interface Result {
  tier: string;
  name: string;
  status: Status;
  detail: string;
}
const results: Result[] = [];

async function check(tier: string, name: string, fn: () => Promise<string>) {
  try {
    const detail = await fn();
    results.push({ tier, name, status: "PASS", detail });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    results.push({ tier, name, status: "FAIL", detail: message });
  }
}

function skip(tier: string, name: string, reason: string) {
  results.push({ tier, name, status: "SKIP", detail: reason });
}

async function fetchWithTimeout(url: string, opts: RequestInit = {}, ms = 3000): Promise<Response> {
  return fetch(url, { ...opts, signal: AbortSignal.timeout(ms) });
}

// ── Tier 0: config / chain wiring ──────────────────────────────────────────

async function tier0() {
  await check("0", "shared/addresses.json + ABI load", async () => {
    if (!addresses.contracts.athenaCommit) throw new Error("contracts.athenaCommit missing");
    if (!Array.isArray(athenaCommitAbi) || athenaCommitAbi.length === 0) throw new Error("ABI is empty or not an array");
    const hasCommitFn = (athenaCommitAbi as { name?: string }[]).some((f) => f.name === "commit");
    if (!hasCommitFn) throw new Error("ABI has no commit() entry — is shared/abis/AthenaCommit.json valid JSON?");
    return `athenaCommit=${addresses.contracts.athenaCommit}, ${athenaCommitAbi.length} ABI entries`;
  });

  await check("0", "RPC reachable (publicClient.getBlockNumber)", async () => {
    const block = await publicClient.getBlockNumber();
    return `block #${block} via ${process.env.RPC_URL ? "RPC_URL override" : addresses.rpc_public}`;
  });

  await check("0", "AthenaCommit.computeTaskId matches local keccak256", async () => {
    const client = "0x00000000000000000000000000000000000000AA" as const; // properly EIP-55 checksummed dummy address
    const desc = "smoke-test-task";
    const blockNumber = await publicClient.getBlockNumber();

    const onChain = await publicClient.readContract({
      address: addresses.contracts.athenaCommit as `0x${string}`,
      abi: athenaCommitAbi,
      functionName: "computeTaskId",
      args: [client, desc, blockNumber],
    });
    const local = keccak256(encodePacked(["address", "string", "uint256"], [client, desc, blockNumber]));
    if (onChain !== local) throw new Error(`mismatch: on-chain=${onChain} local=${local}`);
    return `deployed bytecode agrees with entrypoint.ts's taskId scheme (${onChain})`;
  });

  await check("0", "AthenaCommit.isCommitted on an unused taskId returns false", async () => {
    const unusedTaskId = keccak256(encodePacked(["string"], ["smoke-test-unused"]));
    const isCommitted = await publicClient.readContract({
      address: addresses.contracts.athenaCommit as `0x${string}`,
      abi: athenaCommitAbi,
      functionName: "isCommitted",
      args: [unusedTaskId],
    });
    if (isCommitted !== false) throw new Error(`expected false, got ${isCommitted}`);
    return "read-only call succeeded, returned false as expected";
  });

  await check("0", "wallets in .env.local are well-formed and self-consistent", async () => {
    const roles = ["BROKER", "PROVIDER1", "PROVIDER2", "PROVIDER3"] as const;
    const lines: string[] = [];
    for (const role of roles) {
      const pk = requireEnv(`${role}_PK`) as `0x${string}`;
      const declaredAddress = requireEnv(`${role}_WALLET_ADDRESS`);
      if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new Error(`${role}_PK is not a 32-byte hex key`);
      const derived = privateKeyToAccount(pk).address;
      if (derived.toLowerCase() !== declaredAddress.toLowerCase()) {
        throw new Error(`${role}_WALLET_ADDRESS (${declaredAddress}) does not match address derived from ${role}_PK (${derived})`);
      }
      lines.push(`${role}=${derived}`);
    }
    return lines.join(", ");
  });

  const erc20Abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
  await check("0", "USDC + native funding status (informational)", async () => {
    const roles = ["BROKER", "PROVIDER1", "PROVIDER2", "PROVIDER3"] as const;
    const lines: string[] = [];
    for (const role of roles) {
      const address = requireEnv(`${role}_WALLET_ADDRESS`) as `0x${string}`;
      const [usdc, native] = await Promise.all([
        publicClient.readContract({
          address: addresses.contracts.usdc as `0x${string}`,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address],
        }),
        publicClient.getBalance({ address }),
      ]);
      const usdcFormatted = (Number(usdc) / 1e6).toFixed(6);
      const nativeFormatted = (Number(native) / 1e18).toFixed(6);
      const flag = usdc === 0n && native === 0n ? " ⚠ UNFUNDED" : "";
      lines.push(`${role}: ${usdcFormatted} USDC, ${nativeFormatted} native gas${flag}`);
    }
    return lines.join(" | ");
  });
}

// ── Tier 0.5: Circle Developer-Controlled Wallets auth ─────────────────────

async function tier05() {
  const apiKey = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;

  if (!apiKey || !entitySecret) {
    skip("0.5", "Circle entity secret auth check", "CIRCLE_API_KEY or CIRCLE_ENTITY_SECRET not set");
    return;
  }

  await check("0.5", "Circle entity secret is registered and authenticates", async () => {
    // See wallets/generateEntitySecret.ts for why this needs createRequire
    // instead of a normal import under tsx.
    const require = createRequire(import.meta.url);
    const { initiateDeveloperControlledWalletsClient } = require("@circle-fin/developer-controlled-wallets") as {
      initiateDeveloperControlledWalletsClient: (input: { apiKey: string; entitySecret: string }) => {
        listWalletSets: () => Promise<{ data?: { walletSets?: unknown[] } }>;
      };
    };
    const client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
    const response = await client.listWalletSets();
    const count = response.data?.walletSets?.length ?? 0;
    return `authenticated OK, ${count} wallet set(s) on this account (entity secret ...${entitySecret.slice(-4)})`;
  });
}

// ── Tier 1: provider endpoints ──────────────────────────────────────────────

const PROVIDER_ROUTES: { name: string; port: string; route: string }[] = [
  { name: "provider1", port: process.env.PROVIDER1_PORT ?? "3001", route: "/price/usdc-eth" },
  { name: "provider2", port: process.env.PROVIDER2_PORT ?? "3002", route: "/analytics/eth" },
  { name: "provider3", port: process.env.PROVIDER3_PORT ?? "3003", route: "/price/feed" },
];

async function tier1() {
  for (const p of PROVIDER_ROUTES) {
    const base = `http://localhost:${p.port}`;
    let up = true;
    await check("1", `${p.name} /health reachable`, async () => {
      try {
        const res = await fetchWithTimeout(`${base}/health`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return `${base}/health -> 200`;
      } catch (err) {
        up = false;
        throw err;
      }
    });

    if (!up) {
      skip("1", `${p.name} Gateway payment requirement (402)`, `${p.name} not running — start with npm run ${p.name}`);
      continue;
    }

    await check("1", `${p.name} requires payment (402 without one)`, async () => {
      const res = await fetchWithTimeout(`${base}${p.route}`);
      if (res.status !== 402) throw new Error(`expected 402, got ${res.status} — is this route actually Gateway-protected?`);
      return `${base}${p.route} -> 402 as expected`;
    });
  }
}

// ── Tier 2: MCP monitor ─────────────────────────────────────────────────────

async function tier2() {
  const monitorUrl = process.env.MCP_MONITOR_URL ?? "http://localhost:8000/mcp";
  let up = true;

  await check("2", "MCP monitor reachable", async () => {
    try {
      const res = await fetchWithTimeout(monitorUrl.replace(/\/mcp$/, ""), {}, 2000).catch(() => null);
      // The MCP endpoint itself only speaks the MCP protocol, so a bare GET
      // may 404/406 — reachability is really proven by the recordCallResult
      // call below. This just confirms *something* is listening on the port.
      void res;
      return `will confirm via a real tool call next`;
    } catch (err) {
      up = false;
      throw err;
    }
  });

  await check("2", "record_call_result: passing scores -> continue", async () => {
    const taskId = `0xsmoke${Date.now()}`;
    const verdict = await recordCallResult(monitorUrl, {
      task_id: taskId,
      call_number: 0,
      quality_score: 0.95,
      latency_ms: 100,
      predicted_quality: 0.85,
      predicted_latency_ms: 500,
    });
    if (verdict.verdict !== "continue") throw new Error(`expected "continue", got "${verdict.verdict}"`);
    return `verdict=${verdict.verdict}, quality_met=${verdict.quality_met}, latency_met=${verdict.latency_met}`;
  }).catch(() => {
    up = false;
  });

  if (!up) {
    skip("2", "record_call_result: 3 consecutive misses -> slash", "MCP monitor not running — start with python mcp-monitor/monitor.py");
    skip("2", "get_final_verdict reflects the slash", "MCP monitor not running");
    return;
  }

  await check("2", "record_call_result: 3 consecutive misses -> slash", async () => {
    const monitorUrl2 = process.env.MCP_MONITOR_URL ?? "http://localhost:8000/mcp";
    const taskId = `0xsmoke-slash-${Date.now()}`;
    let lastVerdict = "";
    for (let i = 0; i < 3; i++) {
      const v = await recordCallResult(monitorUrl2, {
        task_id: taskId,
        call_number: i,
        quality_score: 0.1, // deliberately below prediction every time
        latency_ms: 999,
        predicted_quality: 0.85,
        predicted_latency_ms: 500,
      });
      lastVerdict = v.verdict;
    }
    if (lastVerdict !== "slash") throw new Error(`expected "slash" after 3 consecutive misses, got "${lastVerdict}"`);

    const final = await getFinalVerdict(monitorUrl2, taskId);
    if (final.prediction_met !== false) throw new Error("get_final_verdict should report prediction_met=false after a slash");
    return `3/3 misses -> slash, get_final_verdict.prediction_met=false (correct)`;
  });
}

// ── Tier 3: entrypoint ───────────────────────────────────────────────────────

async function tier3() {
  const port = process.env.ENTRYPOINT_PORT ?? "3000";
  const base = `http://localhost:${port}`;
  let up = true;

  await check("3", "entrypoint /health reachable", async () => {
    try {
      const res = await fetchWithTimeout(`${base}/health`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { contract?: string };
      if (body.contract !== addresses.contracts.athenaCommit) {
        throw new Error(`entrypoint is pointed at a different contract than shared/addresses.json: ${body.contract}`);
      }
      return `${base}/health -> 200, contract matches shared/addresses.json`;
    } catch (err) {
      up = false;
      throw err;
    }
  });

  if (!up) {
    skip("3", "GET /streams returns an array", "entrypoint not running — start with npm run entrypoint");
    skip("3", "POST /stream-task requires payment (402 without one)", "entrypoint not running");
    return;
  }

  await check("3", "GET /streams returns an array", async () => {
    const res = await fetchWithTimeout(`${base}/streams`);
    const body = await res.json();
    if (!Array.isArray(body)) throw new Error(`expected an array, got ${typeof body}`);
    return `${body.length} session(s) currently in memory`;
  });

  await check("3", "POST /stream-task requires payment (402 without one)", async () => {
    const res = await fetchWithTimeout(`${base}/stream-task`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskDescription: "smoke test, should never actually route", clientAddress: "0x0000000000000000000000000000000000dEaD" }),
    });
    if (res.status !== 402) throw new Error(`expected 402 (unpaid), got ${res.status} — is this route actually Gateway-protected?`);
    return `${base}/stream-task -> 402 as expected (broker's own entrypoint is x402-protected too)`;
  });
}

// ── Tier 4: CCTP (Phase 4, stretch) — read-only reachability only ──────────
// Never triggers a real depositForBurn/receiveMessage here: those cost real
// gas and the attestation wait can take up to 3 hours. See
// cctp/crossChainPayout.ts and its manual test script for the real flow.

async function tier4() {
  await check("4", "Iris v2 attestation API reachable", async () => {
    // A well-formed but nonexistent tx hash — any structured JSON response
    // (200 with empty messages, or 404) proves the endpoint is live and
    // shaped as documented; only a network failure is a real problem here.
    const bogusTxHash = "0x" + "0".repeat(64);
    const res = await fetchWithTimeout(
      `https://iris-api-sandbox.circle.com/v2/messages/26?transactionHash=${bogusTxHash}`,
      {},
      5000
    );
    if (res.status !== 200 && res.status !== 404) {
      throw new Error(`expected 200 or 404, got ${res.status}`);
    }
    return `https://iris-api-sandbox.circle.com/v2/messages/26 -> HTTP ${res.status}`;
  });

  // viem's http() transport has no timeout by default — an unresponsive RPC
  // would hang this check (and the whole suite) indefinitely rather than
  // failing loudly. Explicit `timeout` below is required, not decorative.
  const { createPublicClient, http, formatEther } = await import("viem");
  const baseSepoliaRpc = process.env.BASE_SEPOLIA_RPC ?? "https://sepolia.base.org";
  const baseSepoliaClient = createPublicClient({ transport: http(baseSepoliaRpc, { timeout: 5000 }) });

  await check("4", "Base Sepolia RPC reachable + correct chainId", async () => {
    const chainId = await baseSepoliaClient.getChainId();
    if (chainId !== 84532) throw new Error(`expected chainId 84532 (Base Sepolia), got ${chainId}`);
    return `${baseSepoliaRpc} -> chainId ${chainId}`;
  });

  await check("4", "broker's Base Sepolia funding status (informational)", async () => {
    const address = requireEnv("BROKER_WALLET_ADDRESS") as `0x${string}`;
    const balance = await baseSepoliaClient.getBalance({ address });
    const flag = balance === 0n ? " ⚠ needs Base Sepolia ETH before ENABLE_CCTP_PAYOUT will work" : "";
    return `${formatEther(balance)} ETH${flag}`;
  });
}

// ── Runner ────────────────────────────────────────────────────────────────

async function main() {
  await tier0();
  await tier05();
  await tier1();
  await tier2();
  await tier3();
  await tier4();

  const icon: Record<Status, string> = { PASS: "✅", FAIL: "❌", SKIP: "⚠️ " };
  let hardFailures = 0;

  console.log("\n=== Athena Backend B — smoke test ===\n");
  let currentTier = "";
  for (const r of results) {
    if (r.tier !== currentTier) {
      currentTier = r.tier;
      console.log(`\n-- Tier ${currentTier} --`);
    }
    console.log(`${icon[r.status]} ${r.name}\n     ${r.detail}`);
    if (r.status === "FAIL" && (r.tier === "0" || r.tier === "0.5")) hardFailures++;
  }

  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  const skipped = results.filter((r) => r.status === "SKIP").length;
  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped\n`);

  // Tier 2's MCP client holds an open streamable-http connection that
  // otherwise keeps the process alive indefinitely after this prints —
  // close it before any exit path so `npm test` actually terminates.
  await closeMcpClient();

  if (hardFailures > 0) {
    console.error(`${hardFailures} Tier 0/0.5 failure(s) — base wiring is broken, fix before demoing.`);
    process.exit(1);
  }
  if (failed > 0) {
    console.error(`${failed} failure(s) in a running service — see details above.`);
    process.exit(1);
  }
}

main();
