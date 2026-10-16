# Athena — Frontend README
### Owner: Dashboard & Demo UI
**You own:** `frontend/`
You depend on Backend A's deployed contract + ABI and Backend B's stream status endpoint. Never hardcode an address — always read from `shared/addresses.json`.

---

## 0. Your setup checklist (Day 1)

- [ ] MetaMask wallet, Arc Testnet: chainId `5042002`, RPC `https://rpc.testnet.arc.network`
- [ ] Testnet USDC from `faucet.circle.com`
- [ ] Node.js 22+
- [ ] Scaffold: Next.js + wagmi/viem (or ethers)
- [ ] No Circle API key needed unless you build the payer-side x402 flow (coordinate with Backend B)

---

## 0.1 USDC decimal warning — read once, remember always

Arc's USDC has two interfaces. **You only ever display/use the ERC-20 6-decimal interface:**
- ERC-20 contract: `0x3600000000000000000000000000000000000000` — **6 decimals**
- Native (gas only): **18 decimals** — never display this as a USDC balance

If a USDC balance looks wrong by a factor of a trillion, you read the native interface instead of the ERC-20. Cross-check your first balance display against `https://testnet.arcscan.app` to confirm you got it right.

---

## 1. All pages — what they are and what they do

### Page 1 — Landing / Connect
**Purpose:** entry point. Establishes wallet connection. First thing a judge sees.

**Layout:** centered hero — "Athena" title, tagline ("Every routing decision backed by real USDC. Verified on-chain."), a 3-step static visual (Commit → Stream → Slash/Release), and a single "Connect Wallet" button.

**Interactions:** clicking Connect opens MetaMask (wagmi connector). On success, auto-navigate to Dashboard. On wrong network (not chainId `5042002`), show inline prompt to switch — wagmi can request this programmatically. Don't let users proceed on the wrong network.

**State:** wallet connection status (global), connected address (global), chainId (global).

**Navigation:** Landing → Dashboard on connect. No back.

---

### Page 2 — Dashboard / Home
**Purpose:** hub page. Shows live stats and the list of all stream sessions.

**Layout:** top bar with connected address (truncated, e.g. `0x1234...abcd`) + disconnect. A stats row: total streams, total USDC streamed, slash rate, average prediction accuracy. Below: a list of stream sessions — each row shows taskId (truncated), provider, status badge (Committed / Streaming / Revealed / Settled / Slashed), USDC streamed, and a View link. A prominent "New Stream" button leading to Page 4.

**Interactions:** click session row → navigate to Stream Detail (Page 3). Click "New Stream" → navigate to New Stream (Page 4).

