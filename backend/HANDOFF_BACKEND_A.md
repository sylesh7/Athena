# Backend B → Backend A handoff

## H2 — 3 provider wallet addresses + roles

Plain EOAs (generated via `backend/wallets/setup.ts`, same trust model as
your deploy/register scripts — see the "why not Circle custody" note in
`backend/README.md` if curious):

```
provider1: 0x1721E4e606C891b4CaA72b294eea39EAEC719899  (role: provider — crypto price)
provider2: 0xb7521922B2E86f7CAF39D3Cca998744779F68fd6  (role: provider — market analytics)
provider3: 0x1188ff3cd11F2184Cb7FC1a3dE7Cbeb8666E9bb5  (role: provider — aggregated price feed)
```

Broker (not a "provider" for `register-agents.ts`'s purposes, but you'll
want it registered too, per your own script's `AGENT_DEFS`):

```
broker: 0x27594e2b85e53d3a80095ac25DaD4d8a379F64A3
```

**To run `register-agents.ts` you also need the raw private keys** — it signs
with `DEPLOYER_PK`/`PROVIDER{1,2,3}_PK` via viem, and doesn't read this
package's env files. Copy them from `backend/.env.local` over a channel
you're both comfortable with (not this file, not git). None of these
wallets are funded yet, so registration can happen now — funding is
independent of ERC-8004 registration.

## H3 — taskId scheme: confirmed byte-for-byte match

Verified this for real, not just by reading the code: `backend/test/smoke.ts`
calls your deployed `AthenaCommit.computeTaskId(client, desc, blockNumber)`
on-chain and asserts it equals `keccak256(encodePacked(["address","string","uint256"], [...]))`
computed locally in `stream/entrypoint.ts`. They match. No action needed,
just confirming H3 is genuinely closed, not just assumed.

## Found and fixed: `shared/abis/AthenaCommit.json` was invalid JSON

`forge inspect AthenaCommit abi` (without `--json`) prints a pretty text
table, not an ABI array — that's what was committed. Every
`import athenaCommitAbi from ".../AthenaCommit.json"` on both Backend B and
Frontend's side would have failed to parse. I rebuilt it as a correct ABI
array from your contract source (functions, events, errors, the
`Commitment` struct's tuple shape for `getCommitment`) and it's what's in
the repo now. If you ever re-export, use `forge inspect AthenaCommit abi --json > ../shared/abis/AthenaCommit.json` so it doesn't regress.

## ERC-8183: skipped for now, as discussed

`commit()` calls from Backend B pass `erc8183JobId = bytes32(0)` by
default — matches what you described. No job creation flow wired up on our
side yet.

## Something to flag, unrelated to the handoff items above

`shared/addresses.json`'s `"rpc"` field has a Canteen-hosted RPC URL with an
auth token embedded directly in the path, and that file is committed to
git. Backend B's `lib/chain.ts` deliberately does not default to it (falls
back to `rpc_public`, only uses the token'd URL via a local `RPC_URL`
override that's gitignored) — but since it's your file and already in git
history, you may want to rotate that token regardless.

## What's confirmed working on our side (for context, not action items)

`backend/test/smoke.ts` (19/19 passing): RPC reachable, `computeTaskId`
matches, `isCommitted` reads correctly, all 3 provider endpoints are real
Gateway-protected x402 routes (402 without payment, confirmed live), MCP
quality monitor's continue/slash logic verified with real recorded calls,
entrypoint's `/stream-task` is itself x402-protected. No live financial
stream has run yet — wallets aren't funded and providers aren't on the
Circle Marketplace yet, so `commit()`/`reveal()` haven't actually been
called against your contract from our side. That's next once registration
+ funding are done.
