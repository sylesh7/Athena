# Backend A → Frontend Handoff
**From:** Backend A (Smart Contracts & Settlement — Sugan)
**To:** Frontend
**Date:** 2026-07-04
**Status:** All contract work done. Everything below is live on Arc Testnet.

---

## What Backend A Has Completed (Full Status)

### ✅ Phase 1 — Contracts Written & Compiled
- `contracts/src/AthenaCommit.sol` — full commit-reveal-slash bond contract, all functions public
- `contracts/src/interfaces/IERC8183.sol` — ERC-8183 job escrow interface (7 functions)
- `contracts/src/interfaces/IERC8004.sol` — IdentityRegistry, ReputationRegistry, ValidationRegistry interfaces
- `contracts/test/AthenaCommit.t.sol` — **29 unit tests, all passing** (`forge test -vvv`)
- `contracts/script/Deploy.s.sol` — deploy script
- `shared/addresses.json` — all Arc Testnet contract addresses populated
- Team synced on function signatures + taskId scheme

### ✅ Phase 2 — Deployed & Integrated on Arc Testnet
- **AthenaCommit deployed:** `0x1cFC54256F28C76891891a266c03AD8ceA63D416`
- **ABI exported** to `shared/abis/AthenaCommit.json` (valid JSON array — safe to import)
- **Integration test PASSED** on live Arc Testnet:
  - `commit()` → tx confirmed on-chain
  - `reveal(predictionMet=true)` → bond credited to broker
  - `withdraw()` → 1 USDC returned to broker wallet
  - `isRevealed()` → `true` ✓
- **All 4 agents registered on ERC-8004 IdentityRegistry:**
  - Broker: tokenId `845598` — tx `0x046407...`
  - Provider 1: tokenId `845540` — tx `0x87917d...`
  - Provider 2: tokenId `845541` — tx `0xd1f67e...`
  - Provider 3: tokenId `845542` — tx `0x77979...`
- **ERC-8183 full flow tested on live Arc Testnet** (jobId 147246):
  - `createJob()` → jobId 147246
  - `setBudget(1 USDC)` → budget set
  - `approve + fund()` → 1 USDC locked in escrow
  - `submit()` → deliverable hash submitted by provider1
  - `complete()` → 1 USDC released to provider1, status = Completed ✓
- **ERC-8004 reputation feedback posted:** provider1 rated 90/100 — tx `0x9420e8...`
- **Handoffs H1, H3, H4, H5 all done** — teammates have everything they need

### ⏳ Only Remaining Item
- **H6 — Full manual team loop** (all 3 teammates on a call together): Frontend submits a task via UI → Backend B auto-runs commit/stream/reveal → Backend A confirms on Arcscan

---

## 1. Deployed Contract — AthenaCommit

| Field | Value |
|---|---|
| Contract | `0x1cFC54256F28C76891891a266c03AD8ceA63D416` |
| Chain | Arc Testnet (chainId `5042002`) |
| RPC (public) | `https://rpc.testnet.arc.network` |
| Explorer | `https://testnet.arcscan.app/address/0x1cFC54256F28C76891891a266c03AD8ceA63D416` |
| ABI | `shared/abis/AthenaCommit.json` (valid JSON — do NOT use `forge inspect` without `--json`) |

**Never hardcode this address.** Always read from `shared/addresses.json → contracts.athenaCommit`.

---

## 2. Key Read Functions (for Dashboard / Stream Detail pages)

All these are `view` — free to call, no gas, no wallet needed.

```typescript
import addresses from "../../shared/addresses.json";
import abi from "../../shared/abis/AthenaCommit.json";

const CONTRACT = addresses.contracts.athenaCommit; // "0x1cFC54256F..."
```

### `getCommitment(bytes32 taskId)` → full struct
```typescript
// Returns:
{
  broker: address,
  client: address,
  taskId: bytes32,
  commitHash: bytes32,
  bondAmount: bigint,      // 6-decimal USDC — divide by 1_000_000 to display
  erc8183JobId: bytes32,
  revealDeadline: bigint,  // block number
  committed: boolean,
  revealed: boolean,
  predictionMet: boolean,
  slashed: boolean
}
```

### `isCommitted(bytes32 taskId)` → bool
### `isRevealed(bytes32 taskId)` → bool
### `isSlashed(bytes32 taskId)` → bool
### `withdrawable(address wallet)` → uint256 (6-decimal USDC)

### `computeTaskId(address client, string taskDescription, uint256 blockNumber)` → bytes32
Use this to reconstruct a taskId for display if needed. Backend B's `/stream-task` response gives you the taskId directly — you don't need to compute it yourself.

---

## 3. All Registered Agents (ERC-8004)

Read from `shared/addresses.json → agents`. These are the live on-chain tokenIds:

