/**
 * test/smoke.ts — single-file completion check for Backend B.
 *
 * Real checks against real state, not mocks:
 *   Tier 0   config/chain wiring — always runs, no other process needed
 *   Tier 0.5 Circle Developer-Controlled Wallets auth — real API call
 *   Tier 1   provider endpoints (needs `npm run provider1/2/3` running)
 *   Tier 2   MCP monitor (needs `python mcp-monitor/monitor.py` running)
 *   Tier 3   entrypoint (needs `npm run entrypoint` running)
 *   Tier 4   CCTP reachability — read-only, never a real burn/mint
 *   Tier 5   a REAL live end-to-end stream, happy path — opt-in only
 *            (RUN_LIVE_E2E=true + TEST_CLIENT_PK), since unlike every other
 *            tier this actually spends real testnet USDC/gas.
 *   Tier 6   a REAL live end-to-end stream, forced SLASH path — opt-in only
 *            (RUN_LIVE_SLASH_TEST=true + TEST_CLIENT_PK). Uses
 *            /stream-task's testOverride to deliberately set an unmeetable
 *            predicted latency, so the resulting real on-chain slash is
 *            honest, not faked — see tier6()'s own comment for why this
 *            exists (Tier 5 alone never proves the slash path works).
 *
 * Tier 0/0.5 failures are hard failures (exit 1) — they mean the base
 * wiring is broken regardless of what's running. Tier 1-6 report SKIP
 * with instructions if that process isn't up (or, for Tier 5/6, if they
 * weren't explicitly opted into), rather than failing the whole run, since
 * this is meant to be runnable before every service is started.
 *
 * Usage: npm test
 *        RUN_LIVE_E2E=true TEST_CLIENT_PK=0x... npm test        (+ Tier 5)
 *        RUN_LIVE_SLASH_TEST=true TEST_CLIENT_PK=0x... npm test (+ Tier 6)
 */

