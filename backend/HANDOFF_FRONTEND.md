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
  "maxCalls": "integer, optional, defaults to 10, hard-capped at 50",
  "testOverride": {
    "predictedQualityScore": "number 0-1, optional",
    "predictedLatencyMs": "integer >= 0, optional"
  }
}
```

**`testOverride` (added 2026-07-05):** demo/test only — overrides
`routeTask()`'s auto-derived prediction instead of faking anything; the
commit-reveal-slash flow that follows is still fully real either way, this
just lets you deliberately engineer which outcome it proves. Exists because
our real providers report a steady quality/latency, so an organic run
essentially never slashes — there was no way to demo/test the real
on-chain slash path otherwise (see `test/smoke.ts` Tier 6, which sets
`predictedLatencyMs: 0` to force one honestly — no real HTTP round-trip
completes in 0ms). Could be useful for your own demo if you want a
guaranteed-slash walkthrough alongside a guaranteed-success one.

Response (immediate — the stream itself runs in the background, this does
NOT wait for it to finish):
```json
{
  "taskId": "0x...",
  "statusUrl": "/stream-status/0x..."
}
```

**Updated 2026-07-05 — this response shrank.** It used to also echo
`selectedProvider`, `predictedQualityScore`, `predictedLatencyMs`, and
`confidenceScore` immediately here — before `commit()` even landed on-chain.
That contradicted `README.md`'s own Live Stream View narrative ("Routing
Decision ... shown once revealed") and `FRONTEND_README.md`'s Stream Detail
spec (predicted-vs-actual only in the Reveal section), so it's fixed: the
routing decision is now sealed and only appears via `/stream-status/:taskId`
once `phase === "revealed"`. Poll status for everything past `taskId`.

### `GET /stream-status/:taskId` — poll this for live progress (H7/H8)

```ts
{
  taskId: "0x...",
  phase: "committing" | "streaming" | "revealed" | "settled" | "failed",

  // Sealed — undefined/null until phase === "revealed". Do not build UI that
  // expects these before then; that's the point (see 2026-07-05 update below).
  selectedProviderUrl?: string,
  predictedQualityScore?: number,
  predictedLatencyMs?: number,
  commitHash: `0x${string}` | null,
  decisionPreimage: string | null,       // canonical JSON — rehash it yourself
                                          // and diff against getCommitment(taskId).commitHash
                                          // read on-chain; that's the actual proof, not our say-so
  preimageIntegrityWarning: boolean,     // should always be false; true means investigate

  // Safe to show live — already-observed facts, not the sealed prediction.
  callsCompleted: number,
  lastQualityScore: number | null,
  lastLatencyMs: number | null,
  callHistory: Array<{
    callNumber: number,
    qualityScore: number,
    latencyMs: number,
    qualityMet: boolean,
    latencyMet: boolean,
  }>,

  predictionMet: boolean | null,        // null until revealed
  bondStatus: "posted" | "released" | "slashed" | null,
  commitTxHash: `0x${string}` | null,
  revealTxHash: `0x${string}` | null,
  erc8183JobId: `0x${string}` | null,   // real ERC-8183 job reference, not sensitive — null if
                                          // ERC-8183 setup failed for this stream (non-fatal, core
                                          // flow still settles regardless — see lib/erc8183.ts)
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

**Updated 2026-07-05:** added `commitHash`, `decisionPreimage`,
`callHistory` (full per-call feed — previously only `lastQualityScore`/
`lastLatencyMs` existed), `preimageIntegrityWarning`, and `erc8183JobId`
(ERC-8183 is now genuinely wired into the live path — createJob/setBudget/
fund by the broker + provider, submit before reveal; previously this was
always `0x0`/skipped entirely). Also:
`selectedProviderUrl`/`predictedQualityScore`/`predictedLatencyMs` used to be
populated immediately at request time — they now stay sealed until
`phase === "revealed"`, matching the "shown once revealed" demo narrative.
This was a real bug fix, not a style change: previously the commit-reveal
hash was never independently verifiable by anyone outside our own process.
Now `decisionPreimage` + `commitHash` are published at reveal specifically so
you (or a judge) can rehash it yourselves and diff against the real on-chain
`commitHash` via `getCommitment(taskId)` — don't just display our
`commitHash` field as trusted, that's the whole point of exposing the
preimage too.

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
