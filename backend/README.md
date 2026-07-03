# Athena Backend B

Implements BACKEND_B_README.md Phases 1–3: agent wallets, x402 provider
endpoints, the MCP quality monitor, and the stream loop. No mocks — every
provider fetches real data from public APIs, and every on-chain/x402/MCP
call goes through the real published SDKs (verified against their actual
`.d.ts` files, not just the pseudocode in the top-level README).

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
3. **Circle wallet custody.** Wallets here are plain local EOAs
   (`wallets/setup.ts`, generated with viem), not Circle-custodied
   Developer-Controlled Wallets. Circle's DCW SDK deliberately doesn't
   expose a raw private key, but `GatewayClient` itself takes a raw
   `privateKey`, and so does everything else in this repo (Deploy.s.sol,
   `contracts/scripts/register-agents.ts`, `post-reputation.ts`). Mixing
   custody models would mean those scripts silently can't sign for
   Circle-managed wallets. Circle CLI's `wallet fund` / `gateway deposit`
   commands work against any address regardless of who holds the key, so
   this loses nothing.

## Layout

```
backend/
├── lib/            config.ts (shared/addresses.json + ABI loader), chain.ts (Arc viem clients)
├── wallets/        setup.ts — generates broker + 3 provider EOAs (Phase 1.1)
├── agents/         broker.ts (routeTask), provider1/2/3.ts (x402 endpoints), providerServer.ts (shared scaffolding)
├── mcp-monitor/    monitor.py (FastMCP quality monitor), client.ts (TS client for it)
└── stream/         streamLoop.ts (runStream), state.ts (status store), entrypoint.ts (Express app)
```

## Setup

```bash
cd backend
npm install
cp .env.example .env
npm run wallets:setup        # generates backend/.env.local — DO NOT COMMIT

pip install -r mcp-monitor/requirements.txt
```

Fund every address `wallets:setup` prints (see its own printed instructions —
faucet, `circle wallet fund`, and a Gateway deposit for the broker wallet
only). Then approve the broker wallet to spend USDC for the bond (also
printed by the script).

### Handoffs this unblocks

**H2 → Backend A:** the 3 provider addresses printed by `wallets:setup`.
Backend A also needs `BROKER_PK`/`PROVIDER{1,2,3}_PK` from
`backend/.env.local` as `DEPLOYER_PK`/`PROVIDERn_PK` to run
`contracts/scripts/register-agents.ts` — that script doesn't read this
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
