# Backend B → Frontend handoff

Confirmed working end-to-end via `backend/test/smoke.ts` (19/19 checks passing)
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

These are plain EOA wallets (not yet ERC-8004-registered — that's pending
Backend A running `register-agents.ts` with the addresses in
`HANDOFF_BACKEND_A.md`):

| Role | Address | Endpoint |
|---|---|---|
| Broker | `0x27594e2b85e53d3a80095ac25DaD4d8a379F64A3` | — (calls `commit()`/`reveal()`, runs the entrypoint) |
| Provider 1 (crypto price) | `0x1721E4e606C891b4CaA72b294eea39EAEC719899` | `/price/usdc-eth` |
| Provider 2 (market analytics) | `0xb7521922B2E86f7CAF39D3Cca998744779F68fd6` | `/analytics/eth` |
| Provider 3 (price feed, aggregated) | `0x1188ff3cd11F2184Cb7FC1a3dE7Cbeb8666E9bb5` | `/price/feed` |

None of these wallets are funded yet — balances will read 0 until faucet +
Gateway deposit happens (see `backend/README.md`). Don't treat a 0 balance
as a bug in your reads.

## Known limitations, so you don't chase phantom bugs

- `/stream-status` and `/streams` are in-memory per-process — a backend
  restart clears them. On-chain data (`commitments(taskId)` on
  `AthenaCommit`) is unaffected.
- No live stream has actually been run end-to-end yet (wallets are unfunded
  and not yet on the Circle Agent Marketplace) — everything above is
  verified structurally (real HTTP calls, real contract reads, real MCP
  monitor logic) but not yet a real financial stream. `bondStatus`/
  `predictionMet` will stay `null` until that happens.
- `shared/abis/AthenaCommit.json` was invalid JSON (a pretty-printed text
  table, not an ABI array) as of the last time you may have pulled it —
  it's fixed now. If your `import athenaCommitAbi from ".../AthenaCommit.json"`
  ever throws a parse error again, that file regressed — ping Backend A.
