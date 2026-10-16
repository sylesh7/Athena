# Athena Backend B

Implements BACKEND_B_README.md Phases 1–4: agent wallets, x402 provider
endpoints, the MCP quality monitor, the stream loop, and the CCTP
cross-chain payout stretch goal. No mocks — every provider fetches real
data from public APIs, and every on-chain/x402/MCP/CCTP call goes through
the real published SDKs and APIs (verified against their actual `.d.ts`
files and OpenAPI specs, not just the pseudocode in the top-level README).

## Two corrections made while implementing this

1. **`@circle-fin/x402-batching`'s real API differs from the original
   README pseudocode.** `GatewayClient` takes `{ chain: 'arcTestnet',
   privateKey }`, not `{ walletAddress, chain }`, and the paid-fetch method
   is `.pay(url)`, not `.fetchWithPayment(url, opts)`. This code uses the
   verified real API (confirmed against the published v3.2.0 `.d.ts`).
2. **`AthenaCommit.reveal()` already settles ERC-8183 atomically** via its
   `erc8183JobId`/`deliverableHash` params — there's no separate
   `ERC8183.complete()/reject()` call to make afterward. `streamLoop.ts`
   calls `reveal()` once and that's the whole settlement.
3. **Circle wallet custody — split by role, not all-or-nothing.** The
   broker is a plain local EOA (`wallets/setup.ts`, generated with viem):
   `GatewayClient.pay()` requires a raw `privateKey` in its constructor
   (verified against the real published `.d.ts`), which Circle-custodied
   Developer-Controlled Wallets structurally cannot provide. Providers,
   however, never sign anything — `createGatewayMiddleware({ sellerAddress
   })` only needs an address to receive payment at — so they *are* real
   Circle DCW wallets (`wallets/setupCircleProviders.ts`), created and
   registered on ERC-8004 without needing a raw key at all (registration
   signs via Circle's `createContractExecutionTransaction`, not viem —
   `contracts/scripts/register-agents.ts` can't do this, see
   `HANDOFF_BACKEND_A.md`).
4. **CCTP V2's `depositForBurn` takes `destinationCaller` as `bytes32`, not
   `address`** — the original README pseudocode passed a 20-byte zero
   address where the real, deployed function needs a 32-byte value.
   Confirmed by pulling the actual verified implementation ABI from
   Arcscan, not from memory.
5. **`minFinalityThreshold: 1000` is "Fast" (Confirmed), not "Standard"** as
   the README's inline comment claimed — confirmed against Circle's CCTP
   V2 technical guide. Standard/Finalized is `2000`, and only `2000` is
   compatible with `maxFee: 0` (Fast requires a nonzero fee/allowance).
   `cctp/crossChainPayout.ts` uses `2000`.

## Layout

```
backend/
├── lib/            config.ts (shared/addresses.json + ABI loader), chain.ts (Arc viem clients)
├── wallets/        setup.ts (broker EOA), setupCircleProviders.ts + fundCircleProviders.ts + registerCircleProviders.ts (3 provider Circle DCW wallets), generateEntitySecret.ts
├── agents/         broker.ts (routeTask), provider1/2/3.ts (x402 endpoints), providerServer.ts (shared scaffolding)
├── mcp-monitor/    monitor.py (FastMCP quality monitor), client.ts (TS client for it)
├── stream/         streamLoop.ts (runStream), state.ts (status store), entrypoint.ts (Express app)
└── cctp/           crossChainPayout.ts (Phase 4: burn on Arc -> Iris attestation -> mint on Base Sepolia), manualPayout.ts (standalone trigger)
```

## Setup

```bash
cd backend
npm install
cp .env.example .env
npm run wallets:setup                   # broker EOA -> backend/.env.local — DO NOT COMMIT

# Entity secret (once): generates the ciphertext, registration itself is
# manual via the Circle Developer Portal (see wallets/generateEntitySecret.ts)
npm run wallets:entity-secret

# Provider wallets — real Circle Developer-Controlled Wallets, not EOAs:
npm run wallets:circle-providers        # creates 3 wallets on ARC-TESTNET
npm run wallets:circle-fund             # requests faucet funds (may 403 on some
                                         # API keys — fund manually via
                                         # faucet.circle.com if so)
npm run wallets:circle-register-agents  # registers them on ERC-8004 —
                                         # writes shared/addresses.json's
                                         # "agents" section (see that
                                         # script's header for why this one
                                         # touches Backend A's file)

pip install -r mcp-monitor/requirements.txt
```

Fund the broker address `wallets:setup` prints (faucet, `circle wallet
fund`, and a Gateway deposit — see its own printed instructions). Then
approve the broker wallet to spend USDC for the bond (also printed).

### Handoffs this unblocks

