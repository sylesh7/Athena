# Backend B → Frontend handoff

*Updated 2026-07-04 — provider addresses changed (Circle Developer-Controlled
Wallets swap) and Phase 4 (CCTP) landed since the first version of this doc.*

Confirmed working end-to-end via `backend/test/smoke.ts` (23/23 checks passing)
against the live deployed `AthenaCommit` at
`0x1cFC54256F28C76891891a266c03AD8ceA63D416` on Arc Testnet.

## Entrypoint

Base URL: `http://localhost:3000` (set by you / ops — `ENTRYPOINT_PORT` in
`backend/.env`). Not deployed anywhere public yet — for the demo this runs on
whichever machine is presenting.

### `POST /stream-task`

**This route is itself x402/Gateway-protected** ($0.01) — a bare `fetch`/`axios`
POST will get a `402`. You need a real signed payment, either:
- a `GatewayClient` (from `@circle-fin/x402-batching/client`) in your payer flow, or
- for manual testing: `circle services pay http://localhost:3000/stream-task --address $CLIENT_WALLET --chain ARC-TESTNET -X POST --max-amount 0.01 --output json --data '{...}'`

Body:
```json
{
  "taskDescription": "string, min 10 chars",
  "clientAddress": "0x...",
  "category": "string, optional, defaults to \"Financial Analysis\"",
  "bondAmountUsdc": "number, optional, defaults to 1.00 USDC",
  "maxCalls": "integer, optional, defaults to 10, hard-capped at 50"
}
```

Response (immediate — the stream itself runs in the background, this does
NOT wait for it to finish):
```json
{
  "taskId": "0x...",
  "selectedProvider": "http://localhost:3001/price/usdc-eth",
  "predictedQualityScore": 0.85,
  "predictedLatencyMs": 500,
  "confidenceScore": 0.6,
  "statusUrl": "/stream-status/0x..."
}
```

### `GET /stream-status/:taskId` — poll this for live progress (H7/H8)

```ts
{
  taskId: "0x...",
  phase: "committing" | "streaming" | "revealed" | "settled" | "failed",
  selectedProviderUrl: string,
  predictedQualityScore: number,
  predictedLatencyMs: number,
  callsCompleted: number,
  lastQualityScore: number | null,
  lastLatencyMs: number | null,
  predictionMet: boolean | null,        // null until revealed
  bondStatus: "posted" | "released" | "slashed" | null,
  commitTxHash: `0x${string}` | null,
  revealTxHash: `0x${string}` | null,
  error: string | null,                  // set if phase === "failed"
  createdAt: number,                     // ms epoch
  updatedAt: number,

  // Phase 4 (stretch, Provider 3 only) — absent entirely unless
  // ENABLE_CCTP_PAYOUT is on and this stream routed to Provider 3.
  cctpStatus?: "pending" | "burned" | "attested" | "minted" | "failed",
  cctpBurnTxHash?: `0x${string}`,   // Arc — show as "Cross-chain" badge source
  cctpMintTxHash?: `0x${string}`,   // Base Sepolia
  cctpError?: string,
}
```

404 if `taskId` is unknown. Poll every ~2s during an active stream per your
own README's guidance; the store is in-memory on our side so an unknown
`taskId` after a backend restart means the stream info is gone (on-chain
commit/reveal state is unaffected — you can still read `commitments(taskId)`
directly off `AthenaCommit` for that).

### `GET /streams` — session list for Dashboard

Returns an array of the same shape as above, newest first. Empty array if no
streams have run yet (not an error).

### `GET /health`

```json
{ "ok": true, "contract": "0x1cFC...", "broker": "0x2759..." }
```

## Provider / agent info for Agent Roster page

All 4 are funded and ERC-8004-registered as of 2026-07-04. Providers 1-3
are real Circle Developer-Controlled Wallets (`custody: "circle-dcw"` in
`shared/addresses.json`'s `agents` section); the broker is a plain EOA
(needs a raw key to sign Gateway payments, which Circle custody can't
provide):

| Role | Address | tokenId | Endpoint |
|---|---|---|---|
| Broker | `0x27594e2b85e53d3a80095ac25DaD4d8a379F64A3` | 845598 | — (calls `commit()`/`reveal()`, runs the entrypoint) |
| Provider 1 (crypto price) | `0xd99503382bc9861d80e816a05944187f491be11e` | 845540 | `/price/usdc-eth` |
| Provider 2 (market analytics) | `0x697e72ab770b6fd2f345cb9946c7418818117f7d` | 845541 | `/analytics/eth` |
| Provider 3 (price feed, aggregated) | `0xa0322b206190735eaf6b8a37ea138e2614e15d6f` | 845542 | `/price/feed` |

Read `shared/addresses.json`'s `agents` section rather than hardcoding
these — it's the source of truth and could change again.

## Known limitations, so you don't chase phantom bugs

- `/stream-status` and `/streams` are in-memory per-process — a backend
  restart clears them. On-chain data (`commitments(taskId)` on
  `AthenaCommit`) is unaffected.
- No live stream has actually been run end-to-end yet — everything above
  is verified structurally (real HTTP calls, real contract reads, real MCP
  monitor logic, real funded/registered wallets) but not yet a real
  financial stream. `bondStatus`/`predictionMet` will stay `null` until
  that happens. `GET /streams` currently returns `[]`.
- `shared/abis/AthenaCommit.json` was invalid JSON (a pretty-printed text
  table, not an ABI array) at one point — it's fixed now. If your
  `import athenaCommitAbi from ".../AthenaCommit.json"` ever throws a parse
  error again, that file regressed — ping Backend A.
- Broker's own USDC/native balance is still 0 (unfunded) — the smoke
  test's Tier 0 funding check will flag this; it needs a faucet drip before
  a real `commit()` can happen (it pays gas + the bond).
