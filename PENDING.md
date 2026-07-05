# Athena — Backend Audit: What's Pending

**Audited against:** `README.md`'s stream-flow diagram, line by line, against the
actual code in `backend/` and `contracts/`. Every claim below has a file:line
citation — nothing here is guessed or inferred from comments/variable names
alone; the actual logic was traced.

**Read this as:** not "who screwed up" — most of this is real, working code.
This is "what's left before the system does what `README.md` says it does,
end to end, with no compromise."

---

## Status tracker

| Item | Status |
|---|---|
| 🔴 Critical — commit-reveal hash unverifiable + early seal leak | ✅ **FIXED** 2026-07-05 |
| 🟠 High #1 — ERC-8183 job never created | ✅ **FIXED** 2026-07-05 |
| 🟠 High #2 — ERC-8004 reputation feedback missing | ✅ **FIXED** 2026-07-05 |
| 🟠 High #3 — Broker Gateway deposit unconfirmed | ✅ **FIXED** 2026-07-05 (code portion — operational check still needed) |
| 🟡 Medium #4 — Provider discovery parsing unverified | ✅ **FULLY FIXED** 2026-07-05 (real `search` verb/shape + Arc-Testnet filter + own-provider fallback — verified live) |
| 🟡 Medium #5 — Reputation read silent-catch | ✅ **FIXED** 2026-07-05 |
| 🟡 Medium #6 — Smoke test never runs real E2E | ✅ **FIXED** 2026-07-05 (opt-in Tier 5 — still needs an actual funded run) |
| 🔴 #7 (found live, not in original audit) — Gateway facilitator URL defaulted to mainnet | ✅ **FIXED** 2026-07-05 |
| 🔴 #8 (found live, not in original audit) — ERC-8183 `createJob` reverts (`ExpiryTooShort`) | ✅ **FIXED** 2026-07-05 |
| 🔴 #9 (found live, not in original audit) — ERC-8004 `readErc8004Reputation` calls nonexistent `tokenOfOwner`, reverts for every provider | ✅ **FIXED** 2026-07-05 |

---

## 🔴 Critical — the core innovation doesn't actually prove anything yet

### ✅ FIXED (2026-07-05)

The decision preimage is now sealed at commit time (`state.ts`'s
module-private `sealCommitment`/`getSealedCommitment`, never exposed via
`getStream`/`listStreams`) and only copied into the public `StreamStatus` —
`commitHash`, `decisionPreimage`, plus a live `callHistory` feed — once the
stream is actually revealed. Anyone can now pull the revealed preimage,
rehash it themselves, and diff against `getCommitment(taskId).commitHash`
read directly on-chain — that's the actual proof this was missing.

Also fixed the adjacent leak found while tracing this: `predictedQualityScore`/
`predictedLatencyMs`/`selectedProviderUrl` used to be exposed immediately at
request time, before `commit()` even landed — now genuinely sealed until
`phase === "revealed"`, matching `README.md`'s "shown once revealed" intent.

**Critical safety note honored in the fix:** the pre-reveal integrity
recompute is a corruption/regression guard only (same process/trust
boundary, not external verification) — on a mismatch it logs loudly and sets
`preimageIntegrityWarning: true`, but the actual `reveal()` call **always**
uses the originally-sealed hash, never the recomputed one. `AthenaCommit.sol`
has no cancel/timeout/recovery function, so substituting a "corrected" hash
would have guaranteed a `HashMismatch` revert and permanently stranded the
bond.

**Files touched:** `backend/stream/state.ts`, `backend/stream/streamLoop.ts`,
`backend/stream/entrypoint.ts`, `contracts/src/AthenaCommit.sol`
(comment-only, `forge build` confirmed clean), `backend/test/smoke.ts` (new
field-list drift guard), `backend/HANDOFF_FRONTEND.md` (updated contract
docs). `npm run typecheck` passes.

**What this does not achieve** (by design, given the contract can't be
redeployed): on-chain cryptographic enforcement that `predictionMet` itself
is truthful — the contract still takes it as an unconstrained boolean.
Transparency/auditability was the achievable fix; full on-chain enforcement
wasn't. See the original writeup below for the full problem description.

<details>
<summary>Original problem writeup (for reference — click to expand)</summary>

### The commit-reveal hash is circular. It can never fail unless there's a bug.

This is the most important finding in this whole audit, because "commit-reveal
tied to a falsifiable per-call prediction" is the project's #1 Innovation
pitch (`README.md` judging table, 20% weight).

