# Athena — setup before testing on Arc testnet

This is the checklist to go from "tests pass locally" to "the worker is running against Arc testnet with a real
database". Everything here is a one-time setup. Steps marked **(human)** involve a wallet or account only you control.

> **What you can already trust:** the contract (62 Foundry tests), the shared hashing (parity-tested against the
> contract), and the backend's cycle / indexer / validation / recovery / keeper / API logic (62 tests against a local
> anvil and a real Postgres). **What you are about to test for the first time:** Arc itself, Supabase, Circle's
> Compliance API, and Anthropic. See [Known gaps](#known-gaps--what-not-to-expect) before you start.

## 0. Prerequisites

| Tool | Version | Check |
|---|---|---|
| Node | 22+ (24/26 fine) | `node -v` |
| pnpm | 10+ | `pnpm -v` |
| Foundry (`forge`, `cast`, `anvil`) | recent | `forge --version` |
| Git | any | |
| Canteen CLI (testnet RPC) | latest | `uv tool install git+https://github.com/the-canteen-dev/ARC-cli` |

```bash
pnpm install                      # from the repo root
cd packages/contracts && forge test                    # 62 should pass
cd ../../apps/backend && npx vitest run                # 62 should pass (~3 min; downloads Postgres once)
```

Do not continue until both are green on your machine.

> **Windows note:** if `pnpm <script>` only prints a cmd.exe banner and exits (a machine-level cmd `AutoRun` hook can
> do this), run the underlying commands directly from `apps/backend`:
> `npx tsx scripts/create-keys.ts`, `npx tsx --env-file=.env.local scripts/bootstrap.ts`,
> `npx tsx --env-file=.env.local src/worker.ts` (same pattern for `src/api.ts` and `src/keeper.ts`).
> Tests are `node node_modules/vitest/vitest.mjs run` if `npx vitest run` misbehaves.

## 1. Accounts and keys you need to collect

| What | Where | Used for | Required? |
|---|---|---|---|
| **Canteen testnet RPC URL** | `arc-canteen login` then `arc-canteen rpc-url` | `RPC_URL` | Recommended (public RPC works as fallback) |
| **Supabase project** | supabase.com (section 2) | Postgres + document Storage | Yes |
| **Anthropic API key** | console.anthropic.com | invoice extraction + planner | Yes for invoices; set `PLANNER_MODEL=none` to run without the planner |
| **Circle API key** (`PREFIX:ID:SECRET`) | Circle Developer Console | Compliance Engine screening of payees/customers | Needed to *activate* payees: without it payees stay `draft` (an unscreened payee is never treated as a pass) |
| **Telegram bot token + chat id** | BotFather; `getUpdates` for the chat id | escalation notifications | Optional (falls back to a log line) |
| **Testnet USDC** | faucet.circle.com (Arc Testnet) | gas + treasury float | Yes |

Not needed yet: Circle **Entity Secret**, Developer-Controlled Wallets, App Kit / Earn Kit keys, Resend. Those belong to
the FX, yield and AR-email modules that are not built (see Known gaps).

Model ids: set `PLANNER_MODEL` and `EXTRACTOR_MODEL` to current model ids from Anthropic's model documentation — they
change, so they are deliberately not hard-coded.

## 2. Supabase (step by step)

Dashboard labels move around occasionally; the intent of each step is what matters.

1. **Create a project** (any region near you). Save the **database password** when it is shown — you cannot read it back later.
2. **API credentials** — Project Settings → API:
   - `SUPABASE_URL` = the Project URL (`https://<ref>.supabase.co`)
   - `SUPABASE_SERVICE_ROLE_KEY` = the `service_role` secret. **Server only.** It bypasses Row Level Security;
     never put it in the frontend or commit it.
3. **Apply the schema.** Two options:
   - *SQL editor (simplest):* paste and run `supabase/migrations/0001_init.sql`, then `0002_security.sql`.
   - *CLI:* `npx supabase login && npx supabase link --project-ref <ref> && npx supabase db push`.

   `0002` enables RLS on every table with **no policies** (so only the service role can read/write — the frontend
   goes through the API) and creates the private `documents` Storage bucket.
4. **`DATABASE_URL` — pick the right connection string** (Project Settings → Database → Connection string):
   - The worker uses **session-level features**: `LISTEN/NOTIFY` (event triggers + SSE) and Postgres advisory locks
     (one cycle at a time). These **do not work through the transaction pooler (port 6543).**
   - Use the **Direct connection** (`db.<ref>.supabase.co:5432`). If your host has no IPv6 (some PaaS), use the
     **Session pooler** (port 5432 on the pooler host) instead.
   - Format: `postgresql://postgres:<password>@<host>:5432/postgres`
5. **Verify** from the SQL editor: `select count(*) from information_schema.tables where table_schema='public';`
   should show 24 tables, and Storage should list a private `documents` bucket.
6. *(Optional but recommended)* Settings → Database → enable daily backups if your plan allows. The chain is the
   source of truth for money, but documents and decision records (the exact bytes to reveal) live here.

> If a decision row is ever lost before it is revealed, the contract cannot be un-frozen by that decision's record
> — keep backups, and never run the worker against a database you might wipe while commitments are open.

## 3. Wallets and keys

Every key has one job (see root README "Wallet and key topology"). The backend must never hold admin/approver keys.

### 3a. Human wallets **(human)**
Create two **different** browser/hardware wallets and add Arc Testnet (chain id `5042002`, RPC
`https://rpc.testnet.arc.io`, currency USDC, explorer `https://explorer.testnet.arc.io`):
- **Admin** — deploys and configures; later raises limits and unpauses.
- **Approver** — activates payees and approves escalations from the frontend.

The contract refuses to give the operator role to an admin or approver address, so these cannot be the operator's key.
Fund both from the faucet (they pay gas in USDC).

For `forge` to sign without a key in a file, import them into Foundry's keystore:
```bash
cast wallet import athena-admin --interactive      # paste once; stored encrypted
cast wallet import athena-approver --interactive
```

### 3b. Server keys
```bash
cd apps/backend
pnpm keys:create        # prints OPERATOR_PK, KEEPER_PK, YIELD_PK, … with the public address as a comment
```
Run it **once** and keep the output (re-running makes new keys). Paste the `*_PK=` lines into `apps/backend/.env.local`.
Fund these from the faucet: **operator** (≈5 USDC for gas; the worker runs dry below 2), **keeper** (≈1). Yield/spend/
collections/relayer keys can wait until those modules exist.

> `.env.local` is git-ignored. Never commit it, never paste keys into chat or an issue tracker.

## 4. Deploy the contract

From `packages/contracts`:

```bash
export ADMIN_ADDRESS=0x…       # your admin wallet
export APPROVER_ADDRESS=0x…    # your approver wallet
export OPERATOR_ADDRESS=0x…    # OPERATOR_PK's address from step 3b
export USDC_ADDRESS=0x3600000000000000000000000000000000000000
export TOKEN_MESSENGER_V2=0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA
export RPC_URL=<your Canteen or public RPC>

forge script script/Deploy.s.sol --rpc-url $RPC_URL --account athena-admin --broadcast
```
Note the printed **`AthenaTreasury:`** address and **`Deploy block:`**.

```bash
export TREASURY_ADDRESS=0x…    # from above
export EURC_ADDRESS=0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a
forge script script/Configure.s.sol --rpc-url $RPC_URL --account athena-admin --broadcast
```
`Configure` sets the EURC token, the seven category budgets, the operating floors, and a **payee cooldown of 0** so you can
activate payees immediately while bootstrapping. **Scale the budgets to the funds you actually have** — a 250 USDC
approval limit is meaningless on a 50 USDC treasury (edit the script before running).

After bootstrap, raise the cooldown (testnet demo: 10 minutes):
```bash
cast send $TREASURY_ADDRESS "setConfig(uint64,uint64,uint64,uint32,uint16)" 600 259200 7200 1000 100 \
  --rpc-url $RPC_URL --account athena-admin
```
`7200` must equal `REVEAL_DEADLINE_BLOCKS` in your env — the worker refuses to start on a mismatch.

Optional: verify source on the explorer so others can read it (verifier flags depend on the explorer; see README Phase 15.7).

## Current deployment (Arc testnet)

| | |
|---|---|
| `AthenaTreasury` | `0xcf0d101a556a79e3d673c0dad2a6e5c16d27e947` ([explorer](https://explorer.testnet.arc.io/address/0xcf0d101a556a79e3d673c0dad2a6e5c16d27e947)) |
| Deploy block | `66509127` |
| Roles | admin `0x35Cf…255c`, approver `0x1722…e331`, operator `0x8cc8…4A13` (verified on-chain; the deployer holds no role) |
| Cooldown / reveal deadline | `0` (bootstrap) / `7200` blocks ≈ 60 min at Arc's measured ~0.5 s block time |
| State | **Not yet configured**: no budgets, floors or supported EURC until the admin runs the step below |

### Admin step: configure (needs YOUR admin wallet — the backend never holds that key)

The simulated calls all succeed (checked as the admin address via `eth_call`; the approver is correctly refused).
`BUDGET_SCALE_PERCENT=2` keeps the 100 USDC operating floor and 250 USDC approval limit proportionate to a ~20 USDC
testnet treasury (VENDOR budget 40, approval limit 5, floor 2 USDC). Use `100` only with real float.

PowerShell, from `packages/contracts`:
```powershell
$env:TREASURY_ADDRESS = "0xcf0d101a556a79e3d673c0dad2a6e5c16d27e947"
$env:USDC_ADDRESS     = "0x3600000000000000000000000000000000000000"
$env:EURC_ADDRESS     = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a"
$env:BUDGET_SCALE_PERCENT = "2"
cast wallet address --account athena-admin      # must print 0x35Cf7Fbc…2255c — if not, import the right key first
forge script script/Configure.s.sol --rpc-url https://rpc.testnet.arc.io --account athena-admin --broadcast
```
Foundry prompts for the keystore password. If the public RPC resets the connection mid-run, add
`--slow` or retry with the Canteen RPC.

Then re-run `npx tsx --env-file=.env.local scripts/bootstrap.ts` (proposes the internal yield/spend payees; the approver
activates them), put float into the treasury with `fund()`, and raise the cooldown (section 4).

## 5. Environment file

Copy `apps/backend/.env.example` → `apps/backend/.env.local` and fill it in:

| Variable | Value |
|---|---|
| `NETWORK` | `testnet` |
| `RPC_URL` / `RPC_URL_FALLBACK` | Canteen RPC / `https://rpc.testnet.arc.io` |
| `TREASURY_ADDRESS`, `TREASURY_DEPLOY_BLOCK` | from step 4 |
| `ADMIN_ADDRESS`, `APPROVER_ADDRESS` | your human wallets (public addresses only) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` | step 2 |
| `OPERATOR_PK` (+ `KEEPER_PK`) | step 3b |
| `ANTHROPIC_API_KEY`, `PLANNER_MODEL`, `EXTRACTOR_MODEL` | step 1 (`PLANNER_MODEL=none` = deterministic default plan only) |
| `CIRCLE_API_KEY` | step 1 (enables payee screening) |
| `ADMIN_API_KEY` | a random string, ≥ 24 chars (`openssl rand -hex 24`) — header `x-admin-key` for admin routes |
| `API_PORT` / `CORS_ORIGIN` / `PUBLIC_BASE_URL` / `FRONTEND_URL` | `3100` / `http://localhost:3000` / `http://localhost:3100` / `http://localhost:3000` |
| `OPERATOR_ENABLED` | `true` (`false` = kill switch: no new cycles, reveals/recovery keep running) |
| `DRY_RUN` | **start with `true`** (section 7) |

Never commit an RPC URL that embeds an auth token (the Canteen URL does).

## 6. Bootstrap

```bash
cd apps/backend
pnpm bootstrap
```
This inserts the `entities` row, checks the operator key really holds `OPERATOR_ROLE`, and (when their addresses/keys are
in env) proposes the internal yield/spend/FX payees, printing the exact `cast send … approvePayee` command for the approver.
Safe to re-run.

Then **(human)** register and approve your first real vendor:
```bash
curl -s -X POST http://localhost:3100/payees -H "x-admin-key: $ADMIN_API_KEY" -H "content-type: application/json" \
  -d '{"slug":"vendor:hosting","name":"Hosting Co","kind":"vendor","category":"VENDOR","token":"USDC","account":"0xVendorAddress"}'
```
The worker screens it (Circle) and proposes it on-chain; **you** approve from the approver wallet:
`cast send $TREASURY_ADDRESS "approvePayee(bytes32)" <payee_id> --rpc-url $RPC_URL --account athena-approver`.
(`payee_id` is in the `/payees` response.) Then put real testnet USDC *into the treasury with `fund()`*, not a plain
transfer — a plain transfer is (correctly) flagged as an unattributed inflow:
```bash
cast send $USDC "approve(address,uint256)" $TREASURY_ADDRESS 200000000 --rpc-url $RPC_URL --account athena-admin
cast send $TREASURY_ADDRESS "fund(address,uint256,bytes32)" $USDC 200000000 $(cast keccak OWNER_DEPOSIT) --rpc-url $RPC_URL --account athena-admin
```

## 7. First run — dry run before real money

```bash
pnpm worker       # terminal 1  (DRY_RUN=true: plans and records decisions, sends no transactions)
pnpm api          # terminal 2
pnpm keeper       # terminal 3  (ideally a different machine; needs KEEPER_PK funded)
```
Smoke checks:
```bash
curl -s localhost:3100/health                      # ok, block, paused:false, overdueCount:"0"
curl -s -X POST localhost:3100/admin/cycle/dry-run -H "x-admin-key: $ADMIN_API_KEY"   # 202 queued
curl -s localhost:3100/cycles                      # step timings per cycle
curl -s localhost:3100/treasury/overview           # snapshot (balances, budgets)
```
Then upload an invoice (PDF, ≤10 MB) and watch it become an obligation or a hold with a reason:
```bash
curl -s -X POST localhost:3100/invoices/upload -H "x-admin-key: $ADMIN_API_KEY" -F "file=@invoice.pdf"
curl -s "localhost:3100/invoices?status=held"
curl -s "localhost:3100/obligations"
```
When the dry-run records look right (`/decisions/:id` shows the record JSON; `/decisions/:id/verify` shows a hash match),
set `DRY_RUN=false`, restart the worker, and trigger one real cycle with `POST /admin/cycle/run`. Check the commit,
execute and reveal links on the explorer for each decision.

## 8. Things to verify on the *real* chain (anvil can't prove these)

Arc differs from the local test chain. Check each once and note the result:
1. **Block time** — call `eth_blockNumber` twice, 60 s apart. If blocks are faster than ~0.5 s, raise
   `revealDeadlineBlocks` (and `REVEAL_DEADLINE_BLOCKS`) so the window is still about an hour.
2. **USDC decimals** — payments use the 6-decimal ERC-20 at `0x3600…0000`; native gas is 18-decimal. A balance off by
   ~10¹² means you read the wrong one.
3. **Indexer on Arc** — after the first real payment, `chain_events` should contain `DecisionCommitted` /
   `DecisionExecuted` / `DecisionRevealed`, and `unattributed_inflows` should be empty. Arc also emits EIP-7708 logs for
   native transfers; the indexer filters ERC-20 `Transfer` by token address to avoid double counting — confirm no
   duplicates.
4. **CCTP `depositForBurn` signature** — verify against the verified implementation on the explorer before any
   cross-chain payee is activated (README Phase 6.1).
5. **Circle Compliance response** — screening maps `APPROVED/DENIED` + rule/actions to tiers; confirm one real response
   matches `payees/screening.ts`.

## 9. Known gaps — what not to expect

Yield, Gateway, FX, x402, dunning/pay links, reputation (ERC-8004) and the MCP server are built; most were verified live
(see `apps/backend/README.md`). Still pending: the **fifteen live scripted scenarios** (waiting on the admin configure tx)
and the **mainnet** work. Seed the house dataset with `pnpm seed` and print the daily report with `pnpm traction`.

Written but not yet run against live services: OpenAI planner/extractor inside a full cycle (key works; one-call check
passed), Resend email, the Telegram notifier inside the worker, the CCTP relayer, and `worker.ts` cron/LISTEN wiring.
Expect to debug these on first contact, starting with the worker log.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Worker exits: `REVEAL_DEADLINE_BLOCKS=… but contract revealDeadlineBlocks=…` | Env and `setConfig` disagree. Make them equal. |
| Worker exits: `… does not hold OPERATOR_ROLE` | `OPERATOR_PK` is not the `OPERATOR_ADDRESS` used at deploy. Redeploy or grant the role (admin). |
| `LISTEN` works locally but events never arrive | `DATABASE_URL` points at the **transaction pooler (6543)**. Use Direct or Session pooler. |
| Cycle says `another cycle holds the lock` | A previous worker still holds the advisory lock; wait or restart it. |
| Cycle runs dry unexpectedly | Operator native balance < 2 USDC (gas floor). Fund it. |
| Payee stuck in `draft` | No `CIRCLE_API_KEY`, or screening unavailable (it retries). Unscreened ≠ approved. |
| Obligation held with `risk_hold` / never paid | Category requires evidence and the obligation has no `evidence_hash` (it did not come from a matched invoice), or the payee tier is high/blocked. |
| `AuditInArrears` on commit | A reveal is overdue. The worker's recovery reveals stored bytes; check why it stopped (DB reachable? worker running?). |
| `ActionMismatch` → "operator halted" | Stored action differs from the committed one — a bug, deliberately not auto-recovered. Inspect the decision row, fix, then restart the worker. |
| API 500 on `/health` | RPC unreachable or `TREASURY_ADDRESS` wrong. |
| Amounts look wrong by a huge factor | Native 18-decimal vs ERC-20 6-decimal USDC. |

## Frontend (Next.js, `frontend/`)

```bash
cd frontend && npm install
# frontend/.env.local (git-ignored):
#   NEXT_PUBLIC_ATHENA_API=http://localhost:3100      # the API the browser talks to (reads, SSE, signed approver actions)
#   ATHENA_ADMIN_API_KEY=<same as the backend ADMIN_API_KEY>   # SERVER-ONLY: used by /api/cycle, /api/upload, /api/receivables, /api/payees
npm run build && npm start        # or: npm run dev
```
- Reads, the SSE live feed and the verify panel talk to the API directly. Anything that needs the admin key (run cycle, upload
  invoice, issue receivable, add payee) goes through a same-origin Next route that holds the key server-side; they only ever
  create **drafts** and are rate-limited — money still needs the on-chain approver.
- Approver actions are real wallet transactions/signatures: connect the **approver** wallet (MetaMask) on Arc Testnet to
  approve/reject escalations, activate/suspend payees, and sign invoice releases and decision reviews. Customers pay a
  receivable from `/pay/<receivableId>` with their own wallet.
- If the API is unreachable the pages fall back to demo data (console warning); an API *error* is shown, not hidden.
- Production: set `NEXT_PUBLIC_ATHENA_API` to the public API URL and add the frontend origin to the backend `CORS_ORIGIN`.

### Local network note
The worker's database LISTEN connection and the pg pool now self-heal on dropped connections (heartbeat + reconnect); on a
flaky network expect `LISTEN connection lost — reconnecting` warnings, not a crash.
