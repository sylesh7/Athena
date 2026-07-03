# Athena — Team Index
### Trust-minimized streaming agent broker on Arc · Lepton Agents Hackathon
**Deadline:** July 6, 2026, 11:59 PM ET · **Submission:** forms.gle/SMqLaw2pMGDe58LFA
**Team:** Backend A (contracts) · Backend B (payments/stream/agents) · Frontend (dashboard)

---

## The idea

Athena is an AI broker agent that sets itself up autonomously using Circle's Agent Wallet skills, discovers provider agents from Circle's Agent Marketplace, and before starting any payment stream commits a SHA-256 hash of its structured routing decision — chosen provider, predicted per-call quality metric, predicted latency, confidence score — to a smart contract on Arc, posts a USDC bond on that prediction via Circle Gateway nanopayments, then streams per-call USDC nanopayments to the chosen provider via x402 as results arrive, with an MCP quality monitor checking every N calls — if quality or latency drops below what Athena predicted, the stream stops and the bond slashes automatically to the client, if the stream completes successfully the bond releases back to Athena — with every routing decision, prediction accuracy, and stream outcome permanently recorded on ERC-8004, all settled in under 500ms in USDC on Arc.

---

## How this scores against every judging criterion

| Criterion | Weight | How Athena scores |
|---|---|---|
| Agentic Sophistication | 30% | Athena makes two autonomous decisions per stream — who to route to AND what quality/latency to predict — both sealed before the stream starts, both have real USDC consequences. Self-bootstraps via Circle skills with no human writing integration code. MCP monitor decides in real-time whether to continue or slash. Full autonomy, not automation. |
| Traction | 30% | Every stream = multiple on-chain nanopayment transactions. Each routing decision = a commit + bond + reveal. Running 10 streams = 50+ real on-chain transactions logged on Arcscan. Log every milestone via `arc-canteen update traction` throughout the build window. Cross-team traction: other Lepton teams building x402 services can plug their endpoints in as Athena providers. |
| Circle Tool Usage | 20% | Agent Wallets (per agent, policy-controlled), Gateway/Nanopayments (per-call stream), x402 (HTTP payment trigger per call), Circle CLI + skills (autonomous setup), Agent Marketplace (provider discovery), Contracts (AthenaCommit.sol + ERC-8183), USDC throughout, CCTP V2 (Phase 4 cross-chain). |
| Innovation | 20% | Commit-reveal tied to a falsifiable per-call prediction — not just "did it succeed" but "did it match what I specifically predicted" — with streaming nanopayments as the economic primitive rather than a lump payment. MCP as a live stream quality oracle. Not in any prior art we found. |

---

## 4 README files in this repo

| File | Owner | What it covers |
|---|---|---|
| `README.md` | Everyone reads | This file — index, shared facts, handoff map, judging alignment |
| `BACKEND_A_README.md` | Backend A | Contracts: AthenaCommit.sol, ERC-8183 integration, ERC-8004 registration, CCTP Phase 4 |
| `BACKEND_B_README.md` | Backend B | Stream loop, x402 payments, Circle CLI/wallets, deterministic broker logic, MCP quality monitor |
| `FRONTEND_README.md` | Frontend | All 6 pages, state management, data flow, component breakdown |

---

## Shared facts — pin these, never re-derive mid-build