**What `README.md` says (step 5):** *"Athena reveals structured decision
object on-chain → AthenaCommit.sol verifies SHA-256(revealed) == committed
hash."* This describes an independent re-hash at reveal time, verified
on-chain — a real cryptographic proof that Athena didn't change its
prediction after seeing results.

**What's actually built:** `streamLoop.ts:77` computes `commitHash` once, in
memory, before the stream starts. At reveal time (`streamLoop.ts:155-159`),
that exact same in-memory variable is handed back to the contract as
`revealedHash` — it is never recomputed from anything. There is no second
call to `sha256Hex(canonicalJson)` anywhere in the file.

Worse: the contract itself (`contracts/src/AthenaCommit.sol:180-190`) never
receives the decision JSON at all — only two `bytes32` values, at two
different times:
```solidity
if (revealedHash != c.commitHash) revert HashMismatch();
```
Both values were supplied by the broker. The chain is comparing the broker's
word against the broker's word. This can only ever fail from a bug in the
broker's own process — it provides **zero cryptographic guarantee** that the
committed hash corresponds to any real, unaltered decision object, and zero
proof that "Athena couldn't have adjusted its prediction after seeing
results" (the exact claim in `streamLoop.ts:148-151`'s own comment).

**Why this matters more than it might look:** right now, *nothing* stops the
broker from committing a hash, watching how the stream actually performs, and
then computing whatever hash is convenient to reveal. The mechanism as-built
enforces nothing.

**The real fix:** the missing piece is that nobody outside the broker's own
process can currently recompute the hash to check it. Fix this by publishing
the actual decision JSON (or the fields needed to reconstruct it) via
`GET /stream-status/:taskId` once revealed — so the frontend (or a judge, or
an auditor) can independently run `SHA-256(canonicalJSON)` themselves and
compare it against the on-chain `commitHash` read via `getCommitment()`. That
turns "the broker says it checked" into "anyone can check." This needs a
small addition to `streamLoop.ts`'s in-memory stream state and
`entrypoint.ts`'s `/stream-status` response shape — store the original
decision object alongside the hash, and expose it after reveal (not before,
or it defeats the seal).

</details>

---

## 🟠 High — required by `README.md`, currently absent from the live path

### 1. ERC-8183 job never created — `erc8183JobId` is always `0x0`

### ✅ FIXED (2026-07-05) — initially misdiagnosed as blocked, wasn't

First pass concluded this was structurally impossible: `setBudget()`/
`submit()` are provider-role calls, and Athena's provider wallets are Circle
Developer-Controlled Wallets with no exposed raw private key — so nothing
could sign as the provider. **That conclusion was wrong**, caught by
pushback rather than by re-checking it myself first: `@circle-fin/developer-
controlled-wallets`' `createContractExecutionTransaction()` lets a DCW sign
*any* contract call server-side, without ever exposing a key — and
`wallets/registerCircleProviders.ts` already used exactly this mechanism for
a different contract call (`IdentityRegistry.register`). The "impossible"
part was never actually checked before being declared.

**What's built:** new `backend/lib/erc8183.ts` — `createAndFundJob()` (broker
creates the job + funds it via its own raw key, provider sets the budget via
Circle's Transaction API) and `submitDeliverable()` (provider submits via
the same API, hash of the stream's real `callHistory` — not a placeholder).
Wired into `streamLoop.ts`: job creation happens before `commit()` (its
`jobId` is a required `commit()` param), `submitDeliverable()` happens after
the stream loop and before `reveal()`. Both wrapped in try/catch — non-fatal
by design, matching how `AthenaCommit.sol`'s own `_settleERC8183` already
tolerates a job that failed or was never submitted (emits
`ERC8183Settled(settled=false)` rather than reverting) — so a Circle API
hiccup degrades gracefully instead of blocking the core commit-reveal-bond
flow, which works independently of ERC-8183 either way.

Also added `erc8183JobId` to the public `/stream-status/:taskId` shape (not
sensitive, just a public on-chain reference) and widened `AthenaAddresses`'
type in `lib/config.ts` to include `circleWalletId`/`custody`, which were
already in the actual JSON but untyped.

**Files touched:** `backend/lib/erc8183.ts` (new), `backend/stream/streamLoop.ts`,
`backend/stream/state.ts`, `backend/lib/config.ts`, `backend/HANDOFF_FRONTEND.md`.
`npm run typecheck` passes.

### 2. ERC-8004 reputation feedback — never posted for either party, in the live flow

### ✅ FIXED (2026-07-05)

