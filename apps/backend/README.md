# @athena/backend — treasury worker, API and keeper

Implements the Athena treasury backend (see the root README and BACKEND_README phases). Three entrypoints:

| Process | Command | Holds keys? | Does |
|---|---|---|---|
| Worker | `pnpm worker` | operator (+ optional yield/spend/relayer…) | indexer loop, cycle scheduler, commit → execute → reveal, crash recovery, follow-ups |
| API | `pnpm api` | **none** | REST + SSE for the frontend; writes only draft rows / queues triggers for the worker |
| Keeper | `pnpm keeper` | keeper only | flags overdue reveals from its own view of the chain |

## Status against the build phases

"Verified" = exercised by a test against a real contract (local anvil, chain id 5042002) and a real Postgres
(`embedded-postgres`). anvil is **not** Arc: it proves logic, not Arc-specific behavior (blocklists, precompiles, EIP-7708 logs).

| Phase | State |
|---|---|
| 3 shared money/ids/canonical/action | **verified** (`packages/shared`, 7 tests) |
| 4 schema | **verified**: migrations apply cleanly to Postgres 18 (Supabase-only bucket insert is stripped in tests) |
| 6–15 `AthenaTreasury` + tests + deploy/configure scripts | **verified**, 62 Foundry tests incl. invariants; **not deployed to Arc** |
| 15.8 TS↔Solidity parity | **verified** (`test/parity.test.ts`); set `PARITY_RPC_URL`/`PARITY_TREASURY` for the live contract |
| 16 config / db / chain clients / `send()` | **verified** (used by the e2e test) |
| 17 indexer + projections + inflow reconciliation | **verified** (e2e: commit/execute/reveal/escalation/approval/unattributed inflow). Not covered: cross-chain, payee, receivable events |
| 18 snapshot, 19 forecast | snapshot **verified** (e2e); forecast **verified** (unit) |
| 22–23 normalization, duplicates, three-way match, address-change hold | **verified** (unit + `pipeline.test.ts` against real Postgres/contract) |
| 25 policy math + options + default plan, 27 validator | **verified** (unit + e2e) |
| 26 LLM planner (default-plan fallback) | fallback path **verified**; the Anthropic call itself **untested** |
| 28–29 records, commit/execute/reveal/recover | **verified** (e2e + recovery tests) |
| 30 escalation notifier + expiry | message format **verified**; Telegram send + expiry job **untested** |
| 33 CCTP: fee math **verified**; relayer (Iris + `receiveMessage`) **written, untested** |
| 37 cycle orchestrator, worker | **verified** for the AP spine via e2e (default plan); `worker.ts` entrypoint/cron/LISTEN **untested** |
| 29.3 crash recovery, revert handling, 38 keeper + audit breaker | **verified** (`recovery.test.ts`: crash after persist / after commit / after execute, stale commit, revert → cancel+reveal, `ActionMismatch` halt then repair, keeper flags → operator frozen → reveal unfreezes). The keeper *process* wiring (`keeper.ts`) is untested; its check (`keeper/check.ts`) is |
| 40 REST + signed actions + admin draft writes | **verified** (`pipeline.test.ts` starts the API: health, lists, auth, drafts, EIP-191 resolve incl. replay/stale/stranger). SSE stream and `/decisions/:id/verify` over HTTP **untested** |
| 42 metrics | **verified** (e2e, incl. scenario exclusion) |
| 20–21 intake (Storage) + LLM extraction, 24 payee screening/proposal, 35 receivable registration | **written, untested** (need Supabase Storage / Anthropic / Circle; the extracted→obligation pipeline after them is verified) |
| 31 yield, 32 gateway, 34 FX, 36 service purchases | **not started** |
| 35 dunning / email / x402 pay links, 39 reputation, 41 MCP, 43 seed, 44 scenarios, 45–47 | **not started** |

### Bugs the integration tests found and fixed
- viem caches `getBlockNumber` for ~4 s by default, so the indexer could lag a just-mined block; it now passes `cacheTime: 0`.
- The contract emits `DecisionExecuted` *after* `EscalationApproved`; the indexer overwrote `approved` with `executed`.
- Funds sent to the treasury outside `fund()`/`payReceivable()` are (correctly) flagged as unattributed inflows — owner
  deposits must go through `fund(token, amount, OWNER_DEPOSIT)`.

## Run the tests

```bash
cd apps/backend && npx vitest run          # 69 tests: core, planner, screening, cctp, parity, e2e, pipeline+API, recovery (~3 min)
cd packages/shared && npx vitest run       # 7 tests
cd packages/contracts && forge test        # 62 tests
```

Parity and e2e need `anvil` + `forge` on PATH, otherwise they are skipped. e2e also downloads Postgres binaries on first run.

## Going live

See **[docs/SETUP.md](../../docs/SETUP.md)** for the full Supabase / keys / deploy / bootstrap / first-run checklist. Summary:

1. Create the Supabase project; apply `supabase/migrations/*`; insert one `entities` row for the treasury.
2. Deploy: `forge script script/Deploy.s.sol …` then `Configure.s.sol` (packages/contracts), export the ABI to `packages/shared/abis`.
3. Fill `.env.local` from `.env.example`; set `TREASURY_ADDRESS`/`TREASURY_DEPLOY_BLOCK`.
4. Register the three internal payees (yield/spend/fx), approve them from the approver wallet.
5. `pnpm worker`, `pnpm api`, `pnpm keeper` (keeper on a different host).
6. Fund the treasury with `fund(...)`, never a plain transfer.