**State:** session list (from Backend B's status endpoint, polled every 3 seconds or via websocket), wallet balance (from ERC-20 contract). Loading + error states shown independently — don't block the whole page if one fails.

**Navigation:** Dashboard → Stream Detail (row click) · Dashboard → New Stream (button).

---

### Page 3 — Stream Detail
**Purpose:** the core "proof it works" screen. Shows everything about one stream session — commit hash, bond status, per-call stream progress, reveal, and final outcome.

**Layout:** header with taskId + status badge. Three sections:

Section A — Commitment: commit hash (the sealed SHA-256 hash), block it landed on, Arcscan link, bond amount posted. Show this as a locked padlock icon — sealed before anything ran.

Section B — Stream: a live call-by-call feed — call number, quality score, latency, MCP verdict (continue/slash), payment amount per call. If stream is live, this updates in near-real-time from Backend B's status endpoint. Show a running total of USDC paid to the provider. Show the MCP monitor's consecutive failure count.

Section C — Reveal & Outcome: revealed hash (matches commit hash ✓ or ✗), prediction vs actual (quality: predicted 0.85, actual 0.91 ✓), bond outcome (Released to broker / Slashed to client), reveal tx hash with Arcscan link.

**Interactions:** if stream is in progress, this page is a live observer. If the session is unsettled and the connected wallet is the broker, show a manual "Reveal" button (for demo fallback). If settled, show "Withdraw" button if connected wallet has withdrawable balance.

**Data sources:**
- Commitment data: read `commitments(taskId)` from `AthenaCommit.sol` directly (public mapping)
- Stream progress: Backend B's `/stream-status/:taskId` endpoint (poll or SSE)
- Bond status: `withdrawable(address)` from `AthenaCommit.sol`
- Arcscan links: `https://testnet.arcscan.app/tx/<txHash>`

**State:** commitment struct (chain read), stream progress (Backend B endpoint), transaction states for manual reveal/withdraw if shown.

**Navigation:** reached from Dashboard or redirected after New Stream submission. Back → Dashboard.

---

### Page 4 — New Stream
**Purpose:** lets the connected wallet act as the client — triggers Athena to start a new stream session. This is the first interactive click in the live demo.

**Layout:** a simple form:
- Task description (free text — e.g. "Get USDC/ETH price every second for 60 seconds")
- Bond amount (USDC, defaults to 1.00, minimum $0.01)
- A preview of estimated cost (bond + stream payments)
- Submit button labeled "Start Stream"

**Form handling:**
- Task description: required, min 10 chars
- Bond amount: positive number, max 6 decimal places (6-decimal USDC), validate before enabling submit
- Show inline field errors before the user submits — don't rely on contract reverts to catch bad input

**Interactions:** on submit, the flow has multiple steps — show them as a progress indicator:
1. Approve USDC (wallet popup #1) — approve the bond amount to AthenaCommit contract
2. Pay stream fee via x402 to Backend B's `/stream-task` endpoint (wallet popup #2 or handled by Backend B's Gateway middleware — coordinate with Backend B which path)
3. Backend B triggers commit → Athena starts routing
4. On success, navigate to Stream Detail for the new session

Show each step clearly. A confused user not knowing a second wallet popup is coming is a real demo failure mode.

**State:** form field values (local), multi-step transaction state machine (idle → approving → approved → streaming → committed → error), resulting taskId (from Backend B response).

**Navigation:** reached from Dashboard. On success → Stream Detail. Cancel → Dashboard.

---

### Page 5 — Agent Roster
**Purpose:** shows all registered agents (Athena broker + 3 providers) with their ERC-8004 identities, roles, balances, and prediction track records. Makes the ERC-8004 integration visible and tangible.

**Layout:** a card per agent:
- Name and role (from ERC-8004 tokenURI metadata)
- Wallet address (truncated, links to Arcscan)
- ERC-8004 token ID
- Current USDC Gateway balance (for providers) and wallet balance (for broker)
- Prediction accuracy % (computed from ERC-8004 reputation history — Backend A writes this after each stream)
- Streams completed / slashed count

**Interactions:** mostly read-only. Each card links to Arcscan address view. "View on Arcscan" opens in new tab.

**State:** agent list from `shared/addresses.json`'s `agents` key (loaded once at app start), live balances from ERC-20 contract + Circle Gateway balance API, reputation data from `ReputationRegistry.readAllFeedback(agentId)`.

**Navigation:** reached from nav bar. No further navigation except external Arcscan links.

---

### Page 6 — Live Stream View (Phase 3 — built once Backend B's automation works)
**Purpose:** the money-shot demo screen. Shows the full automated stream cycle live, from Athena's autonomous provider discovery through commit → stream → reveal → outcome, on one screen, in real time.

**Layout:** a vertical timeline / step tracker:
1. ⚡ Athena Self-Setup (Circle skills, wallet created)
2. 🔍 Provider Discovery (circle services list — shows providers Athena considered)
3. 🧠 Routing Decision (which provider Athena selected and why — shown once revealed)
4. 🔒 On-Chain Commit (sealed hash landing on Arc — show tx hash + Arcscan link, nothing readable yet)
5. 💰 Bond Posted (USDC escrowed — show amount + Arcscan link)
6. 📡 Streaming (live call-by-call feed from Backend B — quality scores, latency, MCP verdict)
7. 🔓 Reveal (hash unlocks — reasoning now readable, prediction vs actual shown side by side)
8. ✅ Settled or ❌ Slashed (bond outcome with tx hash)

Each step lights up as it completes. Steps 4 and 7 are the moments to slow down for — the commit (sealed, mysterious, money on the line) and the reveal (truth comes out, math decides the outcome).

Below the timeline: a "Trigger Demo Stream" button that calls Backend B's `/stream-task` endpoint (coordinate with Backend B on whether the x402 payment UI lives here or Backend B handles it server-side).

**State:** driven entirely by Backend B's status endpoint (H7). Don't try to infer stream state from chain events alone — the "per-call quality score" state only exists in Backend B's orchestration layer, not on-chain.

**Navigation:** reached from nav bar or after "New Stream" completes. Links to Stream Detail on completion.

---

## 2. Navigation structure

```
Landing (connect wallet)
   │
   ▼
Dashboard ──────────────┬──────────────┬─────────────────┐
   │                    │              │                  │
   ▼                    ▼              ▼                  ▼
Stream Detail     New Stream     Agent Roster     Live Stream View
   ▲                    │
   └────────────────────┘ (New Stream redirects here on success)
```

Persistent nav bar (visible on all pages except Landing): Dashboard · Agent Roster · Live Stream View · New Stream button. Stream Detail reached contextually, not from nav.

---

## 3. State management

Keep it simple — this is a hackathon, not a production app.

**Global state** (React Context or Zustand): wallet connection status, connected address, chainId, and contents of `shared/addresses.json` + ABIs (loaded once at app start from the file or an env var). Every page reads contract addresses from here — never from hardcoded strings.

**Server/chain state** (React Query or SWR strongly recommended): contract reads (balances, commitment data, withdrawable amounts) with polling intervals. Stale-while-revalidate beats manual `useEffect` fetching for hackathon speed.

**Local component state** (`useState`): form fields on New Stream, transaction step machine, UI toggles.

**Backend B's stream status**: poll `/stream-status/:taskId` every 2 seconds during active stream. When stream ends, switch to a 10-second poll or stop entirely. Don't spam Backend B's endpoint.

---

## 4. Data flow — where every piece of displayed data comes from

| What you display | Source | Notes |
|---|---|---|
| Wallet address, chainId | wagmi connector | Global state |
| USDC balance (any wallet) | ERC-20 `balanceOf` on `0x3600...0000` (6 decimals) | Never read native balance for this |
| Commitment struct (hash, broker, client, bondAmount, revealed, slashed) | `AthenaCommit.commitments(taskId)` — public mapping | Direct chain read |
| Bond withdrawable amount | `AthenaCommit.withdrawable(address)` — public mapping | Direct chain read |
| Stream progress, quality scores, MCP verdict | Backend B's `/stream-status/:taskId` | Poll or SSE |
| Agent identity (name, role, tokenId) | ERC-8004 `tokenURI(tokenId)` → JSON metadata | Fetched once, cached |
| Agent reputation/accuracy | ERC-8004 `ReputationRegistry.readAllFeedback(agentId)` | Updated by Backend A after each stream |
| Agent list (addresses, tokenIds) | `shared/addresses.json` `agents` key | Loaded at app start from shared file |
| Arcscan TX links | `https://testnet.arcscan.app/tx/<txHash>` | Construct from tx hashes in contract events |
| Circle Marketplace services | `agents.circle.com/services` (embed as iframe or link) | Show in Live Stream View during discovery step |

---

## PHASE 1 — Scaffold + balance read

### Phase 1.1 — Scaffold
- Next.js app (`npx create-next-app@latest`)
- Install wagmi + viem: `npm install wagmi viem @tanstack/react-query`
- Configure wagmi for Arc Testnet:
```js
const arcTestnet = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
  blockExplorers: { default: { name: "Arcscan", url: "https://testnet.arcscan.app" } },
};
```

### Phase 1.2 — Landing page + balance read
- Build Landing page (Page 1) with wallet connect
- On Dashboard, read and display connected wallet's USDC balance:
```js
// Read ERC-20 balance — 6 decimals
const { data: balance } = useReadContract({
  address: "0x3600000000000000000000000000000000000000",
  abi: erc20Abi,
  functionName: "balanceOf",
  args: [address],
});
// Display: (Number(balance) / 1_000_000).toFixed(6) + " USDC"
```
- **Cross-check this number against Arcscan manually.** If it matches, your decimal handling is correct. Don't proceed past Phase 1 without this verified.

**Phase 1 exit criteria:** page loads, wallet connects to Arc Testnet, USDC balance displays correctly (verified against Arcscan).

---

## PHASE 2 — Real contract integration

### Phase 2.1 — Wait for Backend A's handoff (H4)
Once Backend A pushes deployed address + ABI to `shared/`:
```js
import addresses from "../../shared/addresses.json";
import athenaCommitAbi from "../../shared/abis/AthenaCommit.json";
```

### Phase 2.2 — Build Stream Detail (Page 3) reads
Wire reads for `commitments(taskId)` and `withdrawable(address)`. Build the Commit section and Outcome section. Stream section can be a placeholder until Backend B delivers H7.

### Phase 2.3 — Build New Stream (Page 4) write flow
Wire the two-step approve → commit flow. Show the step indicator clearly. On success, navigate to Stream Detail with the returned taskId.

### Phase 2.4 — Build Agent Roster (Page 5)
Once Backend A pushes agent tokenIds (H5), read ERC-8004 metadata and display agent cards.

### Phase 2.5 — Manual loop together (H6)
Run the full flow together: New Stream form → approve → commit → Backend B manually triggers reveal → you show bond outcome correctly on Stream Detail. This is your minimum viable demo.

---

## PHASE 3 — Live stream visualization

### Phase 3.1 — Coordinate with Backend B (H7, H8)
Decide: does the x402 payment trigger live in your New Stream page (you build payer UI), or does Backend B handle it server-side and you just observe? Resolve this directly — don't assume.

### Phase 3.2 — Build Live Stream View (Page 6)
Wire to Backend B's status endpoint. Build the step-tracker timeline. Steps 4 (commit lands) and 7 (reveal unlocks) are the moments to animate and emphasize.

**Phase 3 exit criteria:** triggering a stream shows live progress through all steps, ends on a correctly settled Stream Detail page with accurate on-chain data.

---

## PHASE 4 — Stretch

If Backend A/B build CCTP cross-chain payout, add a "Cross-chain" badge on Stream Detail for Provider 3 streams, showing burn tx on Arc + mint status on Base.

---

## Your handoff checklist

| When | What | From |
|---|---|---|
| Phase 1 sync | `commit()`/`reveal()` function signatures | From Backend A |
| Phase 2.1 | Deployed contract address + ABI | From Backend A — don't build past this without it |
| Phase 2.4 | Agent tokenIds in `shared/addresses.json` | From Backend A |
| Phase 2.5 | Full manual loop works live | Joint |
| Phase 3.1 | Decide x402 payer UI ownership | Direct convo with Backend B |
| Phase 3.2 | Status endpoint/SSE for stream progress | From Backend B |

## Things to re-verify if something feels off

- USDC balance wrong by huge factor → reading native 18-decimal interface instead of ERC-20 6-decimal
- `shared/addresses.json` looks stale → ping Backend A, don't guess
- Stream status endpoint not updating → ask Backend B if it's running on the right port
- Wallet connect fails → confirm chainId `5042002` is correctly configured in wagmi
- Contract reads return all zeros → normal for a taskId that hasn't been committed yet — distinguish this from an error
