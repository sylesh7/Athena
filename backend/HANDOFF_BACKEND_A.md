# Backend B → Backend A handoff

*Supersedes the original H2 handoff below — the 3 provider addresses
changed on 2026-07-04 (Circle Developer-Controlled Wallets swap, see next
section). If you already ran `register-agents.ts` against the old
addresses (tokenIds 845255-845257), those registrations are still valid
on-chain but are no longer linked to the active provider wallets.*

## Provider wallets moved to Circle Developer-Controlled Wallets — and were re-registered without your script

Providers never sign anything (`createGatewayMiddleware({ sellerAddress })`
only needs an address to receive payment at), so they're now real Circle
DCW wallets instead of plain EOAs — visible in the Circle Console, genuine
"Circle Agent Wallet" usage for judging.

**New addresses, already funded and already registered on ERC-8004** (I
handled registration myself — see why below):

```
provider1: 0xd99503382bc9861d80e816a05944187f491be11e  tokenId 845540  (crypto price)
provider2: 0x697e72ab770b6fd2f345cb9946c7418818117f7d  tokenId 845541  (market analytics)
provider3: 0xa0322b206190735eaf6b8a37ea138e2614e15d6f  tokenId 845542  (aggregated price feed)
```

`shared/addresses.json`'s `agents` section is already updated with these —
that's the one exception to "Backend A owns this file" in this repo: your
`register-agents.ts` signs with `privateKeyToAccount(pk)` via viem, and
Circle-custodied wallets never expose a raw private key, so your script
structurally cannot register these. I used
`backend/wallets/registerCircleProviders.ts` instead, which calls the same
`IdentityRegistry.register(string)` but signs via Circle's
`createContractExecutionTransaction` API. Nothing else about the
registration differs — same contract, same function, same metadata shape.

The broker is unaffected — still the plain EOA from the original handoff
below (`GatewayClient.pay()`, from `@circle-fin/x402-batching`, requires a
raw private key and structurally cannot use Circle custody, verified
against the real published `.d.ts`).

## H3 — taskId scheme: confirmed byte-for-byte match

Verified this for real, not just by reading the code: `backend/test/smoke.ts`
calls your deployed `AthenaCommit.computeTaskId(client, desc, blockNumber)`
on-chain and asserts it equals `keccak256(encodePacked(["address","string","uint256"], [...]))`
computed locally in `stream/entrypoint.ts`. They match.

## Found and fixed: `shared/abis/AthenaCommit.json` was invalid JSON

`forge inspect AthenaCommit abi` (without `--json`) prints a pretty text
table, not an ABI array — that's what was committed. I rebuilt it as a
correct ABI array from your contract source. If you ever re-export, use
`forge inspect AthenaCommit abi --json > ../shared/abis/AthenaCommit.json`
so it doesn't regress.

## ERC-8183: skipped for now, as discussed

`commit()` calls from Backend B pass `erc8183JobId = bytes32(0)` by
default. No job creation flow wired up on our side yet.

## Phase 4 (stretch): CCTP cross-chain payout, implemented

`backend/cctp/crossChainPayout.ts` — after a stream to provider3 settles
with `predictionMet=true`, Athena can optionally burn USDC on Arc's
`TokenMessengerV2` and mint it on Base Sepolia for provider3 instead of
paying them on Arc. Off by default (`ENABLE_CCTP_PAYOUT=false`). Two real
bugs fixed vs. the original README pseudocode while building this:
`destinationCaller` is `bytes32` not `address`, and `minFinalityThreshold:
1000` is "Fast," not "Standard" as the README comment claimed (`2000` is
Standard/Finalized, confirmed against Circle's CCTP technical guide).

## Something to flag, unrelated to the handoff items above

`shared/addresses.json`'s `"rpc"` field has a Canteen-hosted RPC URL with an
auth token embedded directly in the path, and that file is committed to
git. Backend B's `lib/chain.ts` deliberately does not default to it — but
since it's your file and already in git history, you may want to rotate
that token regardless.

## What's confirmed working on our side (for context, not action items)

`backend/test/smoke.ts` (23/23 passing as of 2026-07-04): RPC reachable,
`computeTaskId` matches, all 3 provider endpoints are real
Gateway-protected x402 routes, provider wallets are Circle-custodied +
funded (~20 USDC/native each) + ERC-8004-registered, MCP quality monitor's
continue/slash logic verified with real recorded calls, entrypoint's
`/stream-task` is itself x402-protected, CCTP's Iris API + Base Sepolia RPC
both reachable. No live financial stream has run yet — that's next.

---

## Original H2 handoff (superseded above, kept for the broker info + history)

Broker (plain EOA, unchanged):

```
broker: 0x27594e2b85e53d3a80095ac25DaD4d8a379F64A3
```

If you still have the original 3 EOA provider wallets registered
(tokenIds 845255-845257), those remain valid on-chain and funded — they're
just no longer the addresses Backend B's providers actually run as. Their
keys are preserved as `PROVIDER{1,2,3}_LEGACY_PK` /
`_LEGACY_WALLET_ADDRESS` in `backend/.env.local`.