import "../lib/config.js";
import { createRequire } from "node:module";
import { encodePacked, keccak256, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { addresses, athenaCommitAbi } from "../lib/config.js";
import { publicClient, requireEnv } from "../lib/chain.js";
import { closeMcpClient, getFinalVerdict, recordCallResult } from "../mcp-monitor/client.js";
import { DECISION_PREIMAGE_FIELDS } from "../stream/streamLoop.js";
import { GatewayClient } from "@circle-fin/x402-batching/client";

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

  await check("0", "decisionObj field list matches expected (drift guard)", async () => {
    const expected = [
      "confidenceScore",
      "nonce",
      "predictedLatencyMs",
      "predictedQualityScore",
      "selectedProvider",
      "selectedProviderUrl",
      "taskId",
      "timestamp",
    ];
    const actual = [...DECISION_PREIMAGE_FIELDS];
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(
        `streamLoop.ts's DECISION_PREIMAGE_FIELDS changed (now: ${actual.join(", ")}) — if intentional, update ` +
          `this test's expected array AND AthenaCommit.sol's commit() NatSpec comment together.`
      );
    }
    return `${actual.length} fields locked: ${actual.join(", ")}`;
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

  await check("0", "broker wallet (plain EOA) is well-formed and self-consistent", async () => {
    const pk = requireEnv("BROKER_PK") as `0x${string}`;
    const declaredAddress = requireEnv("BROKER_WALLET_ADDRESS");
    if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new Error("BROKER_PK is not a 32-byte hex key");
    const derived = privateKeyToAccount(pk).address;
    if (derived.toLowerCase() !== declaredAddress.toLowerCase()) {
      throw new Error(`BROKER_WALLET_ADDRESS (${declaredAddress}) does not match address derived from BROKER_PK (${derived})`);
    }
    return `BROKER=${derived} (raw PK — required for GatewayClient.pay(), which can't use Circle custody)`;
  });

  await check("0", "provider wallets (Circle-custodied) have valid addresses", async () => {
    // Providers never sign anything (createGatewayMiddleware only needs an
    // address to receive payment at), so unlike the broker there's no
    // private key to cross-check here — these are real Circle
    // Developer-Controlled Wallets, see wallets/setupCircleProviders.ts.
    const { isAddress } = await import("viem");
    const lines: string[] = [];
    for (const role of ["PROVIDER1", "PROVIDER2", "PROVIDER3"] as const) {
      const address = requireEnv(`${role}_WALLET_ADDRESS`);
      const walletId = process.env[`${role}_WALLET_ID`];
      if (!isAddress(address)) throw new Error(`${role}_WALLET_ADDRESS (${address}) is not a valid checksummed address`);
      if (!walletId) throw new Error(`${role}_WALLET_ID is not set — was wallets:circle-providers run?`);
      lines.push(`${role}=${address}`);
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

  // Holding USDC in the broker's wallet is NOT the same as having it
  // deposited into Circle Gateway — GatewayClient.pay() (what streamLoop.ts
  // uses per call) draws from the Gateway-custodied balance, not the plain
  // wallet balance already checked above. Previously this step only existed
  // as a printed CLI instruction in wallets/setup.ts, never actually
  // verified anywhere — so a missing deposit would only surface as a real
  // stream failing partway through, not as a test failure beforehand.
  await check("0", "broker's Circle Gateway deposit (not just wallet balance)", async () => {
    const brokerPk = requireEnv("BROKER_PK") as `0x${string}`;
    const gateway = new GatewayClient({ chain: "arcTestnet", privateKey: brokerPk });
    const balances = await gateway.getBalances();
    if (balances.gateway.available === 0n) {
      throw new Error(
        `Gateway available balance is 0 — every real stream will fail at GatewayClient.pay(). Run: ` +
          `circle gateway deposit --amount 10 --address ${gateway.address} --chain ARC-TESTNET --method direct`
      );
    }
    return `wallet=${balances.wallet.formatted} USDC, Gateway available=${balances.gateway.formattedAvailable} USDC`;
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
  const port = process.env.ENTRYPOINT_PORT ?? "3100";
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
  const baseSepoliaRpc = process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org"; // see crossChainPayout.ts comment on || vs ??
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

// ── Tier 5: a real live end-to-end stream — opt-in only, costs real funds ──
//
// Every other tier deliberately stops at the 402 challenge (see Tier 1/3) to
// avoid spending real testnet USDC/gas on every `npm test` run. That's the
// right default, but it also means no automated check in this file has ever
// proven a real commit -> stream -> reveal -> settle cycle actually
// completes — only a manual live run (H6) has. This tier closes that gap,
// but only when explicitly opted into: set RUN_LIVE_E2E=true and
// TEST_CLIENT_PK (a funded wallet, separate from the broker/providers, with
// USDC deposited into Gateway to pay the $0.01 /stream-task fee).

async function tier5() {
  if (process.env.RUN_LIVE_E2E !== "true") {
    skip(
      "5",
      "real end-to-end stream (commit -> stream -> reveal -> settle)",
      "opt-in only, costs real testnet funds — set RUN_LIVE_E2E=true and TEST_CLIENT_PK to run"
    );
    return;
  }

  const testClientPk = process.env.TEST_CLIENT_PK as `0x${string}` | undefined;
  if (!testClientPk) {
    skip("5", "real end-to-end stream", "RUN_LIVE_E2E=true but TEST_CLIENT_PK is not set");
    return;
  }

  const port = process.env.ENTRYPOINT_PORT ?? "3100";
  const base = `http://localhost:${port}`;

  let entrypointUp = true;
  try {
    const res = await fetchWithTimeout(`${base}/health`);
    if (!res.ok) entrypointUp = false;
  } catch {
    entrypointUp = false;
  }
  if (!entrypointUp) {
    skip("5", "real end-to-end stream", "entrypoint not running — start with npm run entrypoint");
    return;
  }

  await check("5", "real end-to-end stream (commit -> stream -> reveal -> settle)", async () => {
    const client = privateKeyToAccount(testClientPk);
    const gateway = new GatewayClient({ chain: "arcTestnet", privateKey: testClientPk });

    const { data } = await gateway.pay<{ taskId: `0x${string}`; statusUrl: string }>(`${base}/stream-task`, {
      method: "POST",
      body: {
        taskDescription: "smoke test tier 5 — real live end-to-end run",
        clientAddress: client.address,
      },
    });

    const taskId = data.taskId;
    if (!taskId) throw new Error("no taskId in /stream-task response");

    const deadline = Date.now() + 120_000; // 2 minutes — well past a normal stream's real duration
    let last: Record<string, unknown> | undefined;
    while (Date.now() < deadline) {
      const statusRes = await fetchWithTimeout(`${base}/stream-status/${taskId}`);
      last = (await statusRes.json()) as Record<string, unknown>;
      if (last?.phase === "settled" || last?.phase === "failed") break;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    if (!last || (last.phase !== "settled" && last.phase !== "failed")) {
      throw new Error(`stream ${taskId} did not reach a terminal phase within 2 minutes (last phase: ${last?.phase})`);
    }
    if (last.phase === "failed") {
      throw new Error(`stream ${taskId} failed: ${last.error}`);
    }
    // This is exactly the property the Critical fix (PENDING.md) exists to
    // guarantee — if these are ever missing on a settled stream, the seal/
    // reveal wiring in streamLoop.ts has regressed.
    if (!last.commitHash || !last.decisionPreimage) {
      throw new Error("stream settled but commitHash/decisionPreimage were never exposed — the reveal fix regressed");
    }

    return (
      `taskId=${taskId} settled: predictionMet=${last.predictionMet}, bondStatus=${last.bondStatus}, ` +
      `${last.callsCompleted} calls, commitHash+decisionPreimage present and externally verifiable`
    );
  });
}

// ── Tier 6: a real live end-to-end SLASH — opt-in only, costs real funds ──
//
// Tier 5 proves the happy path settles for real. It does NOT prove the
// slash path does, because our real providers report a steady qualityScore
// with reasonable latency — an organic run essentially never fails its own
// prediction. Without this, the only place "misses -> slash" was ever
// tested was Tier 2, against synthetic data fed directly to the MCP
// monitor — that proves the monitor's verdict *logic*, not a real
// commit -> bond -> reveal -> slash-to-client transfer on-chain.
//
// This forces a real slash honestly, not by faking anything: it uses
// /stream-task's testOverride to set predictedLatencyMs: 0 — no real HTTP
// round-trip (payment negotiation + provider response) can ever complete in
// 0ms, so every call genuinely, correctly fails to meet that (deliberately
// engineered) prediction. The resulting slash is real: real bond, real
// on-chain transfer to the client, real MCP monitor verdict — the only
// thing rigged is which number Athena predicted, same as Tier 5 rigs
// nothing and lets prediction be real.

async function tier6() {
  if (process.env.RUN_LIVE_SLASH_TEST !== "true") {
    skip(
      "6",
      "real end-to-end SLASH path (forced-impossible prediction)",
      "opt-in only, costs real testnet funds — set RUN_LIVE_SLASH_TEST=true and TEST_CLIENT_PK to run"
    );
    return;
  }

  const testClientPk = process.env.TEST_CLIENT_PK as `0x${string}` | undefined;
  if (!testClientPk) {
    skip("6", "real end-to-end SLASH path", "RUN_LIVE_SLASH_TEST=true but TEST_CLIENT_PK is not set");
    return;
  }

  const port = process.env.ENTRYPOINT_PORT ?? "3100";
  const base = `http://localhost:${port}`;

  let entrypointUp = true;
  try {
    const res = await fetchWithTimeout(`${base}/health`);
    if (!res.ok) entrypointUp = false;
  } catch {
    entrypointUp = false;
  }
  if (!entrypointUp) {
    skip("6", "real end-to-end SLASH path", "entrypoint not running — start with npm run entrypoint");
    return;
  }

  await check("6", "real end-to-end SLASH path (forced-impossible prediction -> bond slashed on-chain)", async () => {
    const client = privateKeyToAccount(testClientPk);
    const gateway = new GatewayClient({ chain: "arcTestnet", privateKey: testClientPk });

    const { data } = await gateway.pay<{ taskId: `0x${string}` }>(`${base}/stream-task`, {
      method: "POST",
      body: {
        taskDescription: "smoke test tier 6 — deliberately impossible prediction to force a real slash",
        clientAddress: client.address,
        maxCalls: 5,
        testOverride: { predictedLatencyMs: 0 },
      },
    });

    const taskId = data.taskId;
    if (!taskId) throw new Error("no taskId in /stream-task response");

    const deadline = Date.now() + 120_000;
    let last: Record<string, unknown> | undefined;
    while (Date.now() < deadline) {
      const statusRes = await fetchWithTimeout(`${base}/stream-status/${taskId}`);
      last = (await statusRes.json()) as Record<string, unknown>;
      if (last?.phase === "settled" || last?.phase === "failed") break;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    if (!last || (last.phase !== "settled" && last.phase !== "failed")) {
      throw new Error(`stream ${taskId} did not reach a terminal phase within 2 minutes (last phase: ${last?.phase})`);
    }
    if (last.phase === "failed") {
      throw new Error(`stream ${taskId} failed outright rather than settling with a slash: ${last.error}`);
    }
    if (last.predictionMet !== false) {
      throw new Error(`expected predictionMet=false (0ms latency prediction can never be met), got ${last.predictionMet}`);
    }
    if (last.bondStatus !== "slashed") {
      throw new Error(`expected bondStatus="slashed", got "${last.bondStatus}"`);
    }

    return (
      `taskId=${taskId} correctly SLASHED on-chain: predictionMet=false, bondStatus=slashed, ` +
      `revealTxHash=${last.revealTxHash}`
    );
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
  await tier5();
  await tier6();

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