| Fact | Value |
|---|---|
| Chain ID | `5042002` (hex `0x4cef52`) |
| RPC | `arc-canteen rpc-url` after `arc-canteen login` (Canteen-hosted proxy) |
| Backup RPC | `https://rpc.testnet.arc.network` |
| Explorer | `https://testnet.arcscan.app` |
| Faucet | `https://faucet.circle.com` (select Arc Testnet) |
| Native gas | USDC |
| USDC ERC-20 (use this for all amounts) | `0x3600000000000000000000000000000000000000` — **6 decimals** |
| USDC native interface | **18 decimals** (gas only — never use this for payment amounts) |
| ERC-8004 IdentityRegistry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ERC-8004 ReputationRegistry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |
| ERC-8183 job escrow (Arc) | `0x0747EEf0706327138c69792bF28Cd525089e4583` |
| CCTP V2 TokenMessengerV2 (Arc, domain 26) | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` |
| CCTP V2 MessageTransmitterV2 | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` |
| Circle Gateway facilitator (Arc testnet) | `https://gateway-api-testnet.circle.com` · network `eip155:5042002` |
| Circle Agent Marketplace | `https://agents.circle.com/services` |
| Circle skills setup | `curl -sL https://agents.circle.com/skills/setup.md` |
| Solidity pragma | `^0.8.28` |
| OpenZeppelin | `5.x` — `PaymentSplitter` REMOVED, use manual split. `ReentrancyGuardTransient` available. |
| Canteen CLI install | `uv tool install git+https://github.com/the-canteen-dev/ARC-cli` |
| Circle CLI install | `npm install -g @circle-fin/cli` (Node v20.18.2+) |
| Reference repo | `github.com/the-canteen-dev/circle-agent` + `circlefin/arc-nanopayments` |

⚠️ **USDC decimals rule — read once, remember always:** all payment amounts, bond amounts, escrow amounts use the **6-decimal ERC-20 interface**. The 18-decimal native interface is gas only. Mixing these is the #1 bug on Arc — if a number looks wrong by a factor of a trillion, this is why.

⚠️ **`anvil` is not Arc.** Local Foundry simulator cannot reproduce Arc's blocklist enforcement, native precompiles, or EIP-7708 Transfer logs. Unit tests: `anvil`. Integration tests: real Arc Testnet RPC.

⚠️ **`circle services pay` has no loop/stream mode.** It makes one payment per invocation. Backend B implements the stream loop in application code using `GatewayClient` + `fetchWithPayment` from `@circle-fin/x402-batching/client`. This is confirmed — do not waste time searching for a `--loop` flag that does not exist.

---

## The stream flow (everyone must understand this before writing code)

```
Client
  │
  │ 1. Pays task fee via x402 nanopayment → Athena's Gateway-protected endpoint
  │    (single payment to start the session)
  ▼
Athena Broker Agent
  │
  │ 2. Reads Circle Agent Marketplace via `circle services list`
  │    Evaluates providers by ERC-8004 reputation + price + endpoint count
  │
  │ 3. Forms structured decision object:
  │    { taskId, selectedProvider, predictedQualityScore, predictedLatencyMs,
  │      confidenceScore, nonce }
  │    SHA-256 hashes this object → commits hash to AthenaCommit.sol
  │    Posts USDC bond into ERC-8183 escrow (Athena = evaluator role)
  │
  │ 4. Stream loop starts (Backend B owns this loop):
  │    FOR each call in stream:
  │      → GatewayClient.fetchWithPayment(providerEndpoint, $0.000001)
  │      → Provider returns result
  │      → MCP quality monitor scores result (quality + latency)
  │      → If score passes: continue stream
  │      → If score fails N consecutive times: break, trigger slash
  │
  │ 5. Stream ends (success or failure)
  │    → Athena reveals structured decision object on-chain
  │    → AthenaCommit.sol verifies SHA-256(revealed) == committed hash
  │    → Checks: did predictedQualityScore and predictedLatencyMs match actuals?
  │
  │ 6a. Both match → bond releases to Athena, ERC-8183 complete() called
  │ 6b. Either fails → bond slashes to client, ERC-8183 reject() called
  │
  │ 7. ERC-8004 ReputationRegistry updated for both broker and provider
  │
  ▼
Frontend shows: stream progress live, commit hash on Arcscan, reveal,
bond status, per-agent reputation update
```

---

## Cross-team handoff map — critical path

