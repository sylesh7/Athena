# Athena — Backend B README
### Owner: Payments, Stream Loop, Agents & Orchestration
**You own:** `backend/stream/`, `backend/agents/`, `backend/mcp-monitor/`, `backend/cctp/`
You depend on Backend A's deployed contract + ABI (`shared/`). Never hardcode an address — always read from `shared/addresses.json`.

---

## 0. Your setup checklist (Day 1)

- [ ] MetaMask wallet, Arc Testnet: chainId `5042002`, RPC from `arc-canteen rpc-url`
- [ ] Testnet USDC from `faucet.circle.com`
- [ ] Node.js 22+ (v20.18.2+ minimum for Circle CLI)
- [ ] Circle CLI: `npm install -g @circle-fin/cli`
- [ ] Canteen CLI: `uv tool install git+https://github.com/the-canteen-dev/ARC-cli` + `arc-canteen login`
- [ ] Circle Developer account → API key (format `PREFIX:ID:SECRET` — shown once, save immediately)
- [ ] Entity Secret: generate + register via `@circle-fin/developer-controlled-wallets` (saves recovery file — store it safely)
- [ ] `npm install @circle-fin/developer-controlled-wallets` (v10.6.0+)
- [ ] Python 3.10+ for MCP monitor
- [ ] `pip install "mcp[cli]"` (v1.x — MCP v2 not until July 28, 2026)

---

## 0.1 Critical facts

**`circle services pay` has NO loop/stream mode.** One payment per invocation. No `--loop`, `--stream`, `--repeat` flag exists. You implement the stream loop yourself using `GatewayClient` + `fetchWithPayment` from `@circle-fin/x402-batching/client` in application code. This is confirmed — don't waste time searching for a CLI loop flag.

**USDC on Arc — 6-decimal ERC-20 only for amounts.** The 18-decimal native interface is gas only. All Gateway deposits, payment amounts, and bond amounts are 6-decimal.

**Agent wallet Gateway balance ≠ wallet balance.** To make gasless x402 nanopayments via Gateway, the agent wallet needs USDC deposited specifically INTO Gateway, not just held in the wallet. `circle gateway deposit --amount 10 --address $WALLET --chain ARC-TESTNET --method direct` before making any x402 calls.

**Mastra supply-chain warning.** June 17, 2026 npm attack backdoored 140+ `@mastra` packages. Pin exact versions. Verify lockfile before `npm install`.

---

## PHASE 1 — Agent wallets & provider setup

### Phase 1.1 — Autonomous broker wallet setup (the demo's opening moment)

Athena sets up its own broker wallet autonomously. This is a genuine agentic sophistication moment — no human writes integration code:

```bash
# In your terminal, or as the first step of your Mastra orchestration:
curl -sL https://agents.circle.com/skills/setup.md
# Follow the returned instructions — this installs Circle CLI, creates an agent wallet,
# funds it, and deposits into Gateway. Your coding agent (Claude/Cursor) can run this autonomously.
```

For programmatic setup in your Mastra workflow:
```js
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

const client = initiateDeveloperControlledWalletsClient({
  apiKey: process.env.CIRCLE_API_KEY,
  entitySecret: process.env.CIRCLE_ENTITY_SECRET,
});

// Create wallet set
const walletSet = await client.createWalletSet({ name: "athena-agents" });

// Create broker + 3 provider wallets
const wallets = await client.createWallets({
  walletSetId: walletSet.data.walletSet.id,
  blockchains: ["ARC-TESTNET"],
  count: 4,  // broker + 3 providers
  accountType: "EOA",
});

// Fund each from faucet
// circle wallet fund --address $WALLET --chain ARC-TESTNET
// circle gateway deposit --amount 10 --address $WALLET --chain ARC-TESTNET --method direct
```

### Phase 1.2 — Define provider agent roles
Decide your 3 provider roles now — they become the x402 services Athena routes between:
- Provider 1: Crypto price data (e.g. USDC/ETH real-time prices)
- Provider 2: Market analytics (e.g. 24h volume, market cap)
- Provider 3: Price feed aggregation

These roles inform the metadata you give Backend A for ERC-8004 registration, and the endpoint categories you submit to Circle's marketplace.

