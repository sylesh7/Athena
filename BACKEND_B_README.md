# Athena — Backend B README
### Owner: Payments, Stream Loop, Agents & Broker Logic
**You own:** `backend/stream/`, `backend/agents/`, `backend/mcp-monitor/`, `backend/cctp/`
You depend on Backend A's deployed contract + ABI (`shared/`). Never hardcode an address — always read from `shared/addresses.json`.

**No agent framework.** Athena's broker logic is deterministic (discover → score → select → commit → stream), so it's written as plain TypeScript, not built on Mastra or any other agent framework. The Circle Agent Wallet is Athena's identity and payment account — it is not a substitute for a framework and doesn't need one on top of it. This also sidesteps the Mastra supply-chain risk entirely (140+ `@mastra` packages were backdoored in a June 17, 2026 npm attack).

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

---

## PHASE 1 — Agent wallets & provider setup

### Phase 1.1 — Autonomous broker wallet setup (the demo's opening moment)

Athena sets up its own broker wallet autonomously. This is a genuine agentic sophistication moment — no human writes integration code:

```bash
# In your terminal, or as the first step of Athena's broker startup script:
curl -sL https://agents.circle.com/skills/setup.md
# Follow the returned instructions — this installs Circle CLI, creates an agent wallet,
# funds it, and deposits into Gateway. Your coding agent (Claude/Cursor) can run this autonomously.
```

For programmatic setup in Athena's broker startup script:
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

Athena's `discoverProviders()` step calls this directly via the Circle SDK (or shells out to the CLI) to get live provider metadata before scoring and selecting.

### Phase 2.4 — Wait for Backend A's handoff (H4)
Once Backend A deploys and pushes `shared/addresses.json` + ABI, pull them in:
```js
import addresses from "../../shared/addresses.json";
import athenaCommitAbi from "../../shared/abis/AthenaCommit.json";
// Never hardcode addresses
```

Test that you can read the contract — call `commitments(taskId)` for a dummy taskId, expect zeros back. Proves ABI + address wiring works before you build the real flow.

---

## PHASE 3 — Stream loop, broker logic, MCP monitor

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

**Implemented** in `backend/stream/streamLoop.ts` — read that file, not pseudocode here; it was written against the real published `.d.ts` for `@circle-fin/x402-batching@3.2.0` after two mistakes were found in an earlier draft of this section:

1. `GatewayClient`'s real constructor is `{ chain: 'arcTestnet', privateKey }`, not `{ walletAddress, chain: "ARC-TESTNET" }`. The paid-fetch method is `.pay(url)`, which reads the price from the resource's 402 challenge automatically — there is no `.fetchWithPayment(url, { maxPaymentAmount })` method and no per-call amount to pass.
2. `AthenaCommit.reveal(taskId, predictionMet, revealedHash, deliverableHash)` already settles any linked ERC-8183 job atomically inside the same call (see `contracts/src/AthenaCommit.sol`'s `_settleERC8183`). There is no separate `ERC8183.complete()`/`reject()` call to make afterward — passing `erc8183JobId: bytes32(0)` at `commit()` time (the current default, see H2 handoff notes) skips ERC-8183 entirely.

High-level flow (see the real file for the exact code):
1. Build the structured decision object (taskId, selected provider, predicted quality/latency, confidence, nonce, timestamp) and SHA-256 it as canonical JSON.
2. Approve the bond, then `commit()`.
3. Loop up to `maxCalls` times: `gatewayClient.pay(providerUrl)`, report the result to the MCP monitor via `mcp-monitor/client.ts`, stop early on a `"slash"` verdict.
4. Ask the monitor for the final verdict and `reveal()` once — the contract handles bond settlement (and ERC-8183, if linked) in that same call.

### Phase 3.3 — Broker routing logic (deterministic, no framework)

Athena's routing decision is discover → score → select → predict. That's a plain function pipeline, not an LLM reasoning loop, so it's written as plain TypeScript. The Circle Agent Wallet (Phase 1.1) is Athena's identity and payment layer — this is just the decision logic that sits on top of it. No `npm install mastra` needed.

```js
// backend/agents/broker.ts

async function discoverProviders(category: string) {
  // circle services list --chain ARC-TESTNET --output json
  const providers = await execCircleCLI(`services list --chain ARC-TESTNET --output json`);
  return JSON.parse(providers);
}

async function scoreProviders(providers: Provider[]) {
  // Score by ERC-8004 reputation + price + endpoint count
  return Promise.all(
    providers.map(async (p) => {
      const reputation = await readErc8004Reputation(p.address); // ReputationRegistry.readAllFeedback
      const score = weightedScore({ reputation, price: p.price, endpointCount: p.endpointCount });
      return { ...p, reputation, score };
    })
  );
}

function selectProvider(scored: ScoredProvider[]) {
  return scored.reduce((best, p) => (p.score > best.score ? p : best));
}

function predictOutcome(selected: ScoredProvider) {
  // Falsifiable, checkable prediction — derived from the provider's own historical
  // averages, not LLM prose, so the bond is a real bet rather than a guess.
  return {
    predictedQualityScore: selected.reputation.avgQuality ?? 0.85,
    predictedLatencyMs: selected.reputation.avgLatencyMs ?? 500,
    confidenceScore: selected.reputation.sampleSize > 5 ? 0.9 : 0.6,
  };
}

export async function routeTask(task: { taskDescription: string; category: string }) {
  const providers = await discoverProviders(task.category);
  const scored = await scoreProviders(providers);
  const selected = selectProvider(scored);
  const prediction = predictOutcome(selected);

  return { selectedProvider: selected, ...prediction };
}
```

### Phase 3.4 — Wire x402 entry point

```js
// backend/stream/entrypoint.ts — the Gateway-protected route clients hit
```

**Implemented** in `backend/stream/entrypoint.ts`. `POST /stream-task` is itself Gateway-protected (`gateway.require("$0.01")`); it validates the body with zod, calls `routeTask()`, computes `taskId` with the agreed scheme, and fires `runStream()` in the background rather than awaiting the whole stream inline — the response comes back as soon as a `taskId` exists, and the caller polls the status endpoint below for progress. Request body: `{ taskDescription, clientAddress, category?, bondAmountUsdc?, maxCalls? }`.

### Phase 3.5 — Status endpoint for Frontend (H7, H8)

**Implemented**: `GET /stream-status/:taskId` in `backend/stream/entrypoint.ts`, backed by the in-memory store in `backend/stream/state.ts`:

```ts
{
  taskId, phase,              // "committing" | "streaming" | "revealed" | "settled" | "failed"
  callsCompleted, lastQualityScore, lastLatencyMs,
  predictionMet,              // null until revealed
  bondStatus,                 // "posted" | "released" | "slashed" | null
  commitTxHash, revealTxHash, error,
}
```

`GET /streams` lists every session (newest first) for the Dashboard page. Note the store is in-memory per-process — an entrypoint restart loses in-flight progress, though on-chain commit/reveal state is unaffected since that lives in AthenaCommit itself.

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