**H2 → Backend A:** see `HANDOFF_BACKEND_A.md` — the 3 provider addresses
are already funded and ERC-8004-registered as of this writing; no action
needed there unless you regenerate them.

Backend A also needs the broker's `BROKER_PK` from `backend/.env.local` as
`DEPLOYER_PK` only if they ever need to re-run
`contracts/scripts/register-agents.ts` for the broker itself — that script
doesn't read this
package's env files automatically, the values have to be copied over.

**H7/H8 → Frontend:** `GET /stream-status/:taskId` on the entrypoint
(default `http://localhost:3000`) is the live progress source — phase,
per-call quality/latency, MCP verdict history, bond status, tx hashes. `GET
/streams` lists all sessions for the Dashboard.

## Running it

```bash
npm run provider1     # :3001 — crypto price (CoinGecko)
npm run provider2     # :3002 — market analytics (CoinGecko)
npm run provider3     # :3003 — aggregated price feed (CoinGecko + Coinbase, cross-checked)
python mcp-monitor/monitor.py   # :8000 — quality monitor, streamable-http transport
npm run entrypoint    # :3000 — POST /stream-task, GET /stream-status/:taskId

# or all four Node processes at once (still run monitor.py separately):
npm run dev
```

Verify each provider is really Gateway-protected before wiring the broker to it:

```bash
curl -i http://localhost:3001/price/usdc-eth   # expect 402
```

Trigger a stream (needs a real Gateway payment from the caller — this
endpoint is itself x402-protected, so a bare curl without a signed payment
will also 402; use a `GatewayClient` from a funded wallet, or Circle CLI's
`circle services pay`, to actually call it):

```bash
circle services pay http://localhost:3000/stream-task \
  --address $CLIENT_WALLET --chain ARC-TESTNET -X POST \
  --max-amount 0.01 --output json \
  --data '{"taskDescription":"Get ETH/USD price every second for 30 seconds","clientAddress":"0x..."}'
```

Then poll:

```bash
curl http://localhost:3000/stream-status/<taskId>
```

## Phase 4 (stretch): CCTP cross-chain payout

After a stream to Provider 3 settles with `predictionMet=true`, Athena can
optionally pay Provider 3 natively on Base Sepolia instead of Arc, via
Circle's CCTP V2: burn USDC on Arc's `TokenMessengerV2`, wait for Circle's
Iris attestation, then mint on Base Sepolia's `MessageTransmitterV2`. Every
ABI and API shape here was pulled from live sources (Arcscan's verified
contract API, Circle's published CCTP OpenAPI spec) rather than trusted
from the README pseudocode — see the corrections list above.

**Off by default** (`ENABLE_CCTP_PAYOUT=false` in `.env.example`) — turning
it on requires:
- The broker wallet funded with **Base Sepolia ETH** for gas (separate from
  its Arc gas — same address, different chain, different faucet).
- Patience: Standard Transfer finality can take a while; the whole flow is
  timeboxed at 3 hours (`pollAttestation`'s default), matching the
  README's guidance to show the burn tx on Arcscan as proof of mechanism
  if the mint doesn't land live during a demo.

When it fires (`stream/streamLoop.ts`'s post-reveal hook, Provider-3-only),
it runs in the background — it never blocks the stream's own settlement,
and a CCTP failure only sets `cctpStatus: "failed"` / `cctpError`, not the
stream's own `phase`/`error` (the Arc-side stream already succeeded; the
cross-chain leg is a separate concern layered on top). `GET
/stream-status/:taskId` exposes `cctpStatus` (`pending` → `minted`/`failed`),
`cctpBurnTxHash`, `cctpMintTxHash` for the frontend's "Cross-chain" badge.

To test the burn → attest → mint flow on its own, without running a full
stream:

```bash
npm run cctp:payout -- --amount 1.0
```

## Known limitations (real, not hidden)

- `stream/state.ts` is in-memory — an entrypoint restart loses in-flight
  stream progress (on-chain commit/reveal state is unaffected, it lives in
  AthenaCommit, not here).
- `mcp-monitor/monitor.py`'s per-stream stats are also in-memory and reset
  on restart, per-process — same caveat.
- `agents/broker.ts`'s `readErc8004Reputation` decodes `readAllFeedback`'s
  return bytes against the `giveFeedback` struct shape documented in
  BACKEND_A_README. ERC-8004 is a Draft EIP — BACKEND_A_README itself flags
  this encoding as something to re-verify against the live ABI on Arcscan.
  If decoding fails (unregistered provider, empty history, or a different
  on-chain encoding) it falls back to a neutral score rather than throwing,
  so routing still works for a provider with no track record yet.
- `discoverProviders()`'s parsing of `circle services list --output json`
  tolerates a couple of plausible field-name variants because that CLI's
  JSON schema isn't formally documented pre-1.0 — run it once for real and
  adjust `agents/broker.ts` if the shape differs.