### Phase 1.3 — Submit provider agents to Circle Marketplace
Do this Day 1 — approval takes time:
- Go to `forms.gle/7YFzvdmMcn1JH5tF6`
- Submit each provider endpoint with its x402 URL, category, price, and description
- Category: Financial Analysis (matches what's already on `agents.circle.com/services`)

### Phase 1.4 — Phase 1 sync with team (H1, H2, H3)
- Give Backend A your 3 provider wallet addresses + roles → they need for ERC-8004 registration
- Get `commit()`/`reveal()` function signatures from Backend A
- **Agree `taskId` generation scheme right now:** `keccak256(abi.encodePacked(clientAddress, taskDescription, blockNumber))` — byte-for-byte identical on both sides

---

## PHASE 2 — x402 provider endpoints + Gateway setup

### Phase 2.1 — Build provider agent endpoints

Each provider is a Gateway-protected Express endpoint. Use `@circle-fin/x402-batching`:

```bash
npm install @circle-fin/x402-batching express
```

```js
// backend/agents/provider1.ts — crypto price provider
import express from "express";
import { createGatewayMiddleware } from "@circle-fin/x402-batching/server";

const app = express();

const gateway = createGatewayMiddleware({
  sellerAddress: process.env.PROVIDER1_WALLET_ADDRESS,
  // facilitatorUrl defaults to Circle's hosted Arc testnet facilitator:
  // https://gateway-api-testnet.circle.com
  // network: "eip155:5042002" is inferred from ARC-TESTNET
});

// Each call costs $0.000001 USDC — nanopayment per data point
app.get("/price/usdc-eth", gateway.require("$0.000001"), async (req, res) => {
  // Return actual price data — fetch from a free public API
  const price = await fetchUSDCETHPrice();
  res.json({
    pair: "USDC/ETH",
    price,
    timestamp: Date.now(),
    latencyMs: Date.now() - req.startTime,
    qualityScore: 1.0  // always return this so MCP monitor can evaluate
  });
});

app.listen(3001);
```

Build Provider 2 (port 3002) and Provider 3 (port 3003) the same way with different endpoints and data.

⚠️ Verify `@circle-fin/x402-batching/server` export names against Circle's live blog (`circle.com/blog/turn-your-api-into-a-storefront-for-agents`) before copy-pasting — pre-1.0 package, internals can shift.

### Phase 2.2 — Verify provider endpoints work
```bash
# Unpaid request should return 402:
curl -i http://localhost:3001/price/usdc-eth

# Paid request via Circle CLI:
circle services pay http://localhost:3001/price/usdc-eth \
  --address $PROVIDER1_WALLET_ADDRESS \
  --chain ARC-TESTNET \
  -X GET \
  --max-amount 0.000001 \
  --output json

# Confirm payment landed on Arcscan
```

### Phase 2.3 — Provider marketplace discovery via Circle CLI
This is how Athena discovers providers programmatically — not by hardcoding URLs:
```bash
circle services list --chain ARC-TESTNET
# Returns available x402 services including yours once listed
```

In your Mastra workflow, Athena calls this as a shell tool or via the Circle SDK to get live provider metadata before making routing decisions.

### Phase 2.4 — Wait for Backend A's handoff (H4)
Once Backend A deploys and pushes `shared/addresses.json` + ABI, pull them in:
```js
import addresses from "../../shared/addresses.json";
import athenaCommitAbi from "../../shared/abis/AthenaCommit.json";
// Never hardcode addresses
```

Test that you can read the contract — call `commitments(taskId)` for a dummy taskId, expect zeros back. Proves ABI + address wiring works before you build the real flow.

---

## PHASE 3 — Stream loop, Mastra orchestration, MCP monitor

### Phase 3.1 — MCP quality monitor (Python FastMCP)

The MCP monitor is the stream's health checker. It runs alongside the stream loop and decides whether to continue or slash:

```bash
pip install "mcp[cli]"   # v1.x — do NOT use v2, not stable until July 28
```

```python
# backend/mcp-monitor/monitor.py
from mcp.server.fastmcp import FastMCP
import time

mcp = FastMCP("athena-stream-monitor", json_response=True)

# Running stats tracked in memory per stream session
stream_stats = {}

@mcp.tool()
def record_call_result(
    task_id: str,
    call_number: int,
    quality_score: float,    # 0.0 to 1.0 from provider response
    latency_ms: int,
    predicted_quality: float, # from Athena's committed prediction
    predicted_latency_ms: int
) -> dict:
    """Record one provider call result and return stream health verdict."""
    if task_id not in stream_stats:
        stream_stats[task_id] = {"consecutive_failures": 0, "total_calls": 0}

    stats = stream_stats[task_id]
    stats["total_calls"] += 1

    quality_met = quality_score >= predicted_quality
    latency_met = latency_ms <= predicted_latency_ms

    if quality_met and latency_met:
        stats["consecutive_failures"] = 0
        verdict = "continue"
    else:
        stats["consecutive_failures"] += 1
        verdict = "slash" if stats["consecutive_failures"] >= 3 else "continue"

    return {
        "task_id": task_id,
        "call_number": call_number,
        "quality_met": quality_met,
        "latency_met": latency_met,
        "consecutive_failures": stats["consecutive_failures"],
        "verdict": verdict,  # "continue" or "slash"
        "prediction_met_overall": verdict != "slash"
    }

@mcp.tool()
def get_final_verdict(task_id: str) -> dict:
    """Get the final prediction_met bool to pass to AthenaCommit.reveal()."""
    stats = stream_stats.get(task_id, {})
    return {
        "task_id": task_id,
        "prediction_met": stats.get("consecutive_failures", 0) < 3,
        "total_calls": stats.get("total_calls", 0)
    }

if __name__ == "__main__":
    mcp.run(transport="streamable-http")
    # runs on http://localhost:8000 by default
```

### Phase 3.2 — The stream loop (core of Backend B)

This is the most important piece you build. No CLI loop flag exists — you implement it:

```js
// backend/stream/streamLoop.ts
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { createPublicClient, createWalletClient, http } from "viem";
import addresses from "../../shared/addresses.json";
import athenaCommitAbi from "../../shared/abis/AthenaCommit.json";

interface StreamConfig {
  taskId: `0x${string}`;
  providerUrl: string;
  predictedQuality: number;
  predictedLatencyMs: number;
  maxCalls: number;
  brokerWalletAddress: string;
  clientAddress: string;
  bondAmountUsdc: number; // in 6-decimal units e.g. 1000000 = 1 USDC
}

export async function runStream(config: StreamConfig) {
  const gatewayClient = new GatewayClient({
    walletAddress: config.brokerWalletAddress,
    chain: "ARC-TESTNET",
  });

  // 1. Compute structured decision object — deterministic, not LLM prose
  const decision = {
    taskId: config.taskId,
    selectedProvider: config.providerUrl,
    predictedQualityScore: config.predictedQuality,
    predictedLatencyMs: config.predictedLatencyMs,
    confidenceScore: 0.85, // computed by Mastra agent
    nonce: crypto.randomUUID(),
    timestamp: Date.now(),
  };

  // 2. SHA-256 hash of canonical JSON string (field order must be deterministic)
  const canonicalJson = JSON.stringify(decision, Object.keys(decision).sort());
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson));
  const commitHash = "0x" + Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("") as `0x${string}`;

  // 3. Approve USDC + call commit() on AthenaCommit.sol
  // (approve config.bondAmountUsdc to athenaCommit contract first)
  const txHash = await brokerWalletClient.writeContract({
    address: addresses.contracts.athenaCommit as `0x${string}`,
    abi: athenaCommitAbi,
    functionName: "commit",
    args: [config.taskId, commitHash, BigInt(config.bondAmountUsdc), config.clientAddress],
  });
  console.log("Committed on-chain:", txHash);

  // 4. Stream loop — GatewayClient.fetchWithPayment per call
  let predictionMet = true;
  for (let i = 0; i < config.maxCalls; i++) {
    const startTime = Date.now();
    try {
      const response = await gatewayClient.fetchWithPayment(
        `${config.providerUrl}?call=${i}`,
        { method: "GET", maxPaymentAmount: "0.000001" } // $0.000001 USDC per call
      );
      const data = await response.json();
      const latencyMs = Date.now() - startTime;

      // 5. Send result to MCP monitor
      const monitorResult = await callMcpMonitor("record_call_result", {
        task_id: config.taskId,
        call_number: i,
        quality_score: data.qualityScore ?? 1.0,
        latency_ms: latencyMs,
        predicted_quality: config.predictedQuality,
        predicted_latency_ms: config.predictedLatencyMs,
      });

      if (monitorResult.verdict === "slash") {
        predictionMet = false;
        console.log(`Stream stopping at call ${i} — quality dropped`);
        break;
      }
    } catch (err) {
      console.error(`Call ${i} failed:`, err);
      predictionMet = false;
      break;
    }
  }

  // 6. Reveal on-chain
  const revealTx = await brokerWalletClient.writeContract({
    address: addresses.contracts.athenaCommit as `0x${string}`,
    abi: athenaCommitAbi,
    functionName: "reveal",
    args: [config.taskId, predictionMet, commitHash], // same commitHash — proves no lying
  });
  console.log("Revealed on-chain:", revealTx, "predictionMet:", predictionMet);

  // 7. Call ERC-8183 complete() or reject() based on outcome
  if (predictionMet) {
    await brokerWalletClient.writeContract({
      address: addresses.contracts.erc8183 as `0x${string}`,
      abi: erc8183Abi,
      functionName: "complete",
      args: [jobId, "Stream completed successfully", "0x0000..."],
    });
  } else {
    await brokerWalletClient.writeContract({
      address: addresses.contracts.erc8183 as `0x${string}`,
      abi: erc8183Abi,
      functionName: "reject",
      args: [jobId, "Quality prediction not met", "0x0000..."],
    });
  }

  return { predictionMet, txHash, revealTx };
}
```

### Phase 3.3 — Mastra broker agent

```bash
npm install mastra @mastra/core
# ⚠️ Pin exact versions — check advisory for June 17, 2026 supply-chain attack before installing
```

```js
// backend/agents/broker.ts
import { Agent, createTool } from "@mastra/core";
import { z } from "zod";

const discoverProvidersTool = createTool({
  id: "discover-providers",
  description: "List available x402 provider agents from Circle Agent Marketplace",
  inputSchema: z.object({ category: z.string() }),
  execute: async ({ context }) => {
    // Call circle CLI: circle services list --chain ARC-TESTNET
    // Parse output and return provider list with prices + endpoint counts
    const providers = await execCircleCLI(`services list --chain ARC-TESTNET --output json`);
    return JSON.parse(providers);
  },
});

const evaluateProviderTool = createTool({
  id: "evaluate-provider",
  description: "Score a provider using ERC-8004 reputation history",
  inputSchema: z.object({ providerAddress: z.string() }),
  execute: async ({ context }) => {
    // Read ReputationRegistry for this provider's historical scores
    const reputation = await readErc8004Reputation(context.providerAddress);
    return reputation;
  },
});

export const athenabroker = new Agent({
  name: "Athena Broker",
  instructions: `You are Athena, a trust-minimized agent broker.
    Your job: discover available provider agents, select the best one for the task,
    make a falsifiable prediction about stream quality and latency, then commit that
    decision on-chain before acting. Your prediction must be specific and checkable —
    e.g. "quality above 0.85, latency under 500ms per call".
    Use arc-canteen context for up-to-date Arc and Circle documentation.`,
  model: { provider: "ANTHROPIC", name: "claude-sonnet-4-6" },
  tools: { discoverProvidersTool, evaluateProviderTool },
});
```

### Phase 3.4 — Wire x402 entry point

```js
// backend/stream/entrypoint.ts — the Gateway-protected route clients hit
import express from "express";
import { createGatewayMiddleware } from "@circle-fin/x402-batching/server";

const app = express();

const gateway = createGatewayMiddleware({
  sellerAddress: process.env.BROKER_WALLET_ADDRESS,
});

// Client pays once here to trigger a full stream session
app.post("/stream-task", gateway.require("$0.01"), async (req, res) => {
  const { taskDescription, clientAddress } = req.body;

  // Athena broker agent reasons about which provider to pick
  const brokerDecision = await athenabroker.generate(
    `Task: ${taskDescription}. Discover providers, pick the best, give me: selectedProviderUrl, predictedQualityScore (0-1), predictedLatencyMs, confidenceScore`
  );

  // Parse structured decision from agent output
  const decision = parseDecision(brokerDecision.text);

  // Generate taskId — byte-for-byte matches Backend A's scheme
  const taskId = keccak256(encodePacked(
    ["address", "string", "uint256"],
    [clientAddress, taskDescription, BigInt(await getBlockNumber())]
  ));

  // Run the stream
  const result = await runStream({
    taskId,
    providerUrl: decision.selectedProviderUrl,
    predictedQuality: decision.predictedQualityScore,
    predictedLatencyMs: decision.predictedLatencyMs,
    maxCalls: 100,
    brokerWalletAddress: process.env.BROKER_WALLET_ADDRESS,
    clientAddress,
    bondAmountUsdc: 1_000_000, // 1 USDC bond
  });

  res.json({ taskId, ...result });
});

app.listen(3000);
```

### Phase 3.5 — Status endpoint for Frontend (H7, H8)

Frontend needs live stream progress. Expose a simple SSE or polling endpoint:

```js
app.get("/stream-status/:taskId", (req, res) => {
  res.json({
    taskId: req.params.taskId,
    phase: currentPhase,        // "committed" | "streaming" | "revealed" | "settled"
    callsCompleted: callCount,
    lastQualityScore: lastScore,
    lastLatencyMs: lastLatency,
    predictionMet: finalVerdict, // null until revealed
    bondStatus: bondStatus,      // "posted" | "released" | "slashed"
    commitTxHash,
    revealTxHash,
  });
});
```

**Phase 3 exit criteria:** a single POST to `/stream-task` with a valid x402 payment triggers the full automated flow — Athena discovers providers, commits on-chain, streams nanopayments, MCP monitor evaluates, reveals, bond resolves — zero manual steps. Confirm together (H9).

---

## PHASE 4 — CCTP cross-chain payout (stretch)

Provider 3 lives on Base Sepolia. After a successful stream, Athena pays them natively on Base:

```js
// backend/cctp/crossChainPayout.ts
import { encodePacked, padHex } from "viem";

// After reveal confirms predictionMet=true for a stream involving Provider 3:
const recipient = padHex(provider3BaseAddress, { size: 32 }); // bytes32 format

await brokerWalletClient.writeContract({
  address: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA", // TokenMessengerV2 on Arc
  abi: tokenMessengerV2Abi,
  functionName: "depositForBurn",
  args: [
    BigInt(payoutAmount),  // 6-decimal USDC
    6,                     // Base destination domain — verify current CCTP V2 domain list
    recipient,
    "0x3600000000000000000000000000000000000000", // USDC on Arc
    "0x0000000000000000000000000000000000000000", // destinationCaller = anyone can relay
    0n,                    // maxFee
    1000,                  // Standard finality
  ],
});

// Then: poll Circle Iris attestation API for signed attestation
// Then: call receiveMessage on Base MessageTransmitterV2
// Timebox: 3 hours max. If destination mint doesn't complete live, show burn tx on Arcscan.
```

---

## Your handoff checklist

| When | What | To whom |
|---|---|---|
| Phase 1 | 3 provider wallet addresses + roles | Backend A (for ERC-8004), Frontend (for display) |
| Phase 1 | Agreed `taskId` scheme | Backend A |
| Phase 2 | x402 provider endpoints working (402→200 confirmed on Arcscan) | Frontend (so they know what to demo) |
| Phase 2.4 | Receive deployed contract address + ABI | From Backend A — don't build stream loop without this |
| Phase 2.5 | Confirm manual loop live together | Both |
| Phase 3.5 | Status endpoint/SSE for stream progress | Frontend |
| Phase 3 | Full automated stream confirmed live | Both |

## Things to re-verify if something feels off

- Stream payments not flowing → check Gateway balance is deposited (`circle gateway balance --address $WALLET --chain ARC-TESTNET`), not just wallet balance
- `commit()` reverts → check taskId encoding is byte-for-byte identical to Backend A's scheme
- Bond amount looks wrong → confirm you're passing 6-decimal units (1 USDC = `1_000_000`)
- MCP monitor not responding → check it's running on `streamable-http` not stdio transport
- `@circle-fin/x402-batching` exports don't match → check Circle's live blog, pre-1.0 package can shift
- Mastra install feels off → verify package integrity against the June 17 advisory before proceeding