| # | From | To | When | What |
|---|---|---|---|---|
| H1 | Backend A | Backend B + Frontend | End Phase 1 | `AthenaCommit.sol` function signatures so B can call commit/reveal, Frontend can read events |
| H2 | Backend B | Backend A | End Phase 1 | 3 provider agent wallet addresses + roles (for ERC-8004 registration) |
| H3 | Backend A ↔ Backend B | mutual | End Phase 1 | Agreed `taskId` generation scheme — both must use identical scheme |
| H4 | Backend A | Backend B + Frontend | Phase 2 | Deployed contract address + exported ABI to `shared/` — **ping both actively, don't just commit** |
| H5 | Backend A | Frontend | Phase 2 | Agent `tokenId`s after ERC-8004 registration → `shared/addresses.json` |
| H6 | ALL | ALL | Phase 2 end | Full manual loop: commit → bond → single provider call → reveal → slash/release — works live |
| H7 | Backend B | Frontend | Phase 3 | Status websocket/endpoint for live stream progress display |
| H8 | Backend B | Frontend | Phase 3 | MCP monitor's per-call quality scores surfaced so frontend can show stream health live |
| H9 | ALL | ALL | Phase 3 end | Full automated stream: client pays once → stream runs → bond resolves — zero manual steps |

---

## Repo structure

```
athena/
├── contracts/              # Backend A owns
│   ├── src/
│   │   ├── AthenaCommit.sol
│   │   └── AthenaEscrow.sol   (or use ERC-8183 directly)
│   ├── test/
│   ├── script/Deploy.s.sol
│   └── foundry.toml
├── backend/                # Backend B owns
│   ├── stream/             # GatewayClient stream loop
│   ├── agents/             # Broker routing logic (plain TS, no framework) + provider agents
│   ├── mcp-monitor/        # FastMCP quality evaluator (Python)
│   └── cctp/               # Phase 4 cross-chain payout
├── frontend/               # Frontend owns
│   └── (Next.js)
├── shared/                 # Backend A writes, everyone reads
│   ├── addresses.json
│   └── abis/
├── README.md
├── BACKEND_A_README.md
├── BACKEND_B_README.md
└── FRONTEND_README.md
```

**Rule:** `shared/addresses.json` is Backend A's file. Nobody else edits it. Nobody hardcodes an address from memory. If it's stale, ping Backend A.

---

## Submission checklist

- [ ] Register on Luma: `https://luma.com/5xcrazms` (GitHub + Discord handle required)
- [ ] Join Canteen Discord: `https://discord.gg/rsVfYutFZg` — introduce yourselves, say what you're building
- [ ] Join Arc builder Discord: `https://discord.com/invite/buildonarc` — mention Canteen + Lepton in onboarding
- [ ] Install Canteen CLI: `uv tool install git+https://github.com/the-canteen-dev/ARC-cli`
- [ ] Install Circle CLI: `npm install -g @circle-fin/cli`
- [ ] Submit provider agents to marketplace: `forms.gle/7YFzvdmMcn1JH5tF6` — do this Day 1, approval takes time
- [ ] Log traction updates regularly: `arc-canteen update traction` — not just once at submission
- [ ] Log product updates: `arc-canteen update product`
- [ ] Public GitHub repo (required)
- [ ] Video demo under 3 minutes — Loom/YouTube/Vimeo (required)
- [ ] Live deployed link (optional but strongly encouraged)
- [ ] Submit: `forms.gle/SMqLaw2pMGDe58LFA` — resubmit as many times as needed before deadline

---

## When something breaks and you don't know whose problem it is

1. Numbers look wrong by a huge factor → USDC decimal mismatch (18 vs 6). Check which interface you're reading.
2. Contract call reverts unexpectedly → check `taskId` matches agreed scheme (H3), check bond amount is 6-decimal
3. Stream payments not going through → confirm agent wallet has Gateway balance deposited, not just wallet balance
4. Hash mismatch on reveal → confirm you're hashing the structured JSON object, not any LLM-generated text
5. Data looks stale → `shared/addresses.json` is outdated, ping Backend A
6. MCP monitor not triggering → confirm it's running on `streamable-http` transport, not stdio
7. Blocked on a handoff → say so immediately. Silent waiting is the #1 team-killer in a hackathon.