Added `backend/lib/reputation.ts` — a `postStreamReputation()` helper reusing
the same `giveFeedback()` logic as the old manual script, but callable from
code. Wired into `streamLoop.ts` as a fire-and-forget post-settle hook (same
non-blocking convention as the existing CCTP payout call) that posts
feedback for **both** the provider (tag `"quality"`) and the broker (tag
`"routing"`), scored from the real observed average quality across
`callHistory` (falls back to a binary 100/0 on `predictionMet` only if zero
calls completed). Address→tokenId resolution reads `shared/addresses.json`'s
`agents` section, per the project's own "never hardcode" rule.

Requires a new `VALIDATOR_PK` env var (added to `.env.example` with
rationale) — a wallet that is NOT the broker's or any provider's own key,
since ERC-8004 blocks an agent from rating itself. **If `VALIDATOR_PK` isn't
set, this logs a warning and skips feedback rather than failing the
stream** — so this needs an actual validator wallet generated/funded before
it does anything live; the code path is real, the wallet provisioning is an
operational step still needed (see High #3's same caveat).

**Files touched:** `backend/lib/reputation.ts` (new), `backend/stream/streamLoop.ts`,
`backend/.env.example`. `npm run typecheck` passes.

### 3. Broker's Circle Gateway deposit — never confirmed by any code, only printed as an instruction

### ✅ FIXED — code portion (2026-07-05); operational check still outstanding

Added a real check to `test/smoke.ts` Tier 0: instantiates a `GatewayClient`
with the broker's own key and calls the SDK's documented `getBalances()`
(returns `{ wallet, gateway: { available, ... } }` — confirmed from the
package's own `.d.ts`, not guessed), and fails loudly with the exact `circle
gateway deposit ...` command to run if `gateway.available === 0n`. This is
now caught by `npm test` instead of only surfacing as a real stream failing
silently mid-payment.

**What's still outstanding — this is operational, not code:** the check
will tell you if the deposit is missing, but nobody has actually confirmed
right now whether the broker's Gateway deposit exists. **Run `npm test` (or
just `circle gateway balance --address <broker> --chain ARC-TESTNET`) before
relying on this working** — that's the one action item left here, and it's
on whoever has Circle CLI access, not something I can check from here.

**Files touched:** `backend/test/smoke.ts`.

---

## 🟡 Medium — working, but fragile or unverified

### 4. Provider discovery (`circle services list`) — real, but parsing is guesswork

### ✅ FULLY FIXED (2026-07-05) — the earlier "visibility only" fix above was superseded

The "visibility only" fix above was written before anyone had run the real
CLI live. Once `npm run dev` actually attempted a real stream, it hit:
`Error: Unknown verb "list" for resource "services"`. Investigated live
(`circle services --help`, `circle services search --help`, then a real
`circle services search --category FINANCIAL_ANALYSIS --output json` run)
and found the previous assumptions were wrong in every dimension:

- The verb is `search`, not `list` (`list` doesn't exist at all).
- There is no `--chain` flag — `search` can't be scoped to a chain server-side.
- `--category` must be `UPPER_SNAKE_CASE` (e.g. `FINANCIAL_ANALYSIS`), not
  free text like `"Financial Analysis"`.
- The real response is deeply nested, not a flat array:
  `{ data: { items: [{ resource, accepts: [{ network, payTo, amount, asset,
  ... }], metadata: { provider: { name, category, ... } } }] } }` — nothing
  like the `e.sellerAddress ?? e.address ?? e.wallet` flat-field guessing
  the old code did.
- **Bigger finding:** filtered all 50 real results (category
  `FINANCIAL_ANALYSIS`) for any `accepts[]` entry on `eip155:5042002` (Arc
  Testnet). **Zero matched.** Every real listing was Base/Polygon/Ethereum
  mainnet/Avalanche/Arbitrum/Optimism, from providers "Allium" and "AIsa
  API." The Circle Agent Marketplace currently has no Arc Testnet listings
  in this category at all — including our own registered provider1/2/3,
  which apparently aren't (yet) surfaced by marketplace search on this
  chain.

**Fix implemented:** `discoverProviders()` now calls the real `search` verb
with correct flags, parses the real nested shape, and filters `accepts[]`
for an Arc-Testnet-compatible entry (using `payTo`/`amount` from that entry,
not invented flat fields). If that yields zero results — which is the
current live reality — it falls back to `KNOWN_ARC_PROVIDERS`, a small
hardcoded list of Athena's own 3 registered providers (real addresses from
`shared/addresses.json`, real ports/routes from `agents/provider{1,2,3}.ts`,
matching `test/smoke.ts`'s own health-check registry). Real discovery still
runs first every time; the fallback only kicks in when the marketplace
genuinely has nothing usable on our chain, which is provably the current
state, not a hypothetical.

Also updated `stream/entrypoint.ts`'s default `category` from `"Financial
Analysis"` to `"FINANCIAL_ANALYSIS"` to match the marketplace's real enum
casing.

**Files touched:** `backend/agents/broker.ts`, `backend/stream/entrypoint.ts`.
Verified with `npm run typecheck` (clean).

---

### 7. Gateway facilitator URL defaulted to mainnet — every paid request failed until fixed

### ✅ FIXED (2026-07-05) — found and fixed live, mid-E2E-test

Discovered while actually running a live paid `/stream-task` call for the
first time: every `GatewayClient.pay()` attempt failed with `"No Gateway
batching option available for network eip155:5042002."` Root cause,
confirmed from `@circle-fin/x402-batching/server`'s own `.d.ts`:
`createGatewayMiddleware()`'s `facilitatorUrl` defaults to Circle's
**mainnet** Gateway facilitator (`https://gateway-api.circle.com`) unless
explicitly overridden — it has never heard of Arc Testnet. A prior comment
in `providerServer.ts` wrongly claimed testnet was already the default.

**Fix:** added `GATEWAY_TESTNET_FACILITATOR_URL =
"https://gateway-api-testnet.circle.com"` to `lib/config.ts`, passed
explicitly as `facilitatorUrl` in both call sites
(`agents/providerServer.ts` and `stream/entrypoint.ts` — confirmed via grep
these are the only two `createGatewayMiddleware` usages). Also confirmed
this requires restarting any already-running `npm run dev` process — it
doesn't hot-reload past its own import graph.

**Also hit while live-testing:** the `circle gateway deposit` CLI command
fails with `"No local wallet matches <address> ... Run circle wallet
login"` for any wallet whose raw private key we generated ourselves
(broker, test-client) — the CLI only manages wallets it created or Circle
DCW wallets. Fixed by adding `backend/wallets/depositGateway.ts`, which
calls `GatewayClient.deposit()` directly using the key we already hold
(`PK=0x... AMOUNT=10 npm run wallets:deposit-gateway`). Note: Gateway's
balance indexer lags a real on-chain deposit by ~15s — a `0` balance
immediately after depositing is not a bug, re-query after a short wait.

**Files touched:** `backend/lib/config.ts`, `backend/agents/providerServer.ts`,
`backend/stream/entrypoint.ts`, `backend/wallets/depositGateway.ts`,
`backend/package.json` (new `wallets:deposit-gateway` script).

### 5. ERC-8004 reputation read — real on-chain call, but failures are invisible

### ✅ FIXED (2026-07-05)

The `catch` block now `console.error`s the actual caught error (with context
noting ERC-8004 is a Draft EIP whose encoding may have drifted) before
falling back to the neutral score — a real decode failure is no longer
indistinguishable from "provider has no history yet" in the logs, even
though both still route the same way for now.

**Files touched:** `backend/agents/broker.ts`.

### 6. Smoke test never runs a real end-to-end stream

### ✅ FIXED (2026-07-05)

Added Tier 5 to `test/smoke.ts` — opt-in only (`RUN_LIVE_E2E=true` +
`TEST_CLIENT_PK`, skipped by default like every other tier's prerequisite
check), since unlike every other check this one genuinely spends real
testnet USDC/gas. When run, it makes a real `GatewayClient.pay()` call
against `/stream-task`, polls `/stream-status/:taskId` for up to 2 minutes,
and asserts the stream reaches `"settled"` with `commitHash`/
`decisionPreimage` actually present — directly exercising the Critical fix
above, not just checking that a 402 challenge exists.

**This doesn't replace H6** (the full 3-person call verifying Backend A sees
it land on Arcscan) — it's a repeatable, automatable version of the same
underlying claim, runnable solo before that call to catch regressions
early.

**Files touched:** `backend/test/smoke.ts`.

### 8. ERC-8183 `createJob` reverts live with `ExpiryTooShort()`

### ✅ FIXED (2026-07-05) — found live during a real manual stream (not smoke.ts)

`lib/erc8183.ts`'s `createAndFundJob()` computed `expiredAt` as
`currentBlock + 100_000n` — a block-number-scale value (~50.3M). A real
manual stream through `npm run dev` hit a revert with an unrecognized
selector `0xf7a0748c`; `cast 4byte 0xf7a0748c` decoded it as
**`ExpiryTooShort()`**. The real deployed ERC-8183 contract checks
`expiredAt` against `block.timestamp` (~1.77B), not block number — a
block-number-scale value reads as already-expired. `IERC8183.sol`'s own doc
comment ("Block number after which...") was simply wrong.

**Fix:** `expiredAt` is now `(await publicClient.getBlock()).timestamp +
86_400n` (24h from now, a real unix timestamp). Updated the stale doc
comment in `IERC8183.sol` to match. Comment-only contract change — `forge
build` still compiles clean, no redeploy needed (this interface isn't the
deployed contract, just our reference to it).

**Files touched:** `backend/lib/erc8183.ts`, `contracts/src/interfaces/IERC8183.sol`.

### 9. ERC-8004 reputation read calls a function that doesn't exist on the real contract

### ✅ FIXED (2026-07-05) — found live, same manual stream as #8

`readErc8004Reputation()` called `tokenOfOwner(address) returns (uint256)`
on the IdentityRegistry to resolve a provider's tokenId — this function
does not exist on the real deployed contract. Per our own
`IERC8004.sol`, IdentityRegistry only exposes `register`, `ownerOf(tokenId)`,
and `tokenURI(tokenId)` — no reverse address→tokenId lookup at all. Every
call reverted (confirmed live for all 3 providers), silently falling back to
a neutral reputation score every single time — routing "worked" but never
actually used real on-chain reputation.

**Fix:** removed the on-chain lookup entirely. Every agent's real tokenId is
already recorded in `shared/addresses.json` at registration time (Backend
A's job) — `findAgentTokenId()` now just matches on address there instead.
Simpler and it's the only version that actually works.

**Files touched:** `backend/agents/broker.ts`.

---

## Not a bug, just a naming nitpick

- `README.md` calls the session-start fee a "nanopayment," but the actual
  price is `gateway.require("$0.01")` (`entrypoint.ts:41`) — one cent, not
  nano-scale. The *per-call* streaming payments genuinely are nano-scale
  ($0.000001, confirmed in provider files). This is loose wording in the
  top-level README, not a code issue — no fix needed, just don't be
  surprised the "nanopayment" language only applies to the per-call loop.

---

## What's already fully real (no action needed)

- x402/Gateway middleware on `/stream-task` — genuine `createGatewayMiddleware`
- SHA-256 commit-hash computation + deterministic canonical JSON — correct algorithm, correct sort-based canonicalization (the *computation* is right; only the *re-verification at reveal* is missing — see Critical section)
- `GatewayClient.pay()` per-call payments — real Circle Gateway SDK, not plain `fetch()`
- MCP quality monitor — genuine separate FastMCP server (`streamable-http`, not stdio), real MCP client/server protocol round trip, not a renamed local function
- Consecutive-failure slash threshold — confirmed N = 3 (`monitor.py:24`)
- All 3 provider endpoints — real Gateway protection, real `qualityScore`/`latencyMs` in every response
- CCTP Phase 4 cross-chain payout — real automatic trigger, correctly gated on `predictionMet && isProvider3 && ENABLE_CCTP_PAYOUT==="true"`, no mocked attestation

---

## Suggested order of operations

**Everything in this file is now code-complete** (Critical, High #1/#2/#3,
Medium #4/#5/#6) as of 2026-07-05. What's left is entirely operational, not
coding:

1. **Confirm the broker's Gateway deposit exists** (High #3) — run `npm
   test`, look for the new Tier 0 check. Cheapest to check, and blocks
   everything else (including ERC-8183's `fund()` and every `GatewayClient.pay()`
   call) if missing. **Do this first.**
2. **Provision `VALIDATOR_PK`** (High #2) in `backend/.env.local` — a wallet
   that is NOT the broker's or any provider's own key — or reputation
   feedback keeps logging a warning and skipping.
3. **Run `circle services list --output json` for real once** (Medium #4) —
   confirm the live schema still matches what `broker.ts` assumes; the new
   warning log will tell you if it doesn't.
4. **Run the new Tier 5 as a solo dry run**: `RUN_LIVE_E2E=true
   TEST_CLIENT_PK=0x... npm test` — drives one real commit → stream → reveal
   → settle cycle end to end, and specifically asserts `commitHash`/
   `decisionPreimage` are present on settle (i.e. the Critical fix didn't
   regress). Cheaper and faster to iterate on than H6 since it's solo.
5. **Then run H6 for real** — all three of you on a call, frontend submits
   through the UI, Backend A confirms on Arcscan. This is the actual finish
   line; everything above just de-risks it.