| Agent | Address | ERC-8004 tokenId | Role |
|---|---|---|---|
| Broker | `0x27594e2b85e53d3a80095ac25DaD4d8a379F64A3` | **845598** | Routing broker |
| Provider 1 | `0xd99503382bc9861d80e816a05944187f491be11e` | **845540** | Crypto price data |
| Provider 2 | `0x697e72ab770b6fd2f345cb9946c7418818117f7d` | **845541** | Market analytics |
| Provider 3 | `0xa0322b206190735eaf6b8a37ea138e2614e15d6f` | **845542** | Price feed aggregation |

All 4 are registered on the ERC-8004 IdentityRegistry at `0x8004A818BFB912233c491871b3d84c89A494BD9e`.

To display agent reputation scores, call `readAllFeedback(tokenId)` on the ReputationRegistry at `0x8004B663056A597Dffe9eCcC1965A193B7388713`.

---

## 4. USDC — Read This Once, Never Get It Wrong

| Interface | Address | Decimals | Use for |
|---|---|---|---|
| ERC-20 | `0x3600000000000000000000000000000000000000` | **6** | All balances, bond amounts, display |
| Native (gas) | — | **18** | Gas only — never display |

```typescript
// Correct: read ERC-20 balance
const balance = await publicClient.readContract({
  address: "0x3600000000000000000000000000000000000000",
  abi: erc20Abi,
  functionName: "balanceOf",
  args: [userAddress],
});
const displayBalance = Number(balance) / 1_000_000; // e.g. 5.25 USDC
```

If a balance looks wrong by a factor of a trillion, you read the native interface instead of the ERC-20.

---

## 5. taskId scheme — what it is and where to get it

You don't need to compute taskIds yourself. Backend B's `POST /stream-task` response gives you the `taskId` directly. Just store it and use it to poll `/stream-status/:taskId` and to call `getCommitment(taskId)` on-chain.

For reference, the on-chain scheme is:
```typescript
import { keccak256, encodePacked } from "viem";
const taskId = keccak256(encodePacked(
  ["address", "string", "uint256"],
  [clientAddress, taskDescription, BigInt(blockNumber)]
));
```

---

## 6. What to show in the UI per stream phase

Backend B's `GET /stream-status/:taskId` gives you a `phase` field. Map it like this:

| `phase` | Badge colour | What to show |
|---|---|---|
| `committing` | Yellow | "Committing bond on-chain..." + `commitTxHash` as Arcscan link |
| `streaming` | Blue | Progress: `callsCompleted` calls, last quality score, last latency |
| `revealed` | Green/Red | `predictionMet: true` → "Prediction Met ✓" / `false` → "Prediction Failed ✗" |
| `settled` | Green/Red | Bond released to broker or slashed to client. Show `bondStatus` |
| `failed` | Red | Show `error` field |

Link every tx hash to Arcscan: `https://testnet.arcscan.app/tx/{hash}`

---

## 7. On-chain verification (for the "Verify on-chain" button)

After a stream is revealed, let the user verify directly:

```typescript
const commitment = await publicClient.readContract({
  address: CONTRACT,
  abi,
  functionName: "getCommitment",
  args: [taskId],
});

// Show:
// commitment.revealed === true      → "Revealed ✓"
// commitment.predictionMet          → "Prediction Met / Failed"
// commitment.slashed                → "Bond Slashed / Released"
// commitment.bondAmount / 1_000_000 → "1.00 USDC bonded"
```

---

## 8. Arc Testnet wagmi config

```typescript
// frontend/lib/wagmi.ts — already set up, check this file
const arcTestnet = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, // native = 18, ERC-20 = 6
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
  blockExplorers: { default: { name: "Arcscan", url: "https://testnet.arcscan.app" } },
};
```

---

## 9. What's done, what Frontend needs to do

**Done by Backend A (nothing to do):**
- Contract deployed, verified, integration tested
- ABI exported to `shared/abis/AthenaCommit.json`
- All 4 agents registered on ERC-8004
- `shared/addresses.json` fully populated — just read it

**Your remaining work:**
1. Wire `getCommitment` / `isRevealed` reads to Stream Detail page
2. Display agent tokenIds + reputation on Agent Roster page
3. Show USDC bond amount (divide `bondAmount` by `1_000_000`)
4. **H6 team loop** — be ready to submit a task through the UI with all 3 teammates on a call

---

## 10. Ping me if

- ABI parsing fails → check you're importing `shared/abis/AthenaCommit.json` (it's a JSON array now, not text)
- `getCommitment` returns unexpected zeros → taskId probably doesn't match — use `computeTaskId()` helper to cross-check
- Bond amount looks wrong → you're not dividing by `1_000_000`
- Wrong network error → chainId must be `5042002`
