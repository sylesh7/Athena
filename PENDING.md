# Athena — Backend Audit: What's Pending

**Audited against:** `README.md`'s stream-flow diagram, line by line, against the
actual code in `backend/` and `contracts/`. Every claim below has a file:line
citation — nothing here is guessed or inferred from comments/variable names
alone; the actual logic was traced.

**Read this as:** not "who screwed up" — most of this is real, working code.
This is "what's left before the system does what `README.md` says it does,
end to end, with no compromise."

---

## 🔴 Critical — the core innovation doesn't actually prove anything yet

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

---

## 🟠 High — required by `README.md`, currently absent from the live path

### 1. ERC-8183 job never created — `erc8183JobId` is always `0x0`
*(confirmed earlier, restated here for completeness)*

`README.md` step 3 requires the bond to post "into ERC-8183 escrow." The
lifecycle Backend A specified and proved works (`BACKEND_A_README.md`
Phase 2.4, tested live as jobId `147246`) is never invoked automatically.
Backend B's entrypoint always passes `bytes32(0)`, per `BACKEND_B_README.md`
lines 251/257's own admission.

**Fix:** in `backend/stream/entrypoint.ts`, before calling `commit()`, add:
`createJob(provider, evaluator=AthenaCommit address, expiredAt, description, hook=0x0)`
→ `setBudget(jobId, bondAmountUsdc, "")` → `USDC.approve(erc8183, amount)` +
`fund(jobId, "")` → pass the real `jobId` into `commit()`. Provider side needs
a `submit(jobId, deliverableHash, "")` call once its work is done, before
`reveal()` runs.

### 2. ERC-8004 reputation feedback — never posted for either party, in the live flow
`README.md` step 7: *"ERC-8004 ReputationRegistry updated for both broker and
provider."* Zero calls to `giveFeedback()` exist in `entrypoint.ts` or
`streamLoop.ts` (confirmed via grep). The only place this logic exists at all
is `contracts/scripts/post-reputation.ts` — a fully manual, standalone script
requiring hand-set env vars (`VALIDATOR_PK`, `AGENT_ID`, `SCORE`), rating one
agent per invocation. It isn't even registered as an npm script in
`backend/package.json` — the doc comment's `npm run reputation` doesn't
correspond to anything runnable.

**Fix:** wire a post-settlement hook into `streamLoop.ts` (after `reveal()`
confirms) that calls `giveFeedback()` twice — once for the provider (quality
achieved vs. predicted), once for the broker (routing accuracy) — using a
separate validator wallet (self-feedback is blocked, per Backend A's own
docs). Add the missing `"reputation"` script to `backend/package.json` at
minimum as a manual fallback.

### 3. Broker's Circle Gateway deposit — never confirmed by any code, only printed as an instruction
`GatewayClient.pay()` (`streamLoop.ts:118`) needs the broker's wallet to have
USDC *deposited into Gateway* — a different custody than plain wallet
balance. `backend/wallets/setup.ts:99-100` only **prints** the CLI command
(`circle gateway deposit --amount 10 ...`) as a instruction for a human to
run — it never executes or verifies it. The only automated balance check in
the repo (`backend/test/smoke.ts:127-148`) reads the wallet's plain ERC-20
`balanceOf`, not the Gateway-deposited balance. **If this step was never
actually run by a human, every real stream will fail silently at the payment
step**, and nothing in the codebase would catch that before it happens.

**Fix:** two parts. (a) Operationally: confirm right now, out-of-band
(Circle dashboard or `circle gateway balance`), that the broker wallet
actually has a Gateway deposit — don't assume the printed instruction was
followed. (b) In code: extend `smoke.ts` to query the actual Gateway balance
(via Circle's balance API/SDK), not just wallet `balanceOf`, so a missing
deposit is caught by `npm test` instead of failing mid-demo.

---

## 🟡 Medium — working, but fragile or unverified

### 4. Provider discovery (`circle services list`) — real, but parsing is guesswork
`backend/agents/broker.ts:56-91` genuinely shells out to the real CLI (not
hardcoded providers) — but the code's own comment
(`broker.ts:49-55`) admits the pre-1.0 CLI's JSON schema is undocumented, and
the field-extraction (`e.sellerAddress ?? e.address ?? e.wallet`) is
defensive guesswork against a shape nobody has confirmed live.

**Fix:** run `circle services list --chain ARC-TESTNET --category "Financial
Analysis" --output json` for real once, capture the actual shape, and either
firm up the parsing or add a loud startup failure if the shape doesn't match
what's expected (rather than silently falling through to `??` defaults).

### 5. ERC-8004 reputation read — real on-chain call, but failures are invisible
`broker.ts:114-166` really reads `ReputationRegistry.readAllFeedback()`
on-chain — but it's wrapped in a blanket `try { ... } catch { return empty
}` (`broker.ts:117,163-165`), against an ABI struct shape the code's own
comment flags as unverified (`broker.ts:104-112`). A real decode failure and
"provider genuinely has no history yet" currently look identical.

**Fix:** log the actual caught error before falling back to a neutral score,
so a schema break is visible in logs/console during testing instead of
silently masquerading as "no reputation yet."

### 6. Smoke test never runs a real end-to-end stream
`backend/test/smoke.ts`'s ~26 checks are all real, but every one that
touches the live financial path *deliberately stops at the 402 challenge* —
it confirms `/stream-task` requires payment, then stops, by design (to avoid
spending real funds on every `npm test` run). That's reasonable as a
pre-flight check, but it means **no automated test in this repo has ever
proven a real commit → stream → reveal → settle cycle completes.** That can
currently only be shown by actually running it once, live.

**This is exactly what H6 (per `HANDOFF_FRONTEND_FROM_BACKEND_A.md`) is for**
— it's not a separate action item, it's the one thing that would surface
items 2, 3, and 4 above immediately if any of them are broken.

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

1. **Fix the reveal hash proof (Critical)** — this is the actual product claim; everything else is secondary to this being real.
2. **Confirm the broker's Gateway deposit exists** (High #3) — cheapest to check, and blocks everything else from working at all if missing.
3. **Wire ERC-8183 job creation** (High #1) and **ERC-8004 dual feedback** (High #2) — both are "add a call in the post-reveal/pre-commit hook" fixes, similar shape, can be done together.
4. **Run H6 for real** — once 1-3 are done, this is the actual proof the system works, not another code change.
5. Medium items (4, 5, 6) — worth doing, not blocking a first real end-to-end run.
