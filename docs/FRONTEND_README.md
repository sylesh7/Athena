# Athena — Frontend Build README
### The treasury console, the audit trail and the pay page · Tameion Agents Hackathon (Canteen × Circle × Arc)

> **What this file is:** the complete, phase-by-phase build guide for everything a person sees: the public treasury view, the audit trail with in-browser verification, the approver console where a human signs escalations with their own wallet, the admin console, the customer pay page, and the traction page judges will read.
> **Who it is for:** whoever is building the web app. Each phase is small, ends with an exit check, and assumes the earlier phases are finished.
> **Companion document:** `BACKEND_README.md`. This file never redefines a backend behavior; when it needs one, it names the backend phase. Endpoint shapes come from the backend's Phase 40 and its `openapi.yaml`.
> **Validated against official sources on:** October 9, 2026. Anything marked ⚠️ VERIFY must be checked against the live source before you rely on it.
> **Deadline:** October 17, 2026, 11:59 PM ET.

---

## Table of contents

- [Part A — Read this before writing code](#part-a--read-this-before-writing-code)
  - [A1. What the frontend is](#a1-what-the-frontend-is)
  - [A2. Who uses it, and what each person can do](#a2-who-uses-it-and-what-each-person-can-do)
  - [A3. Frontend principles](#a3-frontend-principles)
  - [A4. How the frontend earns points with the judges](#a4-how-the-frontend-earns-points-with-the-judges)
  - [A5. Design language](#a5-design-language)
  - [A6. Sitemap and navigation](#a6-sitemap-and-navigation)
  - [A7. Where every number on screen comes from](#a7-where-every-number-on-screen-comes-from)
  - [A8. Pinned facts for the browser](#a8-pinned-facts-for-the-browser)
  - [A9. Repository layout](#a9-repository-layout)
  - [A10. Environment variables](#a10-environment-variables)
- [Part B — The build, phase by phase](#part-b--the-build-phase-by-phase)
  - Foundations: Phases 0–4 (tools, scaffold, design tokens, primitives, formatting)
  - Talking to the chain and the API: Phases 5–9 (chains and wallets, roles, API client, live events, sessions)
  - The shell and the front door: Phases 10–12 (app shell, landing, the 3D seal)
  - Knowing the money: Phases 13–15 (overview, forecast, budgets)
  - Accounts payable: Phases 16–20 (obligations, obligation detail, upload, review queue, signed resolutions)
  - Vendors: Phases 21–23 (payee list, payee detail, payee approval)
  - The audit trail: Phases 24–27 (decision log, decision detail, in-browser verification, public verifier)
  - The human loop: Phases 28–30 (escalation inbox, approving with a wallet, decision reviews)
  - Watching the agent work: Phases 31–32 (cycles, the live view)
  - Moving money well: Phases 33–35 (yield, cross-chain, euros)
  - Accounts receivable: Phases 36–38 (receivables, issuing an invoice, the customer pay page)
  - Services, identity, traction: Phases 39–41
  - Control: Phases 42–43 (safety controls, admin console)
  - Quality: Phases 44–46 (states and accessibility, tests, judge tour)
  - Ship: Phases 47–49 (mainnet polish, deployment, demo video and submission)
- [Part C — Reference](#part-c--reference)
  - [C1. Troubleshooting](#c1-troubleshooting)
  - [C2. Contract error messages for humans](#c2-contract-error-messages-for-humans)
  - [C3. Security checklist](#c3-security-checklist)
  - [C4. Page-by-page acceptance checklist](#c4-page-by-page-acceptance-checklist)
  - [C5. Glossary](#c5-glossary)

---

# Part A — Read this before writing code

## A1. What the frontend is

Athena's backend runs the treasury on its own. The frontend has three jobs, and none of them is "move money on the agent's behalf":

1. **Make the agent legible.** Anyone — a judge, a vendor, a curious visitor — can open the app without a wallet and see what the business holds, what it owes, what it decided, why it decided it, and whether the record of that decision matches what was sealed on-chain before the money moved. The browser checks the hashes itself; it does not take the server's word for it.
2. **Put a human in the loop only where the contract says so.** When `AthenaTreasury` sends a payment to a human (over budget, over the approval limit, over a payee's cap, or below the operating floor), the approver opens the escalation, reads the agent's sealed reasoning and the evidence, and approves or rejects it **from their own wallet**. The same console approves new vendors, resolves held invoices, and can pause the treasury.
3. **Let customers pay.** Every receivable Athena issues has a pay page. A customer connects a wallet, approves the exact amount and calls `payReceivable` — the only way money enters the treasury against an invoice.

The server holds no human key. The frontend is where human keys live, in the humans' own wallets.

## A2. Who uses it, and what each person can do

| Person | How the app recognizes them | What they can do |
|---|---|---|
| **Visitor / judge** | no wallet, or a wallet with no role | Read everything public: overview, forecast, obligations, payees, decisions, verification, cycles, live view, yield, cross-chain, receivables list, traction, agent identity. Run the public verifier. Take the guided tour. |
| **Approver** | connected wallet holds `APPROVER_ROLE` on the treasury (read live with `hasRole`) | Everything a visitor can, plus: approve or reject escalations; approve, reject, suspend or reactivate payees; resolve held invoices (signed message); review revealed decisions (signed message); pause the treasury. |
| **Admin** | connected wallet holds `DEFAULT_ADMIN_ROLE` | Everything an approver's UI shows (if it also holds `APPROVER_ROLE` — normally it does not), plus: upload invoices, create payees, POs and receipts, issue receivables, run or dry-run a cycle, set budgets, raise payee caps, set the operating floor, unpause. |
| **Customer** | anyone who opens `/pay/<receivableId>` | Pay an invoice in USDC or EURC from their wallet. If the receivable names a specific customer address, only that wallet can pay. |
| **Customer that is an agent** | not a browser user | Pays through the backend's x402 link. The pay page shows that link and a copy-paste example for agent developers. |

Roles are never stored in the frontend. They are read from the contract every time the connected account or chain changes. A role revoked on-chain disappears from the UI on the next read.

## A3. Frontend principles

These rules come before convenience. If a phase seems to require breaking one, stop and redesign.

1. **No server endpoint moves treasury money, and the frontend never asks for one.** Treasury money moves when the worker executes a committed decision, or when a human signs a contract call in their own wallet. The frontend only ever does the second.
2. **The chain is the source of truth for anything that is checked.** Lists and history come from the API (fast, indexed). Anything a human signs against, and anything shown as "verified", is read directly from Arc through the user's RPC connection.
3. **Verify in the browser, not on the server.** The verification badge on a decision is computed client-side: SHA-256 of the revealed bytes, compared with the hash the contract stored at commit time, compared with the bytes emitted in the reveal event. The server's own `match` field is shown as a second opinion, never as the answer.
4. **Money is `bigint` from the API to the screen.** Amounts arrive as strings of atomic units. They are parsed with `BigInt`, formatted with the shared formatter, and never pass through `Number`. Input fields use the shared strict parser, which refuses rather than rounds.
5. **Every on-chain object links to the explorer.** Commit, execute, reveal, approval, payment — each shows its transaction hash and a link.
6. **Every number says which network it belongs to.** Testnet figures are labeled testnet. Mainnet figures are shown first wherever both exist.
7. **Simulate before you ask for a signature.** Every contract write is simulated first; a revert is explained in plain language before the wallet pops up.
8. **Nothing secret ships to the browser.** No admin API key, no Circle key, no service-role key. Admin actions go through the app's own server routes, which check an on-chain role before forwarding.
9. **Untrusted text is rendered as text.** Invoice fields, vendor names, extraction output and planner rationales are third-party or model-generated. They are never rendered as HTML.
10. **One write path per action.** Every button that signs something goes through the same transaction hook, so every write gets the same simulation, error decoding, receipt wait and cache refresh.

## A4. How the frontend earns points with the judges

| Criterion | Weight | What the frontend shows | Phases |
|---|---|---|---|
| Agentic sophistication | 30% | The live view of a cycle as it happens (snapshot → forecast → plan → validate → commit → execute → reveal). Each decision's rationale, the alternatives it considered, the policy checks it passed, and where the validator overruled the model. The escalation inbox proves the agent knows when to stop. | 25, 28, 31, 32 |
| Traction | 30% | One page of live, chain-derived numbers, mainnet first: businesses operated, USDC in and out, obligations settled without a human, invoices processed, duplicates caught, discounts captured, funds under management. Every figure links to its evidence. | 41, 47 |
| Circle tool usage | 20% | Visible, working surfaces for Gateway unified balance, CCTP payouts with burn → attest → mint stages, Earn Kit vault selection, App Kit swap into EURC, x402 pay links and service purchases, Compliance Engine screening results on payees, Agent Wallet limits on mainnet. | 13, 22, 33–35, 38, 39 |
| Innovation | 20% | The seal: a decision is visibly sealed before money moves and opened after. The public verifier lets anyone paste a decision id and check it against Arc without trusting Athena's server. | 11, 12, 26, 27 |

## A5. Design language

The look stays the same as before: dark, high contrast, oversized heavy type, one 3D hero element, very little decoration. What changes is what the hero means. It is now **the seal** — a glowing lock that represents a committed decision. It is closed while the decision is sealed, cracks when the reveal lands, and opens to show the record.

### A5.1 Tone

- **Calm and exact.** This is a treasury. Numbers are large, labels are small, and nothing flashes unless money actually moved or a human is needed.
- **Plain language.** "Paid Northwind 412.50 USDC, 8 days early, to capture a 2% discount" — not "Executed PAY_EARLY action".
- **Evidence beside every claim.** A number without a link to where it came from is a bug.

### A5.2 Typography

| Use | Typeface | Weight | Notes |
|---|---|---|---|
| Display (hero word, page titles, big numbers) | Archivo (variable) | 800–900 | Tight tracking (`-0.04em`), uppercase for the hero and section titles |
| Body and UI | Inter (variable) | 400–600 | 14–16 px base |
| Hashes, addresses, amounts in tables | JetBrains Mono | 400–500 | Tabular numbers everywhere money is aligned |

All three load through `next/font/google`, so there is no layout shift and no runtime request to a font CDN.

### A5.3 Color

Dark by default; a light theme exists for printing and for judges who prefer it, but every screenshot and the video use dark.

| Token | Dark | Light | Used for |
|---|---|---|---|
| `--bg` | `#07080A` | `#FAFAF7` | page |
| `--surface` | `#0E1013` | `#FFFFFF` | cards |
| `--surface-2` | `#15181D` | `#F2F2EE` | nested cards, table headers |
| `--line` | `#22262D` | `#E3E3DD` | borders, dividers |
| `--text` | `#F5F5F2` | `#0B0C0E` | primary text |
| `--muted` | `#8A9099` | `#5D636B` | labels, secondary |
| `--seal` | `#E8C468` | `#A9821F` | the seal, committed/sealed state, brand accent |
| `--ok` | `#4ADE80` | `#15803D` | verified, executed, paid |
| `--warn` | `#FBBF24` | `#B45309` | escalated, held, expiring |
| `--bad` | `#F87171` | `#B91C1C` | mismatch, rejected, failed, arrears |
| `--info` | `#7DD3FC` | `#0369A1` | in-flight, cross-chain, follow-ups |
| `--testnet` | `#A78BFA` | `#6D28D9` | the testnet label |

The seal gold is the only warm color in the interface. It appears when something is committed and on the seal itself, so the eye learns that gold means "sealed on-chain".

### A5.4 Status language (used identically on every page)

| State | Badge | Color | Icon |
|---|---|---|---|
| Recorded (not yet committed) | `RECORDED` | muted | dotted circle |
| Committed / sealed | `SEALED` | seal | closed lock |
| Executed | `EXECUTED` | ok | check |
| Escalated | `NEEDS HUMAN` | warn | raised hand |
| Approved by human | `APPROVED` | ok | signature |
| Rejected by human | `REJECTED` | bad | x |
| Cancelled | `CANCELLED` | muted | slash |
| No-op (schedule, hold) | `RECORDED DECISION` | muted | bookmark |
| Revealed and verified | `VERIFIED` | ok | open lock + check |
| Revealed, mismatch | `MISMATCH` | bad | open lock + warning |
| Reveal overdue | `OVERDUE` | bad | clock |

Obligation statuses (`open`, `scheduled`, `held`, `escalated`, `paid`, `cancelled`) and receivable statuses (`open`, `partial`, `paid`, `written_off`) use the same color logic.

### A5.5 Motion

- One motion idea: **seal → crack → open.** It plays on the landing hero, on the live view when a decision is revealed, and in miniature on the verification badge.
- Everything else moves only to show change: a number that updates counts to its new value over 400 ms; a new row in a live list slides in once.
- `prefers-reduced-motion: reduce` turns every animation into an instant state change and swaps the 3D seal for a static SVG.

### A5.6 Layout

- 12-column grid, 1280 px max content width, 24 px gutters on desktop, 16 px on phones.
- Left sidebar navigation on desktop; a bottom sheet menu on phones.
- Every page has the same header: oversized page title, one-line explanation in plain language, and the network badge.
- Tables collapse to stacked cards below 768 px. No horizontal page scroll at any width.

## A6. Sitemap and navigation

```
/                              Landing (public)
/overview                      Treasury overview: balances, runway, budgets, yield, Gateway
/forecast                      30-day forecast, base and stress
/obligations                   Accounts payable: everything owed
/obligations/[obligationId]    One obligation: invoice, match, evidence, decision history
/invoices/review               Review queue: held invoices          (resolve: approver)
/invoices/[invoiceId]          One invoice: extraction, normalization, duplicates, match
/invoices/upload               Upload invoices                      (admin)
/payees                        Vendor master
/payees/[payeeId]              One payee: status, cap, screening, scorecard, address history
/payees/new                    Create a payee                       (admin)
/decisions                     The audit trail
/decisions/[decisionId]        One decision: the sealed record, verified in the browser
/verify                        Public verifier: paste a decision id or transaction hash
/escalations                   Escalation inbox
/escalations/[decisionId]      One escalation: decide with your wallet (approver)
/cycles                        Cycle history
/cycles/[cycleId]              One cycle: every step, the plan, the validation
/live                          Watch Athena work, in real time
/yield                         Vaults considered and positions held
/crosschain                    CCTP payouts and Gateway transfers
/fx                            EURC needs and swaps
/receivables                   Accounts receivable
/receivables/[receivableId]    One receivable: dunning, payments, links
/receivables/new               Issue an invoice                     (admin)
/pay/[receivableId]            Customer pay page (public, standalone layout)
/services                      x402 purchases and metering
/traction                      Live traction metrics, mainnet first
/agent                         Athena's on-chain identity and reputation
/controls                      Pause, budgets, caps, operating floor (approver/admin)
/admin                         Run cycles, create records            (admin)
/mcp                           Connect Athena to Claude or any MCP client
```

**Sidebar groups (desktop):**

```
ATHENA
  Overview · Forecast · Live
PAYABLES
  Obligations · Review queue (count) · Payees
RECEIVABLES
  Receivables
AUDIT
  Decisions · Verify · Cycles · Escalations (count)
MONEY
  Yield · Cross-chain · Euros · Services
PROOF
  Traction · Agent identity · MCP
CONTROL                    (only when a role is held)
  Controls · Admin
```

The review queue and escalation counts are live. When either is above zero and the connected wallet can act on it, the count is gold; otherwise it is muted.

## A7. Where every number on screen comes from

| What you display | Source | Freshness |
|---|---|---|
| Health: network, block, paused, overdue count, last cycle | `GET /health` | 10 s poll + SSE |
| Balances, reserve, free operating, floor, budgets, yield, Gateway, internal wallets, runway | `GET /treasury/overview` (latest snapshot) | SSE `cycle.step` (snapshot), 30 s poll |
| Live treasury USDC/EURC balance (header) | `balanceOf(treasury)` read from Arc in the browser | every new block, throttled to 5 s |
| `paused`, `overdueCount` (banner) | read from Arc in the browser | every 5 s |
| Forecast series | `GET /treasury/forecast` | after each cycle |
| Obligations, invoices, payees, receivables, cycles | API lists | SSE invalidation |
| Decision record | `GET /decisions/:id` for display; **bytes** from `GET /decisions/:id/verify` | on open |
| Decision on-chain state, hashes | `getDecision(decisionId)` read from Arc in the browser | on open + on SSE |
| Reveal bytes | `DecisionRevealed` log read from Arc (reveal transaction receipt) | on open |
| Escalation action and expiry | `getEscalation(decisionId)` read from Arc | on open, every 5 s while open |
| Payee status, cap, active-from | `getPayee(payeeId)` read from Arc on the detail page; API in lists | on open |
| Receivable due/paid (pay page) | `getReceivable(receivableId)` read from Arc | every block while paying |
| Wallet balances and allowance (pay page) | `balanceOf`, `allowance` read from Arc | every block while paying |
| Roles | `hasRole(role, account)` read from Arc | on account or chain change |
| Traction metrics | `GET /metrics` from each network's API | 60 s poll |
| Yield vaults and positions | `GET /yield/vaults`, `GET /yield/positions` | after each cycle |
| Cross-chain transfers | `GET /crosschain` | SSE `crosschain.stage` |
| Agent identity and reputation | `GET /agent` (Phase 39 of the backend) plus ERC-8004 reads | on open |

## A8. Pinned facts for the browser

Import these from `@athena/shared` (the backend's Phase 2). Never type an address into a component.

| Fact | Testnet | Mainnet |
|---|---|---|
| Chain id | `5042002` | `5042` |
| Public RPC | `https://rpc.testnet.arc.io` | `https://rpc.mainnet.arc.io` |
| Explorer | `https://explorer.testnet.arc.io` | `https://explorer.arc.io` |
| USDC (ERC-20 interface, 6 decimals) | `0x3600000000000000000000000000000000000000` | same |
| EURC (6 decimals) | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` | `0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1` |
| Native gas token | USDC, **18 decimals** | USDC, **18 decimals** |
| Treasury | from `addresses.json` after the backend's Phase 15 | from `addresses.json` after the backend's Phase 45 |

**The decimal trap.** On Arc, USDC is both the gas token and an ERC-20. The native balance (what `useBalance` returns with no token) has 18 decimals. The ERC-20 balance at `0x3600…0000` has 6. **Every USDC amount Athena handles is the 6-decimal ERC-20 amount.** The only place the frontend shows the native balance is the "gas" line on the pay page and in the wallet menu, labeled as gas.

**Arc block time.** Arc produces blocks quickly (sub-second finality). The commit-then-execute rule (`block.number > committedBlock`) means the live view will often show commit and execute a second apart. Do not fake delays to make it look slower; slow the *animation*, not the data.

## A9. Repository layout

The web app lives in the same monorepo as the backend:

```
athena/
├── packages/
│   ├── contracts/                          (backend)
│   └── shared/                             addresses, chains, money, ids, action hash, ABIs
├── apps/
│   ├── backend/                            (backend; serves the API)
│   ├── mcp/                                (backend)
│   └── web/                                ← this document
│       ├── app/
│       │   ├── layout.tsx                  fonts, providers, theme
│       │   ├── page.tsx                    landing
│       │   ├── (console)/                  every page with the sidebar shell
│       │   │   ├── layout.tsx
│       │   │   ├── overview/page.tsx
│       │   │   ├── forecast/page.tsx
│       │   │   ├── obligations/page.tsx
│       │   │   ├── obligations/[obligationId]/page.tsx
│       │   │   ├── invoices/review/page.tsx
│       │   │   ├── invoices/upload/page.tsx
│       │   │   ├── invoices/[invoiceId]/page.tsx
│       │   │   ├── payees/page.tsx
│       │   │   ├── payees/new/page.tsx
│       │   │   ├── payees/[payeeId]/page.tsx
│       │   │   ├── decisions/page.tsx
│       │   │   ├── decisions/[decisionId]/page.tsx
│       │   │   ├── verify/page.tsx
│       │   │   ├── escalations/page.tsx
│       │   │   ├── escalations/[decisionId]/page.tsx
│       │   │   ├── cycles/page.tsx
│       │   │   ├── cycles/[cycleId]/page.tsx
│       │   │   ├── live/page.tsx
│       │   │   ├── yield/page.tsx
│       │   │   ├── crosschain/page.tsx
│       │   │   ├── fx/page.tsx
│       │   │   ├── receivables/page.tsx
│       │   │   ├── receivables/new/page.tsx
│       │   │   ├── receivables/[receivableId]/page.tsx
│       │   │   ├── services/page.tsx
│       │   │   ├── traction/page.tsx
│       │   │   ├── agent/page.tsx
│       │   │   ├── controls/page.tsx
│       │   │   ├── admin/page.tsx
│       │   │   └── mcp/page.tsx
│       │   ├── pay/[receivableId]/page.tsx standalone layout, no sidebar
│       │   └── api/                        the app's own server routes (admin proxy, session)
│       │       ├── session/nonce/route.ts
│       │       ├── session/login/route.ts
│       │       ├── session/logout/route.ts
│       │       └── admin/[...path]/route.ts
│       ├── src/
│       │   ├── components/
│       │   │   ├── ui/                     primitives (Phase 3)
│       │   │   ├── seal/                   the 3D seal and its fallbacks (Phase 12)
│       │   │   ├── money/                  Amount, TokenIcon, AmountInput
│       │   │   ├── chain/                  TxLink, AddressChip, HashChip, NetworkBadge
│       │   │   ├── decisions/              DecisionRow, RecordView, VerifyPanel, ActionView
│       │   │   ├── charts/                 ForecastChart, BudgetBar, MetricSpark
│       │   │   └── shell/                  Sidebar, Header, HealthBanner, CommandMenu
│       │   ├── lib/
│       │   │   ├── api/                    client, types (generated), query keys, hooks
│       │   │   ├── chain/                  wagmi config, treasury reads, tx hook, error decoding
│       │   │   ├── verify/                 sha256, reveal log, action hash, verdict
│       │   │   ├── format/                 amounts, dates, addresses, durations
│       │   │   ├── events/                 SSE client and query invalidation map
│       │   │   ├── auth/                   signed messages, session
│       │   │   └── network.ts              current network, API base per network
│       │   └── styles/globals.css
│       ├── public/                         seal fallback SVG, OG image, favicon
│       ├── tests/                          Vitest units + Playwright e2e
│       ├── next.config.ts
│       ├── tailwind.config.ts              (only if your Tailwind version needs one)
│       └── package.json
└── pnpm-workspace.yaml
```

## A10. Environment variables

`apps/web/.env.local` (git-ignored). Anything prefixed `NEXT_PUBLIC_` is shipped to every browser — treat it as public.

```bash
# ── networks shown in the app ─────────────────────────────
NEXT_PUBLIC_NETWORKS=testnet,mainnet         # order = default first; "testnet" alone hides mainnet
NEXT_PUBLIC_DEFAULT_NETWORK=testnet

# ── backend APIs (one backend process per network) ───────
NEXT_PUBLIC_API_TESTNET=http://localhost:3100
NEXT_PUBLIC_API_MAINNET=                     # empty until the backend's Phase 45

# ── RPC used by the browser for reads ─────────────────────
NEXT_PUBLIC_RPC_TESTNET=https://rpc.testnet.arc.io
NEXT_PUBLIC_RPC_MAINNET=https://rpc.mainnet.arc.io

# ── wallets ───────────────────────────────────────────────
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=        # optional; injected wallets work without it

# ── MCP ───────────────────────────────────────────────────
NEXT_PUBLIC_MCP_URL=                         # public Streamable HTTP URL of the backend's MCP server

# ── server-only (never NEXT_PUBLIC_) ──────────────────────
ADMIN_API_KEY_TESTNET=                       # same value as the testnet backend's ADMIN_API_KEY
ADMIN_API_KEY_MAINNET=
SESSION_SECRET=                              # 32+ random bytes, base64; signs the session cookie
SESSION_TTL_MINUTES=60
```

Never put a Canteen RPC URL that embeds a token in a `NEXT_PUBLIC_` variable. The browser uses the public RPC; the backend uses the private one.

---

# Part B — The build, phase by phase

Every phase has the same shape: **Goal**, **Steps**, **Code** where it matters, and an **Exit check**. Do not start a phase until the previous exit check passes.

---
## FOUNDATIONS

## Phase 0 — Tools, accounts and wallets

**Goal:** every account and tool the web app needs exists before the first line of code.

**Steps**

1. **Node and pnpm.** Node 22 LTS and pnpm 9 or later, same as the backend. Check with `node -v` and `pnpm -v`.
2. **Two browser wallets, two browser profiles.** Make one Chrome profile per human role so you never sign with the wrong key during a demo:
   - **Approver profile** — a wallet extension (MetaMask or Rabby) holding the approver key from the backend's A9. This address was granted `APPROVER_ROLE` in the backend's Phase 15.
   - **Admin profile** — a wallet holding the admin key (`DEFAULT_ADMIN_ROLE`).
   - **Customer profile** — a fresh wallet that holds a little testnet USDC and EURC. This is what you use to test the pay page, and what you hand to a friend who pays a real invoice.
   - **Visitor profile** — no wallet extension at all. Every public page must work here.
3. **Add Arc to each wallet.** The app will offer to add the chain (Phase 5), but adding it by hand first saves a confusing first run: network name `Arc Testnet`, chain id `5042002`, RPC `https://rpc.testnet.arc.io`, currency symbol `USDC`, explorer `https://explorer.testnet.arc.io`.
4. **Testnet funds.** From `faucet.circle.com`, send testnet USDC (and EURC if the faucet offers it) to the approver, admin and customer wallets. On Arc, gas is paid in USDC, so a wallet with zero USDC cannot sign anything — including an approval.
5. **WalletConnect project id (optional).** Create a project at the WalletConnect (Reown) dashboard if you want phone wallets to connect by QR code. Injected wallets work without it.
6. **Vercel account** (or any host that runs Next.js server routes). Phase 48 deploys there.
7. **The backend is reachable.** Start the testnet backend locally (backend Phase 40) and check `curl http://localhost:3100/health` returns `ok: true`. The frontend is built against a running backend with seeded data (backend Phase 43); building against an empty one hides half the states you need to design.

**Exit check:** four browser profiles exist; the approver and admin wallets show Arc Testnet and a non-zero USDC balance; `GET /health` on the local backend answers.

---

## Phase 1 — Scaffold the web app

**Goal:** a Next.js app inside the monorepo that imports `@athena/shared`, builds, and renders a blank page in the right fonts.

**Steps**

1. Create the app:
   ```bash
   cd apps
   pnpm create next-app@latest web --ts --app --eslint --tailwind --src-dir --import-alias "@/*" --use-pnpm
   cd web
   ```
   ⚠️ VERIFY the flags against `pnpm create next-app --help` for the version you get; the intent is TypeScript, App Router, Tailwind, `src/` directory and the `@/` alias. Move the generated `src/app` to `app/` at the package root if your generator put it inside `src`, so the layout in A9 holds (or keep it in `src/app` and adjust paths — just be consistent).

2. Pin exact versions. Install with `-E` so the lockfile and `package.json` agree:
   ```bash
   pnpm add -E wagmi viem @tanstack/react-query
   pnpm add -E three @react-three/fiber @react-three/drei
   pnpm add -E motion recharts lucide-react sonner clsx tailwind-merge
   pnpm add -E react-hook-form @hookform/resolvers zod
   pnpm add -E openapi-fetch iron-session
   pnpm add -E @athena/shared@workspace:*
   pnpm add -D -E openapi-typescript vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/user-event @playwright/test
   pnpm add -D -E @types/three
   ```
   ⚠️ VERIFY: `@react-three/fiber` v9 is the line that supports React 19, and `@react-three/drei` v10 pairs with it. If your Next.js version ships React 18, pin fiber v8 and drei v9 instead. Mismatched majors fail at runtime with "Cannot read properties of undefined (reading 'ReactCurrentOwner')".

3. Let Next.js compile the workspace package (it ships TypeScript source):
   ```ts
   // apps/web/next.config.ts
   import type { NextConfig } from "next";

   const config: NextConfig = {
     reactStrictMode: true,
     transpilePackages: ["@athena/shared"],
     poweredByHeader: false,
     experimental: { optimizePackageImports: ["lucide-react", "recharts"] },
   };
   export default config;
   ```

4. Keep server-only code out of the browser bundle. `@athena/shared` must not import Node built-ins in any file the web app touches. Check `canonical.ts`: if it uses `node:crypto` for SHA-256, do **not** import it from the web app — the web app has its own browser SHA-256 in Phase 26. Import only `addresses`, `chains`, `money`, `ids`, `action`, `categories`, `types` and the ABI JSON.

5. Fonts, in `app/layout.tsx`:
   ```tsx
   import { Archivo, Inter, JetBrains_Mono } from "next/font/google";
   import "@/styles/globals.css";

   const display = Archivo({ subsets: ["latin"], weight: ["800", "900"], variable: "--font-display" });
   const sans = Inter({ subsets: ["latin"], variable: "--font-sans" });
   const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

   export const metadata = {
     title: "Athena — autonomous treasury on Arc",
     description: "An agent that runs a business treasury in USDC, seals every decision on-chain before money moves, and opens it after.",
   };

   export default function RootLayout({ children }: { children: React.ReactNode }) {
     return (
       <html lang="en" data-theme="dark" className={`${display.variable} ${sans.variable} ${mono.variable}`} suppressHydrationWarning>
         <body>{children}</body>
       </html>
     );
   }
   ```

6. Scripts in `apps/web/package.json`:
   ```json
   {
     "scripts": {
       "dev": "next dev -p 3000",
       "build": "next build",
       "start": "next start -p 3000",
       "lint": "next lint",
       "typecheck": "tsc --noEmit",
       "api:types": "openapi-typescript ../backend/openapi.yaml -o src/lib/api/schema.d.ts",
       "test": "vitest run",
       "e2e": "playwright test"
     }
   }
   ```

7. Strict TypeScript. In `tsconfig.json` set `"strict": true`, `"noUncheckedIndexedAccess": true` and `"target": "ES2020"` or later (BigInt literals like `0n` need ES2020).

**Exit check:** `pnpm --filter web dev` serves a page at `localhost:3000` in Archivo/Inter; `pnpm --filter web build` succeeds; a component that renders `formatAmount(1234500n)` from `@athena/shared` shows the expected string.

---

## Phase 2 — Design tokens and global styles

**Goal:** the colors, type scale, spacing and theme switch from A5 exist as CSS variables and Tailwind utilities, so no component ever hard-codes a color.

**Steps**

1. `src/styles/globals.css` (Tailwind v4, CSS-first configuration):
   ```css
   @import "tailwindcss";

   @custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));

   :root,
   [data-theme="light"] {
     --bg: #FAFAF7;  --surface: #FFFFFF;  --surface-2: #F2F2EE;  --line: #E3E3DD;
     --text: #0B0C0E; --muted: #5D636B;
     --seal: #A9821F; --ok: #15803D; --warn: #B45309; --bad: #B91C1C; --info: #0369A1; --testnet: #6D28D9;
   }
   [data-theme="dark"] {
     --bg: #07080A;  --surface: #0E1013;  --surface-2: #15181D;  --line: #22262D;
     --text: #F5F5F2; --muted: #8A9099;
     --seal: #E8C468; --ok: #4ADE80; --warn: #FBBF24; --bad: #F87171; --info: #7DD3FC; --testnet: #A78BFA;
   }

   @theme inline {
     --color-bg: var(--bg);
     --color-surface: var(--surface);
     --color-surface-2: var(--surface-2);
     --color-line: var(--line);
     --color-text: var(--text);
     --color-muted: var(--muted);
     --color-seal: var(--seal);
     --color-ok: var(--ok);
     --color-warn: var(--warn);
     --color-bad: var(--bad);
     --color-info: var(--info);
     --color-testnet: var(--testnet);

     --font-display: var(--font-display), ui-sans-serif, system-ui;
     --font-sans: var(--font-sans), ui-sans-serif, system-ui;
     --font-mono: var(--font-mono), ui-monospace, monospace;

     --radius-card: 14px;
     --radius-pill: 999px;
   }

   html { background: var(--bg); color: var(--text); }
   body { font-family: var(--font-sans); -webkit-font-smoothing: antialiased; min-height: 100dvh; }

   .tabular { font-variant-numeric: tabular-nums; }
   .display { font-family: var(--font-display); letter-spacing: -0.04em; line-height: 0.9; text-transform: uppercase; }

   ::selection { background: color-mix(in oklab, var(--seal) 35%, transparent); }

   @media (prefers-reduced-motion: reduce) {
     *, *::before, *::after { animation-duration: 0.001ms !important; transition-duration: 0.001ms !important; }
   }
   ```
   ⚠️ VERIFY the `@theme inline` and `@custom-variant` syntax against the Tailwind version you installed. On Tailwind v3, put the same tokens in `tailwind.config.ts` under `theme.extend.colors` as `"rgb(var(--…) / <alpha-value>)"` or plain `var(--…)` and use `darkMode: ["class", '[data-theme="dark"]']`.

2. Type scale, used through utility classes only:

   | Name | Size / line height | Where |
   |---|---|---|
   | `hero` | `clamp(72px, 16vw, 220px)` / 0.85 | landing word "ATHENA" |
   | `page` | `clamp(40px, 6vw, 72px)` / 0.9 | page titles |
   | `figure` | `clamp(32px, 4vw, 56px)` / 1 | headline numbers (balance, runway) |
   | `h2` | 20px / 1.2, Inter 600 | card titles |
   | `body` | 15px / 1.5 | text |
   | `label` | 12px / 1.3, Inter 500, uppercase, `tracking-[0.08em]`, muted | field labels, table headers |
   | `mono` | 13px / 1.4, JetBrains Mono | hashes, addresses |

3. Theme toggle. A tiny client component sets `data-theme` on `<html>` and stores the choice in `localStorage` (wrapped in `try/catch`; if storage throws, default to dark). Add an inline script in the `<head>` that reads the stored value before paint so there is no flash:
   ```tsx
   <script dangerouslySetInnerHTML={{ __html:
     `try{var t=localStorage.getItem('athena-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}` }} />
   ```
   This is the only `dangerouslySetInnerHTML` in the app, and it contains no data.

4. Backgrounds. The page background is flat `--bg` with one subtle radial glow behind the hero and behind the page title (`radial-gradient(60% 40% at 50% 0%, color-mix(in oklab, var(--seal) 10%, transparent), transparent)`). No textures, no noise images.

**Exit check:** a test page shows every token as a swatch in both themes; toggling the theme does not flash on reload; contrast of `--muted` on `--surface` is at least 4.5:1 in both themes (check with the browser's accessibility panel).

---

## Phase 3 — Primitive components

**Goal:** a small, consistent set of building blocks so every page looks like the same product.

**Steps**

Build each in `src/components/ui/`. Keep them unstyled-by-default-props, styled by tokens, with no data fetching inside.

| Component | Props that matter | Notes |
|---|---|---|
| `Button` | `variant: "primary" \| "secondary" \| "ghost" \| "danger"`, `size`, `loading`, `disabled`, `asChild` | `primary` is text-on-seal (gold); `danger` is outlined red. While `loading`, the label stays and a spinner replaces the icon so the width never jumps. |
| `Card` | `title?`, `action?`, `footer?`, `tone?: "default" \| "warn" \| "bad" \| "ok"` | `tone` adds a 1px colored top border only. |
| `Badge` | `status` (from A5.4) or `tone` + `children` | One component renders every status badge, from one map. |
| `Stat` | `label`, `value: ReactNode`, `sub?`, `href?`, `network?` | Headline numbers. `href` links to the evidence (A5.1). |
| `Table` | `columns`, `rows`, `rowHref?`, `empty`, `loading` | Stacks into cards below 768px. Sticky header. Row is a real `<a>` when `rowHref` is set, so middle-click works. |
| `Skeleton` | `w`, `h`, `lines?` | Shimmer disabled under reduced motion. |
| `EmptyState` | `title`, `body`, `action?` | Every list has one written for its own context ("No invoices are waiting for a human. Athena handled everything it received."). |
| `ErrorState` | `error`, `retry?` | Shows the API error `code` and `message`, never a stack. |
| `Dialog` | `open`, `onOpenChange`, `title`, `description` | Native `<dialog>` with focus trap; Escape closes unless a transaction is pending. |
| `Drawer` | same as Dialog | Right side on desktop, bottom sheet on phones. Used for record JSON and evidence. |
| `Tabs` | `items`, `value`, `onValueChange` | Syncs with a `?tab=` search param so tabs are linkable. |
| `Tooltip` | `content` | For explaining terms (reserve, floor, cooldown). Never hides required information. |
| `Toast` | via `sonner` | One `<Toaster />` in the providers; transaction toasts come from the tx hook (Phase 6). |
| `KeyValue` | `items: Array<{ k, v, mono? }>` | The label/value grid used on every detail page. |
| `Timeline` | `steps: Array<{ key, label, state: "todo" \| "active" \| "done" \| "failed" \| "skipped", at?, detail? }>` | Used by cycles, the live view, cross-chain transfers and the pay page. |
| `Countdown` | `to: Date`, `onExpire?` | Escalation expiry; turns warn under 25% remaining, bad under 10%. |
| `CopyButton` | `value` | Copies hashes/addresses; confirms with a toast. |
| `CodeBlock` | `code`, `lang` | JSON records and curl examples. Renders text only; highlighting through CSS classes on a tokenizer you write or a tiny library — never by injecting HTML from data. |

Chain-specific primitives in `src/components/chain/`:

| Component | Renders |
|---|---|
| `AddressChip` | `0x1234…abcd` in mono, copy button, explorer link, optional label ("Northwind (payee)"), and a role tag if the address is the treasury, operator, approver or an internal wallet |
| `HashChip` | a bytes32 (decision id, hash) truncated `0xabcd…1234`, copy, optional link |
| `TxLink` | tx hash chip linking to `${explorer}/tx/${hash}`, with a tiny label ("commit", "execute", "reveal", "approve") |
| `NetworkBadge` | `TESTNET` (violet) or `MAINNET` (gold outline) |
| `TokenIcon` | USDC or EURC mark (simple circles with letters; do not copy brand logos you have not been given rights to) |

**Exit check:** a hidden `/_kitchen-sink` route (excluded from production with `notFound()` when `process.env.NODE_ENV === "production"`) renders every primitive in every state, in both themes, at 375px and 1440px widths, with no horizontal scroll.

---

## Phase 4 — Formatting: money, time, addresses

**Goal:** one module formats every amount, date, duration and address the same way, without floating point.

**Steps**

1. `src/lib/format/amount.ts`:
   ```ts
   import { TOKEN_DECIMALS } from "@athena/shared/money";

   /** Format integer atomic units for display. Never uses Number. */
   export function formatUnits(
     units: bigint | string,
     opts: { decimals?: number; minFraction?: number; maxFraction?: number; sign?: boolean } = {},
   ): string {
     const decimals = opts.decimals ?? TOKEN_DECIMALS;
     const minF = opts.minFraction ?? 2;
     const maxF = opts.maxFraction ?? 2;
     let v = typeof units === "string" ? BigInt(units) : units;
     const neg = v < 0n;
     if (neg) v = -v;

     const base = 10n ** BigInt(decimals);
     const whole = v / base;
     let frac = (v % base).toString().padStart(decimals, "0");

     // Truncate (not round) to maxF, then trim trailing zeros down to minF.
     frac = frac.slice(0, maxF);
     while (frac.length > minF && frac.endsWith("0")) frac = frac.slice(0, -1);

     const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
     const body = frac.length ? `${grouped}.${frac}` : grouped;
     return `${neg ? "−" : opts.sign ? "+" : ""}${body}`;
   }

   /** Full precision: used in tooltips and on the records, where a reviewer needs every digit. */
   export const formatExact = (units: bigint | string, decimals = TOKEN_DECIMALS) =>
     formatUnits(units, { decimals, minFraction: decimals, maxFraction: decimals });

   /** Compact: 1.2K, 3.4M — only for chart axes and traction tiles. */
   export function formatCompact(units: bigint | string, decimals = TOKEN_DECIMALS): string {
     const v = typeof units === "string" ? BigInt(units) : units;
     const neg = v < 0n;
     const whole = (neg ? -v : v) / 10n ** BigInt(decimals);
     const sign = neg ? "−" : "";
     const step = (div: bigint, suffix: string) => {
       const head = whole / div;
       const tenth = (whole % div) / (div / 10n);          // one truncated decimal
       return `${sign}${head}${tenth > 0n ? "." + tenth : ""}${suffix}`;
     };
     if (whole >= 1_000_000_000n) return step(1_000_000_000n, "B");
     if (whole >= 1_000_000n) return step(1_000_000n, "M");
     if (whole >= 1_000n) return step(1_000n, "K");
     return formatUnits(v, { decimals, maxFraction: 2, minFraction: 0 });
   }
   ```
   The rule that matters: **truncate, never round up**, so a displayed balance is never more than what exists. `1_999_999.99` USDC shows as `1.9M`, not `2M`.

2. `src/components/money/Amount.tsx` — the only way an amount reaches the screen:
   ```tsx
   export function Amount({ units, token, exact = false, className }: {
     units: bigint | string; token: "USDC" | "EURC"; exact?: boolean; className?: string;
   }) {
     const shown = exact ? formatExact(units) : formatUnits(units);
     return (
       <span className={cn("tabular font-mono", className)} title={`${formatExact(units)} ${token}`}>
         {shown} <span className="text-muted">{token}</span>
       </span>
     );
   }
   ```
   The `title` always carries the full six-decimal value, so a reviewer can see that `412.50` is really `412.500000`.

3. `src/components/money/AmountInput.tsx` — the only way an amount enters the app. It keeps the raw string the user typed, and calls `parseAmount` from `@athena/shared/money` on every change:
   - `parseAmount` throws on more than 6 decimals, on letters, on negative values, on exponent notation. Show its message under the field; disable submit.
   - Never call `parseFloat`. Never format the user's input while they type.
   - Offer a **Max** button that fills the exact outstanding or available amount as a string via `formatExact`.

4. `src/lib/format/time.ts`:
   - `formatDate(iso)` → `Oct 14, 2026` (in the viewer's locale and time zone via `Intl.DateTimeFormat`).
   - `formatDateTime(iso)` → `Oct 14, 2026, 09:12`.
   - `relative(iso)` → `in 3 days`, `2 hours ago` via `Intl.RelativeTimeFormat`.
   - `dueLabel(dueDate, status)` → `Due in 4 days`, `Due today`, `3 days overdue`, `Paid 2 days early`.
   - Due dates are calendar dates (`YYYY-MM-DD`) in the business's time zone. Parse them as dates, not as UTC midnight timestamps, or "due today" will be wrong for anyone west of UTC.

5. `src/lib/format/address.ts`: `short(addr)` → `0x1234…abcd`; `checksum(addr)` via viem `getAddress`; `isZero(addr)`.

6. `src/lib/format/bps.ts`: `formatBps(325)` → `3.25%`; `formatApy(bps | null)` → `3.25% APY` or `—`.

7. Unit tests (`tests/format.test.ts`) for every edge: `0n`, `1n` (`0.000001` exact, `0.00` short), `999999n`, `1000000n`, `123456789012345678n`, negative values, a string input, `formatCompact` boundaries at 999, 1,000, 999,999 and 1,000,000 whole units.

**Exit check:** all format tests pass; searching `apps/web/src` for `parseFloat(`, `Number(` next to an amount, or `toFixed(` returns nothing in money code.

---

## TALKING TO THE CHAIN AND THE API

## Phase 5 — Chains, network switching and wallet connection

**Goal:** the app knows which network it is showing, reads Arc through a public RPC without any wallet, and lets a person connect a wallet on the right chain.

**Steps**

1. **Current network.** The network a page shows is part of the URL so a link always opens the same view: `?net=testnet` or `?net=mainnet`. `src/lib/network.ts`:
   ```ts
   import { addresses } from "@athena/shared/addresses";

   export type Net = "testnet" | "mainnet";
   export const ENABLED: Net[] = (process.env.NEXT_PUBLIC_NETWORKS ?? "testnet")
     .split(",").map((s) => s.trim()).filter((s): s is Net => s === "testnet" || s === "mainnet");
   export const DEFAULT_NET: Net = (process.env.NEXT_PUBLIC_DEFAULT_NETWORK as Net) ?? ENABLED[0] ?? "testnet";

   const API: Record<Net, string | undefined> = {
     testnet: process.env.NEXT_PUBLIC_API_TESTNET,
     mainnet: process.env.NEXT_PUBLIC_API_MAINNET,
   };

   export function netConfig(net: Net) {
     const a = addresses[net];
     return {
       net,
       chainId: a.chainId,
       api: API[net] ?? null,               // null → this network is not served; show a "not live yet" state
       explorer: a.explorer,
       treasury: a.treasury as `0x${string}` | null,
       tokens: a.tokens as Record<"USDC" | "EURC", `0x${string}`>,
     };
   }
   ```
   A `useNet()` hook reads `?net=` with `useSearchParams`, falls back to `DEFAULT_NET`, and refuses a network not in `ENABLED`. The network badge in the header is a two-option switch that rewrites `?net=` and keeps the rest of the URL.

2. **Chain definitions.** Use the viem chain objects from `@athena/shared/chains` (the backend's Phase 2), overriding only the RPC with the browser's public RPC. Confirm they declare the native currency with **18 decimals** — Arc's native USDC gas balance uses 18. If the shared file says otherwise, fix it there, not here.

3. **wagmi config.** `src/lib/chain/wagmi.ts`:
   ```ts
   import { createConfig, http, fallback } from "wagmi";
   import { injected, walletConnect, coinbaseWallet } from "wagmi/connectors";
   import { arcTestnet, arcMainnet } from "@athena/shared/chains";

   const wcId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

   export const wagmiConfig = createConfig({
     chains: [arcTestnet, arcMainnet],
     connectors: [
       injected({ shimDisconnect: true }),
       coinbaseWallet({ appName: "Athena" }),
       ...(wcId ? [walletConnect({ projectId: wcId, showQrModal: true })] : []),
     ],
     transports: {
       [arcTestnet.id]: fallback([http(process.env.NEXT_PUBLIC_RPC_TESTNET), http()]),
       [arcMainnet.id]: fallback([http(process.env.NEXT_PUBLIC_RPC_MAINNET), http()]),
     },
     ssr: true,
     batch: { multicall: true },
   });
   ```
   ⚠️ VERIFY that Arc has a Multicall3 deployment at the canonical address and that the shared chain object declares it under `contracts.multicall3`. If not, set `batch: { multicall: false }`; reads still work, one request each.

4. **Providers.** `app/providers.tsx` (client component) wraps the app in `WagmiProvider`, `QueryClientProvider`, the SSE provider (Phase 8), the session provider (Phase 9) and `<Toaster />`. Create the `QueryClient` once per browser session with `useState(() => new QueryClient({...}))`:
   - `staleTime: 10_000`, `refetchOnWindowFocus: true`, `retry: (n, e) => n < 2 && !isClientError(e)`.
   - A custom `queryKeyHashFn` is not needed; BigInts never appear in keys (keys use strings).

5. **Connect button.** A custom modal in the A5 style (do not use a third-party modal theme that clashes). It lists the available connectors from `useConnect()`, shows "No wallet found — you can still read everything" when none are installed, and never blocks a public page.

6. **Wrong-network handling.** Reads never depend on the wallet's chain — they go through the transport for the page's network. Writes do. The tx hook (Phase 6) checks `account.chainId === netConfig(net).chainId` and, if not, calls `switchChain`. If the wallet does not know the chain, `switchChain` triggers `wallet_addEthereumChain` with the shared chain object. Only after the switch succeeds does the hook continue.

7. **Wallet menu.** When connected: address chip, network, ERC-20 USDC and EURC balances (6 decimals), native gas balance labeled "gas" (18 decimals, shown with 4 fraction digits), roles held (Phase 6), disconnect.

**Exit check:** in the visitor profile (no extension), every public page loads and reads the treasury balance from Arc; in the approver profile, connecting on Ethereum mainnet and then pressing any write button prompts a switch to Arc Testnet first; `?net=mainnet` with an empty `NEXT_PUBLIC_API_MAINNET` shows a clear "Mainnet operation not live yet" panel instead of errors.

---

## Phase 6 — Roles, contract reads, and the one write path

**Goal:** the app knows what the connected wallet is allowed to do, reads the treasury contract with typed calls, and sends every transaction through one hook that simulates, signs, waits, decodes errors and refreshes data.

**Steps**

1. **ABI.** Import the treasury ABI from `@athena/shared/abis/AthenaTreasury.json` and declare it `as const` in a small wrapper so viem infers types:
   ```ts
   // src/lib/chain/treasury.ts
   import abiJson from "@athena/shared/abis/AthenaTreasury.json";
   export const treasuryAbi = abiJson as unknown as typeof import("@athena/shared/abis/AthenaTreasury").default;
   ```
   If the shared package exports the ABI as a TypeScript `as const` module (recommended — have the backend's ABI export step in its Phase 15 emit `AthenaTreasury.ts` with `export default [...] as const`), import that instead and skip the cast. Typed ABIs catch argument mistakes at compile time.

2. **Role ids.** Compute once:
   ```ts
   import { keccak256, toHex, zeroHash } from "viem";
   export const ROLE = {
     ADMIN: zeroHash,                                  // DEFAULT_ADMIN_ROLE
     APPROVER: keccak256(toHex("APPROVER_ROLE")),
     OPERATOR: keccak256(toHex("OPERATOR_ROLE")),
   } as const;
   ```
   Cross-check against the contract by reading `APPROVER_ROLE()` and `OPERATOR_ROLE()` once in a unit test against the deployed testnet address.

3. **`useRoles()`**:
   ```ts
   export function useRoles() {
     const { address } = useAccount();
     const { treasury, chainId } = netConfig(useNet());
     const { data, isLoading } = useReadContracts({
       allowFailure: false,
       contracts: address && treasury ? [
         { address: treasury, abi: treasuryAbi, functionName: "hasRole", args: [ROLE.ADMIN, address], chainId },
         { address: treasury, abi: treasuryAbi, functionName: "hasRole", args: [ROLE.APPROVER, address], chainId },
         { address: treasury, abi: treasuryAbi, functionName: "hasRole", args: [ROLE.OPERATOR, address], chainId },
       ] : [],
       query: { enabled: !!address && !!treasury, staleTime: 30_000 },
     });
     return {
       loading: isLoading,
       isAdmin: !!data?.[0], isApprover: !!data?.[1],
       isOperator: !!data?.[2],         // should never be true for a human wallet; warn if it is
     };
   }
   ```
   If `isOperator` is true for a connected wallet, show a red banner: "This wallet holds the operator role. Human wallets should not." This catches a misconfigured deployment during the demo rehearsal, not during judging.

4. **`<RoleGate need="approver" | "admin">`** renders its children only when the role is held, and otherwise renders nothing (for buttons) or an explanation (for pages: "Approving escalations needs the approver wallet. You are viewing read-only."). Gates are UI convenience only; the contract is the real check.

5. **Treasury read hooks** in `src/lib/chain/reads.ts`, each a thin `useReadContract` wrapper with the page's `chainId`:
   - `useDecisionOnchain(decisionId)` → `getDecision` → `{ decisionHash, actionHash, committedBlock, resolvedBlock, state, revealed, flaggedOverdue }`
   - `useEscalationOnchain(decisionId)` → `getEscalation` → `{ action, reason, expiresAt }`
   - `usePayeeOnchain(payeeId)` → `getPayee` and `getPendingPayee`
   - `useBudgetOnchain(category, token)` → `getBudget`
   - `useReceivableOnchain(receivableId)` → `getReceivable`
   - `useTreasuryHealth()` → `paused()`, `overdueCount()`, `freeOperating(USDC)`, `freeOperating(EURC)`, `balanceOf(treasury)` on both tokens, batched, refetched every 5 s
   - `useConfigOnchain()` → `payeeCooldown`, `escalationTtl`, `revealDeadlineBlocks` (read once)

   Map the `state` number to the `DecisionState` names in one place:
   ```ts
   export const DECISION_STATE = ["None", "Committed", "Executed", "Escalated", "Approved", "Rejected", "Cancelled", "NoOp"] as const;
   export const ESCALATION_REASON = ["", "Over the period budget", "Over the per-payment approval limit",
                                     "Over this payee's cap", "Would breach the operating floor"] as const;
   ```

6. **The one write path.** `src/lib/chain/useTx.ts`:
   ```ts
   type TxStage = "idle" | "switching" | "simulating" | "signing" | "pending" | "confirmed" | "failed";

   export function useTx() {
     const net = useNet();
     const { chainId } = netConfig(net);
     const { address, chainId: walletChain } = useAccount();
     const { switchChainAsync } = useSwitchChain();
     const { writeContractAsync } = useWriteContract();
     const client = usePublicClient({ chainId });
     const qc = useQueryClient();
     const [stage, setStage] = useState<TxStage>("idle");
     const [hash, setHash] = useState<`0x${string}` | null>(null);
     const [error, setError] = useState<HumanError | null>(null);

     async function send<const TFn extends string>(req: {
       address: `0x${string}`; abi: Abi; functionName: TFn; args: readonly unknown[];
       label: string;                         // "Approve escalation", shown in toasts
       invalidate?: QueryKey[];               // what to refresh after confirmation
     }) {
       setError(null); setHash(null);
       try {
         if (!address) throw new HumanError("Connect a wallet first.");
         if (walletChain !== chainId) { setStage("switching"); await switchChainAsync({ chainId }); }

         setStage("simulating");
         const { request } = await client!.simulateContract({ ...req, account: address, chainId } as never);

         setStage("signing");
         const h = await writeContractAsync(request as never);
         setHash(h); setStage("pending");
         const t = toast.loading(`${req.label}: waiting for Arc…`);

         const receipt = await client!.waitForTransactionReceipt({ hash: h, confirmations: 1 });
         if (receipt.status !== "success") throw new HumanError("The transaction was mined but reverted.");
         toast.success(`${req.label}: confirmed`, { id: t, action: { label: "View", onClick: () => openTx(net, h) } });

         setStage("confirmed");
         for (const key of req.invalidate ?? []) await qc.invalidateQueries({ queryKey: key });
         return { hash: h, receipt };
       } catch (e) {
         const he = toHumanError(e, req.abi);
         setError(he); setStage("failed");
         toast.error(`${req.label}: ${he.message}`);
         throw he;
       }
     }
     return { send, stage, hash, error, reset: () => { setStage("idle"); setError(null); setHash(null); } };
   }
   ```

7. **Error decoding.** `src/lib/chain/errors.ts` walks viem's error chain and turns it into one sentence:
   ```ts
   import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";

   export class HumanError extends Error { constructor(msg: string, public code?: string, public args?: readonly unknown[]) { super(msg); } }

   export function toHumanError(e: unknown, abi: Abi): HumanError {
     if (e instanceof HumanError) return e;
     if (e instanceof BaseError) {
       if (e.walk((x) => x instanceof UserRejectedRequestError)) return new HumanError("You cancelled the signature.", "UserRejected");
       const revert = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
       if (revert?.data?.errorName) {
         const name = revert.data.errorName;
         return new HumanError(CONTRACT_ERRORS[name]?.(revert.data.args ?? []) ?? `The contract refused: ${name}.`, name, revert.data.args);
       }
       if (/insufficient funds/i.test(e.message)) return new HumanError("This wallet has no USDC for gas. On Arc, gas is paid in USDC.", "NoGas");
       return new HumanError(e.shortMessage ?? "The transaction failed.");
     }
     return new HumanError("Something went wrong. Try again.");
   }
   ```
   `CONTRACT_ERRORS` maps every custom error in the contract to a sentence a human understands. The full table is in C2; implement all of it, including the argument formatting (`PayeeCoolingDown(payeeId, activeFrom)` → "This payee becomes payable on Oct 12 at 14:20, after its safety cooldown.").

8. **Transaction button.** `<TxButton tx={tx} onClick={…}>` shows the stage as its label: `Switch to Arc` → `Checking…` → `Confirm in wallet` → `Waiting for Arc…` → `Done`, with the explorer link once a hash exists. It is disabled while any stage other than idle/failed/confirmed is active, so nobody double-signs.

**Exit check:** connected as the approver, `useRoles()` reports `isApprover: true` and nothing else; as the customer, all false; calling `approveEscalation` on a decision that is not escalated (with any id) is stopped at the simulation stage with the C2 sentence for `BadDecisionState`, and the wallet never opens; rejecting a signature shows "You cancelled the signature."

---

## Phase 7 — The API client, typed from the backend's OpenAPI file

**Goal:** every API call is typed from the same `openapi.yaml` the backend publishes, amounts stay strings until the UI parses them, and every list has a stable query key.

**Steps**

1. **Generate types.** The backend's Phase 40 exit check requires `apps/backend/openapi.yaml`. Generate TypeScript from it:
   ```bash
   pnpm --filter web api:types
   ```
   Commit `src/lib/api/schema.d.ts`. Re-run whenever the backend changes a route. Add a CI step that runs the generator and fails if the file changes (`git diff --exit-code`), so the two sides cannot drift silently.

2. **Client per network.** `src/lib/api/client.ts`:
   ```ts
   import createClient from "openapi-fetch";
   import type { paths } from "./schema";

   const clients = new Map<Net, ReturnType<typeof createClient<paths>>>();

   export function api(net: Net) {
     const base = netConfig(net).api;
     if (!base) throw new ApiUnavailable(net);
     let c = clients.get(net);
     if (!c) { c = createClient<paths>({ baseUrl: base }); clients.set(net, c); }
     return c;
   }

   export async function unwrap<T>(p: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
     const { data, error, response } = await p;
     if (error || !response.ok) {
       const e = (error as { error?: { code: string; message: string } })?.error;
       throw new ApiError(response.status, e?.code ?? "http_" + response.status, e?.message ?? response.statusText);
     }
     return data as T;
   }
   ```
   The backend serializes `BigInt` as strings (its 40.1). Keep them as strings in the cache; convert with `BigInt(x)` at the component boundary. Never write a JSON reviver that turns them into numbers.

3. **Fallback hand-written types.** If `openapi.yaml` is not ready yet, write `src/lib/api/types.ts` by hand from the backend's tables (its Phase 4) and Phase 40 descriptions, and switch to generated types the day the file lands. The key shapes the pages use:
   ```ts
   export type Units = string;                 // integer atomic units
   export type Hex32 = `0x${string}`;

   export interface Health { ok: boolean; network: Net; chainId: number; treasury: string; block: string;
                             lastCycleAt: string | null; paused: boolean; overdueCount: string }

   export interface Overview {
     snapshot: { block: string; takenAt: string; snapshotHash: Hex32 };
     tokens: Record<"USDC" | "EURC", { balance: Units; reserved: Units; freeOperating: Units; minOperating: Units; spendable: Units }>;
     budgets: Array<{ category: string; token: "USDC" | "EURC"; limit: Units; spent: Units; remaining: Units;
                      perTxApprovalLimit: Units; periodEnds: string; requiresEvidence: boolean }>;
     yield: Array<{ vault: string; name: string | null; principal: Units; value: Units; apyBps: number | null }>;
     gateway: Array<{ wallet: "collections" | "spend"; domain: number; balance: Units }>;
     internalWallets: Record<"yield" | "spend" | "fx" | "collections", { address: string; usdc: Units; eurc: Units }>;
     fundsUnderManagement: Units;
     runwayDays: number | null;
   }

   export interface ObligationRow { obligationId: Hex32; payee: { payeeId: Hex32; name: string }; source: string;
     category: string; token: "USDC" | "EURC"; amount: Units; dueDate: string; status: ObligationStatus;
     plannedPayDate: string | null; criticality: 1 | 2 | 3; latestDecisionId: Hex32 | null; paidTx: string | null }

   export interface DecisionRow { decisionId: Hex32; cycleId: string; seq: number; kind: DecisionKind;
     obligationId: Hex32 | null; state: DecisionDbState; revealed: boolean; decisionHash: Hex32; actionHash: Hex32;
     commitTx: string | null; executeTx: string | null; revealTx: string | null; escalationReason: number | null;
     summary: string; amount: Units | null; token: "USDC" | "EURC" | null; payeeName: string | null;
     overruled: boolean; createdAt: string; explorerUrl: string | null }

   export interface VerifyPayload { recordBytes: `0x${string}`; onchainDecisionHash: Hex32; recomputedSha256: Hex32;
     match: boolean; revealTx: string | null; revealedBytesEqual: boolean | null }
   ```
   `summary` is a one-line human description the backend builds for lists ("Pay Northwind 412.50 USDC 8 days early"). If the backend does not yet send it, build it client-side from the record (Phase 24).

4. **Query keys.** One module, `src/lib/api/keys.ts`, so invalidation from SSE (Phase 8) and from transactions (Phase 6) hits the same keys:
   ```ts
   export const qk = {
     health: (n: Net) => [n, "health"] as const,
     overview: (n: Net) => [n, "overview"] as const,
     forecast: (n: Net) => [n, "forecast"] as const,
     obligations: (n: Net, f?: object) => [n, "obligations", f ?? {}] as const,
     obligation: (n: Net, id: string) => [n, "obligation", id] as const,
     invoices: (n: Net, f?: object) => [n, "invoices", f ?? {}] as const,
     invoice: (n: Net, id: string) => [n, "invoice", id] as const,
     payees: (n: Net) => [n, "payees"] as const,
     payee: (n: Net, id: string) => [n, "payee", id] as const,
     decisions: (n: Net, f?: object) => [n, "decisions", f ?? {}] as const,
     decision: (n: Net, id: string) => [n, "decision", id] as const,
     verify: (n: Net, id: string) => [n, "verify", id] as const,
     escalations: (n: Net, f?: object) => [n, "escalations", f ?? {}] as const,
     escalation: (n: Net, id: string) => [n, "escalation", id] as const,
     cycles: (n: Net) => [n, "cycles"] as const,
     cycle: (n: Net, id: string) => [n, "cycle", id] as const,
     receivables: (n: Net) => [n, "receivables"] as const,
     receivable: (n: Net, id: string) => [n, "receivable", id] as const,
     yieldVaults: (n: Net) => [n, "yield", "vaults"] as const,
     yieldPositions: (n: Net) => [n, "yield", "positions"] as const,
     crosschain: (n: Net) => [n, "crosschain"] as const,
     services: (n: Net) => [n, "services"] as const,
     metrics: (n: Net) => [n, "metrics"] as const,
     agent: (n: Net) => [n, "agent"] as const,
   };
   ```

5. **Hooks.** One `useX` per endpoint in `src/lib/api/hooks.ts`, each `useQuery({ queryKey: qk.x(net, …), queryFn: () => unwrap(api(net).GET("/x", …)) })`. Lists that page use `useInfiniteQuery` with the backend's `cursor`.

6. **Missing endpoints.** The pages below use two read endpoints the backend table in its 40.2 does not list explicitly. Ask the backend to add them (they are thin queries over existing tables):
   - `GET /services` → rows of `service_purchases` with meter totals (Phase 39 here).
   - `GET /agent` → the treasury's ERC-8004 agent id, registration tx, and reputation summary from the backend's Phase 39.
   Until they exist, the pages show their empty state with "Coming from the backend" in dev builds only.

**Exit check:** `pnpm --filter web typecheck` passes with generated types; a dev page lists the first 10 obligations and decisions from the local backend with amounts formatted by `Amount`; turning the backend off shows `ErrorState` with the HTTP status, and turning it back on recovers on the next refetch without a reload.

---

## Phase 8 — Live events (Server-Sent Events)

**Goal:** pages update within a second of something happening on-chain or in a cycle, without polling everything.

**Steps**

1. **One connection per network.** `src/lib/events/sse.tsx` opens `new EventSource(\`${api}/events/stream\`)` once, in a provider, for the current network. Pages subscribe to it; they never open their own.

2. **Event types** (backend 40.2): `cycle.step`, `decision.committed`, `decision.executed`, `decision.escalated`, `decision.revealed`, `escalation.resolved`, `invoice.held`, `payment.in`, `crosschain.stage`, `audit.arrears`. Each arrives as `event: <type>` with a JSON `data` payload. Define the payload type defensively — the indexer's NOTIFY payload is whatever the backend's Phase 17 writes, so parse with zod and ignore anything that does not parse:
   ```ts
   const Evt = z.object({
     type: z.string(),
     at: z.string().optional(),
     decisionId: z.string().optional(),
     obligationId: z.string().optional(),
     receivableId: z.string().optional(),
     cycleId: z.string().optional(),
     step: z.string().optional(),
     status: z.string().optional(),
     txHash: z.string().optional(),
   }).passthrough();
   ```
   Agree with the backend that every payload carries at least `type` and the relevant id; that is all the frontend needs, because it refetches the details.

3. **Invalidation map.** `src/lib/events/invalidate.ts`:

   | Event | Invalidate |
   |---|---|
   | `cycle.step` | `cycles`, `cycle(cycleId)`; if `step` is `snapshot` → `overview`; if `forecast` → `forecast`; if `metrics` → `metrics` |
   | `decision.committed` | `decisions`, `decision(id)`, `cycle(cycleId)` |
   | `decision.executed` | `decisions`, `decision(id)`, `overview`, `obligations`, `obligation(obligationId)`, `metrics` |
   | `decision.escalated` | `decisions`, `decision(id)`, `escalations`, `obligations` |
   | `decision.revealed` | `decision(id)`, `verify(id)`, `decisions` |
   | `escalation.resolved` | `escalations`, `escalation(id)`, `decision(id)`, `obligations`, `overview` |
   | `invoice.held` | `invoices`, `obligations` |
   | `payment.in` | `receivables`, `receivable(receivableId)`, `overview`, `metrics` |
   | `crosschain.stage` | `crosschain` |
   | `audit.arrears` | `health` (and the arrears banner reads chain state directly) |

4. **Activity feed.** The provider also keeps the last 50 events in memory (not storage) and exposes them through `useActivity()`. The header shows a small pulsing dot when an event arrived in the last 3 seconds; the live view (Phase 32) and the overview's "Latest activity" card render the feed in plain language:
   - `decision.committed` → "Sealed a decision: pay Northwind 412.50 USDC"
   - `decision.revealed` → "Opened the record for 0xab…12 — verify"
   - `decision.escalated` → "Needs a human: 300.00 USDC to Studio Ka is over the approval limit"

5. **Reconnection.** `EventSource` reconnects on its own. Add: a visible "Live" / "Reconnecting…" indicator; on reconnect, invalidate `health`, `overview`, `decisions` and `escalations` once, because events may have been missed while disconnected. Close the connection when the tab is hidden for more than 5 minutes (`visibilitychange`) and reopen when it is visible again.

6. **CORS.** The backend's `CORS_ORIGIN` must include the frontend origin (`http://localhost:3000` in dev, the Vercel domain in production). SSE fails silently in some browsers on a CORS error; check the network tab, not the console.

**Exit check:** with the overview open, trigger `POST /admin/cycle/run` on the backend; within a second the activity dot pulses, the cycle appears in `/cycles` without a refresh, and the overview's snapshot block number changes; killing the backend shows "Reconnecting…", restarting it returns to "Live" and refreshes data.

---

## Phase 9 — Signed messages and the admin session

**Goal:** approvers can sign off-chain actions the API can attribute, and admins can trigger admin API routes without the admin API key ever reaching a browser.

### 9.1 Signed approver actions (EIP-191)

The backend's 40.4 defines the message exactly. Build it in one function so the bytes are identical every time:
```ts
// src/lib/auth/signedAction.ts
export function buildReviewMessage(p: { action: string; target: string; verdict: string; nonce: string; issuedAt: string }) {
  return [
    "Athena review",
    `action: ${p.action}`,
    `target: ${p.target}`,
    `verdict: ${p.verdict}`,
    `nonce: ${p.nonce}`,
    `issuedAt: ${p.issuedAt}`,
  ].join("\n");
}

export function useSignedAction() {
  const { signMessageAsync } = useSignMessage();
  const { address } = useAccount();
  return async (action: string, target: string, verdict: string) => {
    if (!address) throw new HumanError("Connect the approver wallet first.");
    const nonce = crypto.randomUUID();
    const issuedAt = new Date().toISOString();
    const message = buildReviewMessage({ action, target, verdict, nonce, issuedAt });
    const signature = await signMessageAsync({ message });
    return { address, message, signature, nonce, issuedAt };
  };
}
```
The wallet shows the message in plain text, so the approver can read exactly what they are agreeing to. The API checks the signature, the role on-chain, the nonce and the 10-minute age (backend 40.4). Use these for: review-queue resolutions (Phase 20) and decision reviews (Phase 30).

### 9.2 The admin session (Sign-In With Ethereum style)

Admin API routes (`POST /invoices/upload`, `POST /payees`, `POST /receivables`, `POST /admin/cycle/run`, …) require the backend's `ADMIN_API_KEY`. That key must never be in the browser. The web app therefore has its own small server:

1. `GET /api/session/nonce` → a random nonce stored in a short-lived, http-only cookie.
2. The browser asks the wallet to sign:
   ```
   Athena admin sign-in
   network: testnet
   address: 0x…
   nonce: <nonce>
   issuedAt: <ISO time>
   expires: <ISO time + 60 min>
   ```
3. `POST /api/session/login` with `{ message, signature }`. The route:
   - recovers the address with viem `verifyMessage`;
   - checks the nonce matches the cookie and has not been used;
   - checks `issuedAt` is within 5 minutes and `expires` is in the future;
   - **reads `hasRole(DEFAULT_ADMIN_ROLE, address)` on the treasury for that network** with a server-side viem public client;
   - on success, sets an encrypted, http-only, `SameSite=Strict`, `Secure` (in production) session cookie with `{ address, net, isAdmin: true, exp }` using `iron-session` and `SESSION_SECRET`.
4. `POST /api/session/logout` clears it. Disconnecting the wallet or switching account calls logout automatically.

```ts
// app/api/session/login/route.ts (core)
export async function POST(req: Request) {
  const { message, signature } = await req.json();
  const fields = parseSignIn(message);                               // strict line-by-line parser; reject extra lines
  const nonceCookie = (await cookies()).get("athena_nonce")?.value;
  if (!nonceCookie || fields.nonce !== nonceCookie) return json({ error: "bad nonce" }, 401);
  if (Date.now() - Date.parse(fields.issuedAt) > 5 * 60_000) return json({ error: "stale" }, 401);

  const ok = await verifyMessage({ address: fields.address, message, signature });
  if (!ok) return json({ error: "bad signature" }, 401);

  const client = serverClient(fields.network);
  const isAdmin = await client.readContract({ address: netConfig(fields.network).treasury!, abi: treasuryAbi,
                                              functionName: "hasRole", args: [ROLE.ADMIN, fields.address] });
  if (!isAdmin) return json({ error: "not an admin of this treasury" }, 403);

  const session = await getIronSession<Session>(await cookies(), sessionOptions);
  Object.assign(session, { address: fields.address, net: fields.network, isAdmin: true, exp: Date.parse(fields.expires) });
  await session.save();
  (await cookies()).delete("athena_nonce");
  return json({ ok: true });
}
```

### 9.3 The admin proxy

`app/api/admin/[...path]/route.ts` forwards only an **allowlist** of backend routes, adds the admin key server-side, and re-checks the session on every call:

| Browser calls | Forwards to backend | Method |
|---|---|---|
| `/api/admin/invoices/upload` | `/invoices/upload` | POST (multipart, streamed) |
| `/api/admin/invoices` | `/invoices` | POST |
| `/api/admin/payees` | `/payees` | POST |
| `/api/admin/purchase-orders` | `/purchase-orders` | POST |
| `/api/admin/receipts` | `/receipts` | POST |
| `/api/admin/receivables` | `/receivables` | POST |
| `/api/admin/cycle/run` | `/admin/cycle/run` | POST |
| `/api/admin/cycle/dry-run` | `/admin/cycle/dry-run` | POST |

Anything else returns 404. The proxy:
- rejects requests whose `Origin` header is not the app's own origin (CSRF);
- re-reads `hasRole` on-chain at most once a minute per session (cache in memory), so a revoked admin loses access within a minute even with a live cookie;
- adds `x-admin-key` (or whatever header the backend's `ADMIN_API_KEY` check expects — match it exactly) and `x-athena-actor: <address>` so the backend can log who triggered it;
- limits upload size to 10 MB and passes the body through as a stream.

**Exit check:** signing in with the approver wallet is refused with "not an admin of this treasury"; signing in with the admin wallet sets a cookie and the admin page unlocks; calling `/api/admin/cycle/run` from `curl` without the cookie returns 401; the built JavaScript bundle (`.next/static`) contains no occurrence of the admin key (search for it).

---
## THE SHELL AND THE FRONT DOOR

## Phase 10 — The app shell

**Goal:** every console page shares one frame: sidebar, header, health banner, network switch, wallet menu, live indicator and a command menu.

**Steps**

1. **`app/(console)/layout.tsx`** renders:
   ```
   ┌──────────────┬──────────────────────────────────────────────────────────────┐
   │  ATHENA      │  [HealthBanner — only when paused / in arrears / stale]      │
   │              ├──────────────────────────────────────────────────────────────┤
   │  sidebar     │  Header: ⌘K search · NetworkBadge switch · Live dot · Wallet │
   │  (A6 groups) ├──────────────────────────────────────────────────────────────┤
   │              │  Page title (display)                                        │
   │              │  One-line plain explanation                                  │
   │              │  ─────────────────────────────────────────────────────────── │
   │              │  page content                                                │
   │  footer:     │                                                              │
   │  treasury ↗  │                                                              │
   │  block #     │                                                              │
   └──────────────┴──────────────────────────────────────────────────────────────┘
   ```
2. **Sidebar.** The groups and items from A6. Active item has a gold left bar. Counts for Review queue and Escalations come from `useInvoices({ status: "held" })` and `useEscalations({ status: "pending" })` (`select: d => d.length`). The CONTROL group renders only inside `<RoleGate>`. The footer shows the treasury address chip and the latest block from `useBlockNumber({ watch: true, chainId })`, throttled to update the text at most once a second.
3. **Header.**
   - `NetworkBadge` doubles as the switch (Phase 5). On mainnet, the badge is gold-outlined and the page title gets a small "MAINNET" eyebrow.
   - Live dot from Phase 8.
   - Wallet menu from Phase 5.
4. **`HealthBanner`** — the only full-width colored element in the app, and it appears only when something is wrong. It reads `paused()` and `overdueCount()` **from the chain** (Phase 6 `useTreasuryHealth`), plus `lastCycleAt` from `/health`:

   | Condition | Banner | Tone |
   |---|---|---|
   | `paused()` is true | "Treasury paused by a human. The agent can only sync and publish records until an admin unpauses." + who paused (from the latest `Paused` event) | warn |
   | `overdueCount() > 0` | "Audit arrears: N decision record(s) were not published in time. The contract has frozen new commits and payments until they are." + link to the overdue decisions | bad |
   | `lastCycleAt` older than 3 × the cycle interval | "No treasury cycle has run since 14:05. The operator may be stopped." | warn |
   | API unreachable but chain reachable | "The Athena API is unreachable. Showing on-chain data only." | warn |

   The arrears banner is a feature, not an error state: it is the contract's audit rule working. Phase 46's tour points at it during the arrears scenario.
5. **Command menu (⌘K / Ctrl+K).** A dialog with one input that accepts:
   - a 32-byte hex → tries decision, obligation, payee, receivable in that order (`GET` each; first hit wins) and navigates;
   - a transaction hash → `/verify?tx=…` (Phase 27);
   - an address → payee with that address, or the explorer;
   - text → page names ("escalations", "yield") and payee names (from the cached payee list).
6. **Page header component.** `<PageHeader title="Obligations" lede="Everything the business owes, and what Athena plans to do about each one." actions={…} />`. Every page uses it; the lede is written for a judge who has never seen the app.
7. **Mobile.** Below 1024px the sidebar becomes a bottom-sheet menu opened from a header button. The header keeps the network badge and wallet; the command menu moves into the sheet.

**Exit check:** every route in A6 renders inside the shell with the correct active item; pausing the treasury from the approver wallet (Phase 42) makes the banner appear in another browser within 5 seconds without a reload; ⌘K with a decision id jumps to that decision.

---

## Phase 11 — The landing page

**Goal:** in ten seconds, a judge understands what Athena does, sees that it is running right now with real numbers, and has one click to proof.

**Steps**

1. **Sections, top to bottom:**

   **Hero** (full viewport height)
   - The word **ATHENA** in the hero size, white, bleeding slightly off the left edge on wide screens.
   - The 3D seal (Phase 12) to the right of the word on desktop, behind it (dimmed) on phones.
   - Tagline: **"The treasury agent that seals every decision before it spends."**
   - Sub-line: "Athena pays your bills, collects what you're owed and puts idle cash to work in USDC on Arc — and commits a hash of its reasoning on-chain before any money moves."
   - Two buttons: **Open the treasury** → `/overview` (primary), **Verify a decision** → `/verify` (secondary). A text link: "Take the 90-second tour" (Phase 46).

   **Live strip** — four numbers from `/metrics`, mainnet first if live, each with its network badge and a link to its evidence:
   - USDC paid out · Obligations settled without a human · Decisions sealed and opened · Funds under management.
   Each counts up once on first view. If the API is unreachable, the strip hides rather than showing zeros.

   **The cycle in three steps** — three columns with the seal in miniature:
   1. **Seal.** "Before paying, Athena writes down what it saw, the forecast it ran, the rule it applied and what it will send — and commits the SHA-256 of that record to Arc."
   2. **Act.** "The treasury contract re-checks every rule. Inside policy, it pays. Outside policy, it stops and asks a human, whose own wallet decides."
   3. **Open.** "Athena publishes the full record on-chain. The contract checks it matches the seal. Miss the deadline and the contract freezes the agent."

   **The latest sealed decision** — one live card: kind, payee, amount, rationale (first 200 characters), state badge, and a **Verify in your browser** button that runs Phase 26 inline and shows the result. This is the strongest single proof on the page; it should update when SSE reports a new reveal.

   **Six mistakes an agent makes with money** — the table from the backend's A2, rewritten for a visitor: each row is the mistake in one sentence and Athena's defense in one sentence, with a link to a live example (a held duplicate invoice, an intercepted address change, an escalation) when one exists in the data.

   **What it runs on** — a row of plain text labels, no logos: Arc · USDC · EURC · Circle Wallets · Gateway · CCTP · App Kit · Earn Kit · Nanopayments (x402) · Compliance Engine · ERC-8004. Each label links to the page in the app where that tool is visible (e.g. Gateway → `/overview#gateway`, CCTP → `/crosschain`).

   **Footer** — treasury address on each network with explorer links, "Built for the Tameion Agents Hackathon", repository link, the MCP link (`/mcp`).

2. **Rendering.** The landing is a server component for the static parts (fast first paint, good link previews) with client islands for the seal, the live strip and the latest decision.

3. **Open Graph image.** `app/opengraph-image.tsx` renders a 1200×630 image: black background, "ATHENA" in the display face, the tagline, and one live number (USDC paid out) fetched at build/revalidate time. Revalidate every hour.

4. **Copy rules.** No "revolutionary", no "AI-powered", no emoji. Say what it does.

**Exit check:** on a cold load over a throttled "Fast 4G" connection, the hero text is visible in under 2 seconds and the seal fades in after; the live strip shows real numbers from the local backend; "Verify in your browser" on the latest decision shows ✓ for every check; the page has no horizontal scroll at 375px.

---

## Phase 12 — The seal: the one 3D element

**Goal:** a single, reusable 3D object that shows the commit–reveal idea without words: closed and glowing while sealed, cracking when the record is published, opening to reveal the record.

**Steps**

1. **States.**

   | State | Look | When |
   |---|---|---|
   | `idle` | closed lock, slow rotation, soft gold glow breathing every 4 s | landing hero, empty live view |
   | `sealing` | lock drops 10% and closes with a short click, glow flares then settles | a decision is committed |
   | `sealed` | closed, steady glow, a thin ring orbiting (the hash) | waiting for execution/reveal |
   | `cracking` | hairline cracks of light spread across the body over 600 ms | reveal transaction seen |
   | `open` | shackle lifts and swings 35°, body halves part a few millimetres, a flat panel of light rises out (the record) | reveal verified |
   | `broken` | cracks turn red, glow dims | verification mismatch (should never happen; it must still be designed) |

2. **Scene** (`src/components/seal/Seal.tsx`, client only):
   ```tsx
   "use client";
   import { Canvas, useFrame } from "@react-three/fiber";
   import { RoundedBox, Environment, Lightformer, Float } from "@react-three/drei";

   export type SealState = "idle" | "sealing" | "sealed" | "cracking" | "open" | "broken";

   export default function Seal({ state, className }: { state: SealState; className?: string }) {
     return (
       <div className={className} aria-hidden>
         <Canvas dpr={[1, 1.75]} camera={{ position: [0, 0, 6], fov: 35 }} frameloop="always" gl={{ antialias: true, alpha: true }}>
           <ambientLight intensity={0.2} />
           <Environment resolution={256}>
             <Lightformer form="rect" intensity={2} position={[0, 5, -5]} scale={[10, 2, 1]} />
             <Lightformer form="ring" intensity={1.5} position={[-4, 0, 3]} scale={2} />
           </Environment>
           <Float speed={state === "idle" ? 1.2 : 0.6} rotationIntensity={0.2} floatIntensity={0.4}>
             <Lock state={state} />
           </Float>
         </Canvas>
       </div>
     );
   }
   ```
   `<Environment>` with only `Lightformer` children builds its lighting locally — no HDR file is fetched from a CDN.

3. **Geometry** (`Lock`):
   - **Body:** two `RoundedBox` halves (left/right), each `[0.9, 1.6, 0.8]`, radius 0.12, placed edge to edge so they read as one block when closed. Material: `meshStandardMaterial` with `color` = seal gold, `metalness 0.9`, `roughness 0.25`, `emissive` = seal gold at intensity driven by state.
   - **Shackle:** a `TubeGeometry` along a half-ellipse curve above the body, same material.
   - **Hash ring:** a thin `TorusGeometry` (radius 1.6, tube 0.01) with `meshBasicMaterial` at 40% opacity, rotating on a tilted axis while `sealed`.
   - **Cracks:** 8–12 `Line` segments (drei `Line`) laid on the body faces, generated once from a seeded random walk; their `dashOffset` animates from fully hidden to fully drawn during `cracking`. Color seal gold, or `--bad` red for `broken`.
   - **Record panel:** a thin plane that rises from between the halves during `open`, with emissive white at low intensity. No text in 3D — the record itself is shown in HTML beside the seal.

4. **Animation.** Drive every transition in `useFrame` with damped interpolation toward a target per state (`THREE.MathUtils.damp(current, target, lambda, delta)`), not with timelines, so interrupting a state mid-animation never snaps:

   | Property | idle | sealing | sealed | cracking | open | broken |
   |---|---|---|---|---|---|---|
   | shackle lift (y) | 0 | 0 | 0 | 0.05 | 0.45 | 0.05 |
   | shackle swing (rad) | 0 | 0 | 0 | 0 | 0.6 | 0 |
   | halves gap (x) | 0 | 0 | 0 | 0.01 | 0.06 | 0.03 |
   | emissive | 0.15–0.3 breathing | 0.9 → 0.4 | 0.4 | 0.8 | 0.6 | 0.1 |
   | crack draw (0–1) | 0 | 0 | 0 | 1 | 1 | 1 |
   | panel rise | 0 | 0 | 0 | 0 | 1 | 0 |

   A parent component sequences `sealing → sealed` and `cracking → open` with timeouts (400 ms, 700 ms) so callers only set the meaningful state.

5. **Performance.**
   - Load with `next/dynamic(() => import("./Seal"), { ssr: false, loading: () => <SealFallback /> })`.
   - Pause rendering when off-screen: wrap in an `IntersectionObserver` and switch `frameloop` to `"never"` when not visible.
   - Cap DPR at 1.75; no shadows; no post-processing by default. If you add bloom (`@react-three/postprocessing`), enable it only on devices that report `navigator.hardwareConcurrency >= 8` and only on the landing hero.
   - Budget: under 150 KB gzipped for the seal chunk (three.js tree-shaken through fiber). Check with `next build` output.

6. **Fallbacks.**
   - `SealFallback` — an inline SVG lock with the same states done in CSS (stroke-dashoffset for cracks, transform for the shackle). Used while loading, under `prefers-reduced-motion`, when WebGL is unavailable (`!!document.createElement("canvas").getContext("webgl2")` is false), and in the miniature verification badge.
   - The seal is decorative (`aria-hidden`). Every state it shows is also stated in text next to it.

7. **Reuse.** Exported variants: `<Seal state=… />` (hero, live view), `<SealMini state=… />` (SVG, 20 px, used inside badges and the decision log).

**Exit check:** a debug control on the kitchen-sink page cycles all six states with smooth transitions and no snapping when you click quickly; Chrome's performance panel shows the landing page idle at under 10% CPU on a laptop with the seal visible and ~0% when scrolled away; with reduced motion on, the SVG appears instead and states change instantly.

---

## KNOWING THE MONEY

## Phase 13 — Treasury overview

**Goal:** one page that answers "what does this business have, what can it spend, how long will it last, and where is the money?" — with every figure traceable.

**Steps**

1. **Data:** `useOverview(net)` (API snapshot) + `useTreasuryHealth()` (live chain reads). The page shows the snapshot's block and time in small text under the title: "As of block 1,234,567 · 14:05 · snapshot 0x9f…21". The snapshot hash links to the cycle that took it.

2. **Layout:**
   ```
   ┌───────────── Spendable now ─────────────┬────── Runway ──────┬──── Funds under management ────┐
   │ 18,420.55 USDC   ·   1,250.00 EURC       │ 47 days (stress)    │ 31,880.10 USDC equivalent        │
   │ free operating − floor                    │ base: 63 days       │ treasury + yield + Gateway + ... │
   └───────────────────────────────────────────┴─────────────────────┴──────────────────────────────────┘
   ┌────────────────── Where the money is (stacked bar + table) ──────────────────────────────────────────┐
   │ Treasury free │ Reserve │ Operating floor │ Yield │ Gateway (other chains) │ Internal wallets           │
   └───────────────────────────────────────────────────────────────────────────────────────────────────────┘
   ┌──────── Budgets this period (Phase 15) ────────┐ ┌──────── Latest activity (SSE feed) ────────┐
   └────────────────────────────────────────────────┘ └────────────────────────────────────────────┘
   ┌──────── Coming due (next 14 days) ─────────────┐ ┌──────── Needs a human ──────────────────────┐
   │ top 6 obligations with planned dates            │ │ pending escalations + held invoices count   │
   └────────────────────────────────────────────────┘ └────────────────────────────────────────────┘
   ```

3. **Headline figures** (definitions are the backend's 18.4; show them as tooltips):
   - **Spendable now** per token = `freeOperating − minOperating`, floored at 0.
   - **Runway** = the forecast's runway in the stress case (primary) and base case (secondary). `null` → "More than 30 days".
   - **Funds under management** = treasury balance + yield value + Gateway balances + internal wallets. On testnet, add a `TESTNET` badge; never mix testnet and mainnet into one total.

4. **"Where the money is" bar.** A single horizontal stacked bar (USDC only; EURC gets its own thin bar below) with segments:

   | Segment | Value | Color |
   |---|---|---|
   | Free operating above the floor | `freeOperating − minOperating` | text |
   | Operating floor | `minOperating` | muted, hatched |
   | Reserve | `reserved` | seal |
   | In yield | Σ position `value` | ok |
   | Gateway on other chains | Σ Gateway balances with domain ≠ 26 | info |
   | Internal wallets | yield + spend + fx + collections wallet balances | surface-2 |

   Below the bar, a table with each segment, its exact amount (`Amount exact`), and where it lives (address chip, vault name, chain name for Gateway domains: 26 Arc, 6 Base, 0 Ethereum — map domains to names in `@athena/shared`).

5. **Live vs snapshot.** The headline "Treasury balance" in the header strip is the live `balanceOf(treasury)` read; the rest of the page is the snapshot the agent used. If the live balance differs from the snapshot balance, show a small note: "Balance changed since the last snapshot (+412.50). The next cycle will see it." This makes clear that decisions are made against a pinned picture — which is the point of the audit trail.

6. **Gateway section** (`id="gateway"`). A card titled "One balance across chains — Circle Gateway" listing each wallet (`collections`, `spend`) × domain with its balance, and a total. Link each row to the cross-chain page filtered to that domain.

7. **Internal wallets.** A small table: role (yield, spend, FX, collections), address chip, USDC, EURC, and a one-line purpose ("Holds USDC between treasury and Earn Kit vault deposits"). On mainnet, if the spend wallet is a Circle Agent Wallet with spending limits, show its limits here (from the API; backend Phase 45).

**Exit check:** every number on the page has a tooltip with its definition and either a link or an exact value; the stacked bar's segments sum to the funds-under-management figure within 0 units (compute the check in the component and log a console warning in dev if they differ); with the backend paused mid-cycle, the page still renders from the last snapshot and says how old it is.

---

## Phase 14 — The forecast

**Goal:** show the 30-day cash picture the agent planned against — base and stress — so a reviewer can see why it held one bill and paid another early.

**Steps**

1. **Data:** `useForecast(net)` →
   ```ts
   interface Forecast {
     forecastHash: Hex32; cycleId: string; asOf: string; horizonDays: number;
     startBalance: Units;
     days: Array<{ date: string; inflowsBase: Units; inflowsStress: Units; outflows: Units;
                   balanceBase: Units; balanceStress: Units;
                   items: Array<{ kind: "obligation" | "receivable" | "subscription"; id: string; label: string; amount: Units; direction: "in" | "out" }> }>;
     minBalanceBase: Units; minBalanceStress: Units;
     firstShortfall: string | null; runwayDays: number | null;
     assumptions: { stressInflowDelayDays: number; stressReceivableHaircutBps: number; accuracy14d: number | null };
   }
   ```
   Align field names with the backend's Phase 19 output; if they differ, adapt in the hook, not in the chart.

2. **Chart** (`src/components/charts/ForecastChart.tsx`, Recharts `ComposedChart`):
   - X axis: dates.
   - Two lines: base balance (text color) and stress balance (warn color, dashed).
   - Bars below the zero line for outflows per day, above for inflows (muted).
   - A horizontal reference line at the operating floor (`minOperating`), labeled "floor".
   - A shaded band where stress balance < floor, labeled "shortfall".
   - Recharts takes numbers. Convert **only for plotting** with a dedicated `toChartNumber(units)` that divides by 10^6 into a float; never reuse that number for display. Tooltips show the exact `Amount` from the original strings.

3. **Day drawer.** Clicking a day opens a drawer listing that day's items (what goes out, what comes in, base vs stress), each linking to its obligation or receivable.

4. **Assumptions card.** Plain text: "Stress case: every customer pays 7 days late and half of uncertain receivables never arrive." from `assumptions`. Forecast accuracy over the last 14 days if known ("Forecast accuracy: 93% over 14 days").

5. **Why it matters panel.** Three bullets generated from the data:
   - "Lowest point in the stress case: 2,140.00 USDC on Oct 21."
   - "Athena kept 1,500.00 USDC in reserve because of that dip." (if a RESERVE decision exists in the latest cycle — link it)
   - "Paying Northwind early still leaves 1,900.00 USDC at the lowest point." (if a PAY_EARLY exists)

**Exit check:** the chart renders 30 days with both series; the floor line sits at the configured `minOperating`; tooltips show exact amounts; clicking a day lists the same obligations the obligations page shows for that date.

---

## Phase 15 — Budgets and limits

**Goal:** show the policy the contract enforces — per-category period budgets, per-payment approval limits, evidence requirements — and how much of each is used.

**Steps**

1. **Data.** The list comes from the API snapshot (`overview.budgets`). On the controls page (Phase 42) and in each budget's detail popover, also read `getBudget(category, token)` from the chain and show "on-chain" next to the values, so a reviewer can see the API is not inventing limits.

2. **Category names.** Use `CATEGORY` from `@athena/shared/categories` to turn bytes32 ids into names (VENDOR, CONTRACTOR, SUBSCRIPTION, SERVICES, YIELD, FX, …). If an id is unknown, show the hex — never hide it.

3. **`BudgetBar`** per (category, token):
   ```
   VENDOR · USDC                                   resets Oct 31
   ████████████░░░░░░░░░  1,240.00 of 2,000.00 used    760.00 left
   Single payments above 250.00 go to a human · Evidence required ✓
   ```
   Colors: ok under 70% used, warn 70–90%, bad above 90%.

4. **Explain escalation thresholds** in one sentence each, from the same numbers:
   - "A vendor payment above 250.00 USDC needs a human signature."
   - "Once 2,000.00 USDC of vendor payments go out this period, every further vendor payment needs a human."
   - "No vendor payment is made without an invoice, PO and receipt bundle hashed into it."

5. **Where it shows:** a compact version on the overview; a full version on `/controls` with the admin's edit buttons (Phase 42).

**Exit check:** every configured budget appears with the same limit and remaining as `getBudget` on-chain; a payment that pushed the vendor budget over 90% shows it red after the next snapshot.

---
## ACCOUNTS PAYABLE

## Phase 16 — Obligations: everything the business owes

**Goal:** a list of every bill, subscription and milestone, with what Athena plans to do about each and why, filterable in the ways an accountant thinks.

**Steps**

1. **Data:** `useObligations(net, { status, payee, cursor })` (infinite).

2. **Views** as tabs synced to `?tab=`:

   | Tab | Filter | Default sort |
   |---|---|---|
   | **Coming due** | `open`, `scheduled` | due date ascending |
   | **Held** | `held` | created descending |
   | **With a human** | `escalated` | escalation expiry ascending |
   | **Paid** | `paid` | paid date descending |
   | **All** | none | due date descending |

3. **Columns:**

   | Column | Content |
   |---|---|
   | Payee | name + category tag; cross-chain payees get a small chain tag ("Base") |
   | Amount | `Amount` with token |
   | Due | `dueLabel` ("Due in 4 days", "Paid 8 days early") |
   | Plan | what Athena decided: "Pay on Oct 14", "Pay today — 2% discount", "Holding: duplicate", "Waiting for approver" |
   | Source | invoice / subscription / milestone / manual |
   | Criticality | 1 (contractor, never late) / 2 / 3 — as a dot with a tooltip |
   | Decision | `SealMini` + state badge of the latest decision, linking to it |

   The **Plan** column is the reason this page exists. It is built from the latest decision's kind and the obligation's `plannedPayDate`/status, not from the planner's free text.

4. **Filters:** payee (searchable select from `usePayees`), category, token, date range on due date. Keep them in the URL.

5. **Summary row** above the table for the active tab: count, total per token, and for "Coming due": "Athena plans to pay 6 of these early, capturing 41.20 USDC in discounts."

6. **Row click** → `/obligations/[obligationId]`.

**Exit check:** each tab shows the right rows from the seeded house operations; the Plan column matches the latest decision for five rows you check by hand; filters survive a reload.

---

## Phase 17 — One obligation, end to end

**Goal:** a reviewer opens a bill and sees its whole life: the document, the match, the evidence hash, every decision Athena sealed about it, and the payment on-chain.

**Steps**

1. **Data:** `useObligation(net, id)` → obligation + invoice + match result + evidence bundle + decision history (backend 40.2).

2. **Header:** payee name, amount (large, display face), due label, status badge, and the on-chain `obligationId` as a `HashChip`. If paid: "Paid by decision 0xab…12 in tx 0x9c…ff on Oct 14" with links.

3. **Life timeline** (the `Timeline` primitive), assembled from the record:
   ```
   ● Invoice received            Oct 2 · email · INV-0042
   ● Extracted and checked       Oct 2 · amounts parsed exactly · no duplicate
   ● Three-way match             Oct 2 · invoice ↔ PO-0007 ↔ receipt R-0019 · matched
   ● Evidence sealed             0x3f…a1 (hash of the document bundle)
   ● Decision: schedule Oct 14   Oct 2 · sealed 0x77…02 · opened ✓
   ● Decision: pay early (2%)    Oct 6 · sealed 0x81…9c · executed · opened ✓
   ● Paid                        Oct 6 · 404.25 USDC · tx 0x9c…ff
   ```
   A decision that changed the plan explains it in one line taken from its record's rationale.

4. **Tabs below the timeline:**

   **Document** — invoice number, dates, lines, totals, terms. A button "Open original document" requests the signed download URL (valid 5 minutes) only when clicked, and opens it in a new tab with `rel="noopener noreferrer"`. Never embed vendor documents in the page.

   **Match** — the three-way match as a side-by-side table:

   | Line | Invoice | PO | Receipt | Result |
   |---|---|---|---|---|
   | Hosting — October | 1 × 400.00 | 1 × 400.00 | accepted Oct 1 | ✓ |
   | Bandwidth overage | 1 × 12.50 | — | — | ✗ not on PO |

   Totals, terms comparison (invoice "2/10 net 30" vs PO "2/10 net 30"), and the overall status (`matched`, `partial`, `mismatch`, `no_po`) with its color.

   **Evidence** — the evidence bundle as the backend hashed it: the list of components (invoice document hash, PO id and hash, receipt id and hash) and the resulting `evidenceHash`. Show the canonical JSON in a `CodeBlock` with a **Recompute** button that computes SHA-256 of the canonical bytes in the browser (same function as Phase 26) and compares with the stored `evidenceHash` and with the `evidenceHash` in the executed action. Three ✓ means the payment on-chain points at exactly these documents.

   **Decisions** — every decision about this obligation as `DecisionRow`s (Phase 24).

   **Payee** — a compact card of the payee with status, cap and screening result, linking to the payee page.

5. **Untrusted text.** Vendor notes and line descriptions are rendered as plain text in a muted box labeled "From the vendor's document". Nothing from a document is ever rendered as a link unless it is an address the app formats itself.

**Exit check:** for a paid seeded obligation, the timeline shows receive → match → evidence → decisions → payment; "Recompute" on the evidence tab gives three ✓; the original document opens through a short-lived URL that stops working after 5 minutes.

---

## Phase 18 — Uploading invoices (admin)

**Goal:** the admin can drop vendor invoices into Athena from the browser and watch each one move through extraction and checks.

**Steps**

1. **Page:** `/invoices/upload`, wrapped in `<RoleGate need="admin">` and requiring the admin session (Phase 9.2). If the wallet is admin but not signed in, show one button: "Sign in to upload" → runs the sign-in flow.

2. **Dropzone.** Accept `application/pdf`, `image/png`, `image/jpeg`; up to 10 files; 10 MB each. Reject other types before upload with a clear message.

3. **Upload.** `POST /api/admin/invoices/upload` (proxied to backend `POST /invoices/upload`) as `multipart/form-data`, one request per file, with progress from `XMLHttpRequest.upload.onprogress` (fetch does not report upload progress). Show each file as a row:
   ```
   hosting-oct.pdf      ████████████ uploaded → extracting… → checked → obligation created (due Oct 30)
   design-m2.pdf        ████████████ uploaded → extracting… → held: payee address changed
   ```
   Status after upload comes from polling `GET /invoices/:id` every 2 s for 60 s (or from `invoice.held` SSE events), until the invoice reaches `obligated`, `held` or `rejected`.

4. **JSON intake.** A second tab, "Enter manually", posts to `POST /api/admin/invoices` with a form (payee select, invoice number, dates, lines, token, terms). Amount fields use `AmountInput`. This is for services that bill through an API rather than a PDF.

5. **What the admin does not get:** no field to type a payout address. The address comes from the payee registry only (backend A2, "Commission"). If the document prints an address, the backend compares it; the admin never chooses it here.

**Exit check:** uploading a seeded PDF produces an obligation within a minute and the row says so; uploading the same PDF again ends in `held: duplicate`; a `.docx` is refused before upload; the network tab shows requests to `/api/admin/...`, never to the backend with a key.

---

## Phase 19 — The review queue and invoice detail

**Goal:** everything Athena refused to guess about is in one place, each item explains what is wrong in a sentence, and the approver can fix it in one or two clicks.

**Steps**

1. **Data:** `useInvoices(net, { status: "held" })` for the queue; `useInvoice(net, id)` for detail.

2. **Queue layout:** cards, not a table — each held invoice needs explanation.
   ```
   ┌─ PROBABLE DUPLICATE ─────────────────────────────────────────── received Oct 7 ─┐
   │ Northwind Hosting · INV-0042 · 412.50 USDC · due Oct 30                         │
   │ Looks like INV-0042 received Oct 2 (same vendor, same total, same number).       │
   │ [Compare side by side]   [It's a duplicate — reject]   [They're different — release] │
   └─────────────────────────────────────────────────────────────────────────────────┘
   ```

3. **Hold reasons → sentence → actions.** One map, matching the backend's 30.4:

   | `hold_reason` | Sentence | Actions (verdict sent) |
   |---|---|---|
   | `duplicate` | "This is the same invoice as {other}." | Reject (`reject`) |
   | `probable_duplicate` | "This looks like {other}: {why}." | Reject (`reject`) · Release as distinct (`mark_distinct`) |
   | `mismatch` | "The invoice doesn't match the PO: {diff}." | Link a different PO (`link_po:<poId>`) · Reject |
   | `partial` | "Only part of this has been received: {detail}." | Record a receipt (opens receipt form) · Reject |
   | `no_po` | "There's no purchase order for this vendor and amount." | Link a PO · Create a PO (opens PO form) · Reject |
   | `payee_address_changed` | "The invoice asks to be paid to a different address than the one on file." | Go to the payee's change request (Phase 23) · Reject |
   | `amount_unparseable` | "The amount couldn't be read exactly: {raw}." | Correct the amount (`correct:total=<units>`) · Reject |
   | `line_sum_mismatch` | "The lines add up to {sum}, but the total says {total}." | Correct the total · Reject |
   | `bad_dates` | "The dates don't make sense: {detail}." | Correct the dates (`correct:due_date=<YYYY-MM-DD>`) · Reject |
   | `unsupported_currency` | "Athena pays in USDC and EURC only; this invoice is in {ccy}." | Reject |
   | `payee_unknown` | "This vendor isn't in the payee registry." | Create the payee (Phase 23) · Reject |

   If the backend uses a reason not in this map, show the raw reason and only the Reject action.

4. **Compare side by side** (duplicates): two columns, the held invoice and the earlier one, with differing fields highlighted. Include document hashes; identical hashes mean the same file was sent twice.

5. **Invoice detail page** (`/invoices/[id]`), also linked from obligations:
   - **What the model read** (`extracted`) on the left, labeled "Suggestion from the extraction model — not trusted".
   - **What Athena accepted** (normalized fields) on the right.
   - Differences highlighted. If they differ, a note explains which rule changed it ("Total re-parsed strictly: '6.000000' → 6.000000 USDC").
   - Duplicate check result with the fingerprint (`sha256(payee|number|total|token)`).
   - Match detail as in Phase 17.
   - Printed payout address (if any) vs the registry address, with a big ✓ or ✗.

**Exit check:** every seeded hold reason renders with the right sentence and actions; the duplicate comparison highlights exactly the fields that differ; the extraction panel is visibly labeled untrusted.

---

## Phase 20 — Resolving holds with a signature

**Goal:** every human decision on a held invoice is signed by the approver's wallet and attributable, without spending gas.

**Steps**

1. **Flow** for any action button on a held invoice:
   1. If the action needs input (a PO id, a corrected amount, a date), open a small dialog with the field. Amounts use `AmountInput` and send **atomic units** as a string.
   2. Build the verdict string: `reject`, `mark_distinct`, `link_po:<poId>`, `correct:total=<units>`, `correct:due_date=<YYYY-MM-DD>`. The corrected value is **inside the signed message**, so the backend can prove the human approved that exact value.
   3. `useSignedAction()("invoice_resolve", invoiceId, verdict)` — the wallet shows the text.
   4. `POST /invoices/:id/resolve` with `{ address, message, signature, nonce, issuedAt, verdict }` directly to the backend (this route is approver-signed, not admin-key protected — backend 40.3).
   5. On 200: toast "Released — Athena will plan this in the next cycle", invalidate `invoices` and `obligations`. On 401/403: show the backend's message ("signer is not an approver", "message expired", "nonce reused").

2. **Confirmation copy** before signing:
   - Reject: "Athena will never pay this invoice. The vendor can send a corrected one."
   - Release as distinct: "Athena will treat this as a separate bill and plan to pay it."
   - Correct amount: "Athena will use 412.500000 USDC instead of what it read. Your address will be recorded as the source of this value."

3. **Review history.** The invoice detail shows past resolutions: who (address chip), what (verdict), when, and the signed message in a drawer.

4. **No wallet, no action.** Without an approver wallet connected, the action buttons are replaced by "An approver resolves these."

**Exit check:** releasing a probable duplicate as distinct from the approver wallet creates an obligation and the review history shows the signer; the same signed payload re-sent with `curl` is rejected by the backend (nonce reuse); a customer wallet sees no action buttons.

---

## VENDORS

## Phase 21 — Payees: the vendor master

**Goal:** a list of everyone the treasury can pay, with their on-chain status, cap, screening result and track record.

**Steps**

1. **Data:** `usePayees(net)`.

2. **Columns:**

   | Column | Content |
   |---|---|
   | Payee | name, slug (`vendor:hosting`), kind (vendor/contractor/service/internal) |
   | Status | `Pending approval` (warn) · `Cooling down until Oct 9, 14:20` (info, with countdown) · `Active` (ok) · `Suspended` (bad) · `Draft` / `Screening` (muted) |
   | Pays to | address chip; for cross-chain payees, chain name + recipient address |
   | Category · token | `CONTRACTOR · USDC` |
   | Cap per payment | `Amount` or "no cap" |
   | Screening | `Clear` / `Review` / `Blocked` from the Compliance Engine result, with date |
   | Track record | on-time %, payments count, last paid |

3. **Internal payees** (`internal:yield`, `internal:fx`, `internal:spend`) appear in a separate collapsed group "Athena's own wallets", so judges see they are payees like any other and subject to the same rules.

4. **Tabs:** All · Pending approval (count, gold when the viewer is an approver) · Active · Suspended.

5. **New payee** button (admin) → `/payees/new` (Phase 23).

**Exit check:** the five house-operation vendors and three internal payees appear with statuses matching `getPayee` on-chain; a payee in cooldown shows a live countdown that flips to Active at the right time without a reload.

---

## Phase 22 — One payee

**Goal:** everything about a vendor: what the chain says, what the screening said, every address it ever had, every payment, and how reliable it has been.

**Steps**

1. **Data:** `usePayee(net, id)` (API) + `usePayeeOnchain(payeeId)` (chain) + `useObligations(net, { payee: id })`.

2. **On-chain card** — from `getPayee`, labeled "On-chain record":
   - status, `activeFrom` (with "payable now" or countdown), account, remote recipient + domain (for CCTP payees; decode the bytes32 recipient to an address by taking the last 20 bytes), category, token, per-payment cap.
   - If `getPendingPayee` returns `pending: true`, a warn card "Change waiting for approval" with old vs new (Phase 23).
   - If API and chain disagree on any field, show both and a red "Out of sync" note. The chain wins.

3. **Screening card** — Compliance Engine result, risk tier, screened date, and "Re-screen due on …". Show the raw result in a drawer for reviewers.

4. **Address history** — every address this payee has had, its source (`onboarding`, `invoice`, `admin`), when it was proposed, approved or rejected, and by whom. Rows with source `invoice` are **intercepted change requests** — show them with a shield icon and the sentence "An invoice asked to change this payee's address. Athena did not pay it; a human decided."

5. **Scorecard** — from the backend's Phase 39: on-time delivery %, disputes, average days from invoice to payment, total paid, discounts offered/captured. A small bar for each.

6. **Payments** — the payee's obligations table (Phase 16 columns) filtered to this payee.

7. **Approver actions** (Phase 23) in the header: Approve / Reject (pending), Suspend (active), Reactivate (suspended).

**Exit check:** for `contractor:base-dev`, the on-chain card shows domain 6 and the decoded Base recipient; the address history shows the seeded intercepted change with its outcome; the scorecard numbers match the backend's `vendor_scorecard` MCP tool output.

---

## Phase 23 — Approving payees, and creating them

**Goal:** a human key is the only way a payee becomes payable, and the approver can see exactly what they are approving.

**Steps**

1. **Approve / reject a pending payee** (approver):
   - Read `getPendingPayee(payeeId)` from the chain. **Show the approver the on-chain pending data**, not the API's copy — that is what the contract will activate:
     ```
     You are approving payee vendor:hosting
       Pays to        0x8f3C…19aB   on Arc
       Category       VENDOR
       Token          USDC
       Cap / payment  500.00 USDC
       Screening      Clear (Oct 2)
     After approval it becomes payable on Oct 9 at 14:20 (10-minute safety cooldown).
     ```
     The cooldown comes from `payeeCooldown()` on-chain.
   - For a **change** (`isChange` on the `PayeeProposed` event), show old vs new address with a character-level diff highlight and the source ("requested by invoice INV-0051"). Add a required checkbox: "I confirmed this change with the vendor through a channel other than the invoice." The checkbox is a UI speed bump, not a security control — the essay's vendor change control rule in words the approver sees.
   - Buttons call `approvePayee(payeeId)` or `rejectPayee(payeeId)` through `useTx` with `invalidate: [qk.payee(net, id), qk.payees(net)]`.

2. **Suspend / reactivate** (approver; admin can also suspend): `suspendPayee(payeeId)` takes effect immediately. `reactivatePayee(payeeId)` restarts the cooldown — say so in the confirmation.

3. **Create a payee** (admin, `/payees/new`, requires the admin session):
   - Fields: display name, slug (auto from name, editable, `kind:name` format), kind, category (select from `CATEGORY`), token (USDC/EURC), chain (Arc, or a CCTP destination from `addresses.destinations`), payout address, per-payment cap (`AmountInput`, optional), contact email (optional).
   - Validate the address with viem `isAddress` and show its checksummed form; refuse the zero address and the treasury's own address.
   - Submit to `POST /api/admin/payees`. The backend screens it and proposes it on-chain (its Phase 24).
   - After submit, the page becomes a status tracker for the new payee:
     ```
     ✓ Draft saved
     ● Screening with Compliance Engine…
     ○ Proposed on-chain by the agent
     ○ Waiting for an approver
     ○ Cooling down
     ○ Payable
     ```
     driven by polling `GET /payees/:id` every 3 s and the `PayeeProposed` / `PayeeApproved` events. When it reaches "Waiting for an approver", show a link the admin can send to the approver.

4. **Cap changes.** On the payee page, the admin sees "Change cap" → `setPayeeCap(payeeId, cap)` (admin can raise or lower). Note under it: "The agent can only ever lower a cap (it calls `tightenPayeeCap`). Raising one needs this admin key." This is principle A3.4 from the backend, made visible.

**Exit check:** creating a payee from the admin profile ends in "Waiting for an approver"; approving it from the approver profile shows the cooldown countdown, then Active; trying to approve from the admin profile (no approver role) is stopped at simulation with "Only the approver wallet can do this."; the change-approval checkbox blocks the button until ticked.

---
## THE AUDIT TRAIL

## Phase 24 — The decision log

**Goal:** the complete, newest-first list of everything Athena decided — including "wait" and "hold" — each with its seal state, so a reviewer can see the agent's whole history at a glance.

**Steps**

1. **Data:** `useDecisions(net, { kind, state, cursor })` (infinite), refreshed by SSE.

2. **Row (`DecisionRow`)** — one line that reads like a ledger entry:
   ```
   🔒✓  Oct 6 14:02   PAY EARLY     Northwind Hosting      404.25 USDC   2% discount, 8 days early      EXECUTED · VERIFIED
   🔒   Oct 6 14:02   SCHEDULE      Studio Ka               1,200.00 USDC  pay Oct 15 (contractor M2)      RECORDED DECISION
   🔒!  Oct 6 14:02   PAY NOW       Studio Ka               300.00 USDC   over approval limit            NEEDS HUMAN
   🔒✓  Oct 6 14:02   YIELD DEPOSIT Vault: Steakhouse USDC  2,000.00 USDC  idle 14+ days, 4.8% APY         EXECUTED · VERIFIED
   ```
   - `SealMini` shows the state: closed (sealed, not yet opened), open with check (revealed and verified), open with warning (mismatch), clock (overdue).
   - The middle text is the `summary` (Phase 7). If the API does not provide it, build it from kind + payee + amount + one key fact (discount, planned date, escalation reason, vault).
   - The **verification badge in the list** uses the server's `match` and `revealed` fields for speed, labeled "server check" in its tooltip. The full browser check runs on the detail page (Phase 26) and can be run for a whole page of rows with a "Verify all on this page" button (runs Phase 26 for each, 4 at a time).

3. **Filters:** kind (multi-select: payments, schedules/holds, yield, reserve, cross-chain, FX, services), state, "overruled by validator", "escalated", date range, payee. In the URL.

4. **Group by cycle** toggle: rows grouped under a cycle header ("Cycle 14:00 · scheduled · 7 decisions · plan by model · 1 overruled") linking to the cycle page.

5. **Kind names in plain words:**

   | Kind | Label |
   |---|---|
   | `PAY_NOW` | Pay now |
   | `PAY_EARLY` | Pay early for discount |
   | `SCHEDULE` | Schedule payment |
   | `HOLD` | Hold |
   | `YIELD_DEPOSIT` / `YIELD_REDEEM` | Move to yield / Bring back from yield |
   | `RESERVE` / `RELEASE_RESERVE` | Set aside in reserve / Release reserve |
   | `CONSOLIDATE` | Bring funds home from another chain |
   | `FX` | Buy EURC |
   | `TOP_UP_SERVICES` | Top up service credit |

6. **Export.** "Download CSV" for the current filter: decision id, time, kind, payee, token, amount (exact), state, decision hash, commit/execute/reveal tx. Built client-side from loaded pages; tell the user it covers loaded rows only, with a "Load all" button that pages to the end first.

**Exit check:** after a day of house operations, the log shows every decision of every cycle with correct states; filtering "overruled by validator" shows only rows whose record has `planner.overruled = true`; "Verify all on this page" turns every revealed row's badge to the browser-verified check.

---

## Phase 25 — One decision: the sealed record, readable

**Goal:** a reviewer reads one decision the way an auditor would — what the agent saw, the forecast, the rule, the evidence, what the model proposed, what was actually committed, and what happened on-chain.

**Steps**

1. **Data:** `useDecision(net, id)` (API: record JSON, state, txs, follow-up, reviews) + `useDecisionOnchain(id)` (chain) + the verification of Phase 26.

2. **Header:**
   - Plain-language sentence, large: "Paid Northwind Hosting 404.25 USDC, 8 days early, to capture a 2% discount."
   - State badge, the `Seal` in miniature (or the full seal on wide screens, set to the decision's state: `sealed` until revealed, `open` when verified, `broken` on mismatch).
   - Decision id `HashChip`, cycle link, time.

3. **Sections** — each maps to a part of the backend's `DecisionRecord` (28.1). Render the parsed record **from the verified bytes** (Phase 26), falling back to the API's `record_json` only while verification is loading, and say which one is shown.

   **What it saw** (`saw`)
   - Block, snapshot hash (links to the cycle), spendable, reserve.
   - Budget: category, remaining, approval limit.

   **The forecast it ran** (`forecast`)
   - Lowest stress balance, first shortfall date, runway; forecast hash.

   **The rule it applied** (`rule`)
   - Policy version.
   - The checks list, each with ✓/✗ and its detail:
     ```
     ✓ payee active and past cooldown
     ✓ within VENDOR period budget (remaining 760.00)
     ✓ under approval limit 250.00 → no, 404.25 > 250.00 → expect escalation   (if applicable)
     ✓ discount APR 37.2% beats best vault 4.8% + 2% margin
     ✓ stress-case balance stays ≥ floor after payment
     ```
   - For discount decisions, the comparison as a small formula card: "2% for paying 20 days early = 37.2% annualized vs 4.8% best vault APY."
   - `expectEscalation` → "Athena expected the contract to send this to a human: over the approval limit."

   **The evidence** (`evidence`)
   - Evidence hash and match status, linking to the obligation's evidence tab (Phase 17).

   **What the model proposed** (`planner`)
   - Mode: "Planned by model {model}" or "Planned by default policy (model unavailable)".
   - Rationale (plain text, in a quote style).
   - Alternatives considered (list).
   - If `overruled`: a warn panel "The validator overruled the model: {overruleReason}. Proposed: {proposed}. Committed: {final}." This panel is one of the most important things a judge can see — it is the "model output is an input, never the release condition" rule happening.

   **What it did** (`action`)
   - Decoded action: kind (PAY / RESERVE / RELEASE_RESERVE), obligation id, payee (name + id), token, amount (exact), max fee, evidence hash.
   - For no-op decisions: "No money moved. This decision is on the record so that waiting is auditable too."

   **Follow-up** (`followUp` + API `follow_up` status)
   - Yield deposit into vault X: pending/deposited, with tx.
   - CCTP payout: burned → attested → minted on Base, with txs (links to `/crosschain`).
   - Swap: quoted → swapped, with rate.

   **On-chain** — a compact table:
   | Step | Block | Transaction | |
   |---|---|---|---|
   | Sealed (commit) | 1,234,560 | 0x…a1 | ↗ |
   | Executed | 1,234,562 | 0x…b2 | ↗ |
   | Escalated / Approved | — | — | |
   | Opened (reveal) | 1,234,563 | 0x…c3 | ↗ |
   Plus "Money moved 2 blocks after the seal" when executed.

4. **Raw record drawer.** The canonical JSON (pretty-printed for reading, with a note that the hashed form is the compact canonical bytes), a "Copy canonical bytes" button (hex), and "Download record.json" (the exact canonical bytes as a file, so a reviewer can hash it with `sha256sum`).

5. **Reviews** (Phase 30) at the bottom.

**Exit check:** for a seeded `PAY_EARLY` decision, every section renders from the verified bytes; for a seeded overruled decision, the overrule panel shows both the proposed and the committed values; downloading `record.json` and running `sha256sum record.json` gives the same hash shown as the on-chain decision hash.

---

## Phase 26 — Verification in the browser

**Goal:** the page proves, using only the browser and Arc, that the record shown is exactly what was sealed before the money moved — and says plainly when it is not.

**Steps**

1. **`src/lib/verify/sha256.ts`:**
   ```ts
   import { bytesToHex, hexToBytes, type Hex } from "viem";
   export async function sha256Hex(bytes: Uint8Array): Promise<Hex> {
     const d = await crypto.subtle.digest("SHA-256", bytes);
     return bytesToHex(new Uint8Array(d));
   }
   ```
   `crypto.subtle` exists only in secure contexts (HTTPS or `localhost`). In any other context, show "Verification needs HTTPS" rather than a broken badge.

2. **Find the published bytes on-chain.** `src/lib/verify/revealLog.ts`:
   ```ts
   import { parseEventLogs, type PublicClient, type Hex } from "viem";

   export async function findRevealBytes(client: PublicClient, treasury: Hex, decisionId: Hex,
                                         hint: { revealTx?: Hex | null; resolvedBlock?: bigint; deadlineBlocks?: bigint }) {
     // Fast path: the API told us which transaction revealed it. We still read it from the chain ourselves.
     if (hint.revealTx) {
       const r = await client.getTransactionReceipt({ hash: hint.revealTx });
       const logs = parseEventLogs({ abi: treasuryAbi, logs: r.logs, eventName: "DecisionRevealed" })
         .filter((l) => l.address.toLowerCase() === treasury.toLowerCase() && l.args.decisionId === decisionId);
       if (logs[0]) return { bytes: logs[0].args.preimage as Hex, block: r.blockNumber, tx: hint.revealTx };
     }
     // Trustless path: scan the window in which the reveal must have happened.
     const from = hint.resolvedBlock ?? 0n;
     const to = from + (hint.deadlineBlocks ?? 7200n) + 100n;
     const CHUNK = 2000n;                                  // ⚠️ VERIFY the RPC's max log range; lower if it refuses
     for (let start = from; start <= to; start += CHUNK) {
       const end = start + CHUNK - 1n > to ? to : start + CHUNK - 1n;
       const logs = await client.getContractEvents({ address: treasury, abi: treasuryAbi, eventName: "DecisionRevealed",
                                                     args: { decisionId }, fromBlock: start, toBlock: end });
       if (logs[0]) return { bytes: logs[0].args.preimage as Hex, block: logs[0].blockNumber!, tx: logs[0].transactionHash! };
     }
     return null;
   }
   ```
   `decisionId` is an indexed event argument, so the filter is efficient.

3. **The checks.** `src/lib/verify/verifyDecision.ts`:
   ```ts
   export type Check = { key: string; label: string; ok: boolean | null; detail: string };
   export type Verdict = "verified" | "sealed_only" | "mismatch" | "unverifiable";

   export async function verifyDecision(p: {
     client: PublicClient; treasury: Hex; chainId: number; decisionId: Hex;
     apiBytes?: Hex | null; revealTx?: Hex | null; executeTx?: Hex | null;
   }): Promise<{ verdict: Verdict; checks: Check[]; record: DecisionRecord | null; bytes: Hex | null }> {
     const checks: Check[] = [];
     const d = await p.client.readContract({ address: p.treasury, abi: treasuryAbi, functionName: "getDecision", args: [p.decisionId] });
     if (d.state === 0) return { verdict: "unverifiable", checks: [{ key: "exists", label: "Decision exists on-chain", ok: false, detail: "No decision with this id on this treasury." }], record: null, bytes: null };
     checks.push({ key: "exists", label: "Sealed on-chain", ok: true, detail: `Committed at block ${d.committedBlock}` });

     if (!d.revealed) {
       const deadline = await p.client.readContract({ address: p.treasury, abi: treasuryAbi, functionName: "revealDeadlineBlocks" });
       return { verdict: "sealed_only", record: null, bytes: null, checks: [...checks,
         { key: "revealed", label: "Record published", ok: null,
           detail: d.flaggedOverdue ? "Overdue: the contract has frozen the agent until it is published."
                                    : `Not yet. Must be published within ${deadline} blocks of resolution.` }] };
     }

     const deadlineBlocks = await p.client.readContract({ address: p.treasury, abi: treasuryAbi, functionName: "revealDeadlineBlocks" });
     const found = await findRevealBytes(p.client, p.treasury, p.decisionId,
                                         { revealTx: p.revealTx, resolvedBlock: d.resolvedBlock || d.committedBlock, deadlineBlocks });
     if (!found) return { verdict: "unverifiable", record: null, bytes: null,
                          checks: [...checks, { key: "revealLog", label: "Published record found on-chain", ok: false, detail: "Could not find the reveal event. Try again or check the RPC." }] };
     checks.push({ key: "revealLog", label: "Published record found on-chain", ok: true, detail: `Block ${found.block}, tx ${short(found.tx)}` });

     const bytes = hexToBytes(found.bytes);
     const digest = await sha256Hex(bytes);
     checks.push({ key: "hash", label: "Record matches the seal", ok: digest === d.decisionHash,
                   detail: `sha256(record) = ${short(digest)} · sealed hash = ${short(d.decisionHash)}` });

     if (p.apiBytes) checks.push({ key: "api", label: "Athena's API serves the same record", ok: p.apiBytes.toLowerCase() === found.bytes.toLowerCase(),
                                   detail: "Compared byte for byte with the on-chain copy." });

     let record: DecisionRecord | null = null;
     try { record = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
     catch { checks.push({ key: "parse", label: "Record is valid UTF-8 JSON", ok: false, detail: "The published bytes are not valid JSON." }); }

     if (record) {
       checks.push({ key: "binding", label: "Record names this decision and treasury", ok:
         record.decisionId?.toLowerCase() === p.decisionId.toLowerCase() &&
         record.treasury?.toLowerCase() === p.treasury.toLowerCase() && record.chainId === p.chainId,
         detail: `decisionId, treasury and chainId inside the record` });

       const expected = record.action ? actionHash(toChainAction(record.action)) : NO_ACTION;
       checks.push({ key: "action", label: "Action in the record is the action that was sealed", ok: expected === d.actionHash,
                     detail: `keccak256(abi.encode(action)) = ${short(expected)} · sealed = ${short(d.actionHash)}` });

       if (record.action && (d.state === 2 || d.state === 4) && p.executeTx) {
         const r = await p.client.getTransactionReceipt({ hash: p.executeTx });
         const ex = parseEventLogs({ abi: treasuryAbi, logs: r.logs, eventName: "DecisionExecuted" })
           .find((l) => l.args.decisionId === p.decisionId);
         const a = toChainAction(record.action);
         const same = !!ex && ex.args.amount === a.amount && ex.args.token.toLowerCase() === a.token.toLowerCase()
                      && ex.args.payeeId === a.payeeId && ex.args.obligationId === a.obligationId && ex.args.evidenceHash === a.evidenceHash;
         checks.push({ key: "executed", label: "Money moved exactly as recorded", ok: same,
                       detail: ex ? `Executed at block ${r.blockNumber}, ${r.blockNumber - d.committedBlock} block(s) after the seal` : "No execution event found in that transaction." });
       }

       const recanon = canonicalize(record);       // RFC 8785, the same library the backend uses
       checks.push({ key: "canonical", label: "Record is in canonical form", ok: recanon === new TextDecoder().decode(bytes),
                     detail: "Re-serializing the record gives identical bytes, so there is only one way to write it." });
     }

     const failed = checks.some((c) => c.ok === false);
     return { verdict: failed ? "mismatch" : "verified", checks, record, bytes: found.bytes };
   }
   ```
   - `toChainAction` converts the record's string amounts to `bigint` and null hashes to `zeroHash`; import `actionHash`, `NO_ACTION` from `@athena/shared/action` — the same function the backend used, which the backend's parity test proved equals Solidity's `hashAction`.
   - `canonicalize` is the RFC 8785 package the backend's `canonical.ts` uses; it is pure JavaScript and runs in the browser. Pin the same version.
   - The "Money moved" check needs the execution transaction. For approved escalations, the executing transaction is the approver's `approveEscalation` tx; the API returns it as `executeTx` or as the escalation's `resolved_tx` — use whichever is set.

4. **`VerifyPanel`** — the component on every decision page:
   ```
   ┌─ Verified in your browser ───────────────────────── 🔓✓ ─┐
   │ ✓ Sealed on-chain                     block 1,234,560     │
   │ ✓ Published record found on-chain     block 1,234,563     │
   │ ✓ Record matches the seal             sha256 0x77…02      │
   │ ✓ Athena's API serves the same record                     │
   │ ✓ Record names this decision and treasury                 │
   │ ✓ Action in the record is the action that was sealed      │
   │ ✓ Money moved exactly as recorded     2 blocks after seal │
   │ ✓ Record is in canonical form                             │
   │ Read from Arc via rpc.testnet.arc.io · 0.4 s · [Re-run]   │
   └───────────────────────────────────────────────────────────┘
   ```
   - Runs automatically on open; re-runs on `decision.revealed` for this id.
   - Each check expands to its detail. A ✗ shows the two values side by side.
   - The footer names the RPC used, so the viewer knows the answer did not come from Athena's API.
   - Verdict drives the seal state: `verified` → open; `sealed_only` → sealed (with the deadline text); `mismatch` → broken; `unverifiable` → sealed with a muted "Couldn't check right now".

5. **Tests.** `tests/verify.test.ts` with fixtures from a real testnet decision (record bytes, hashes, a fake client returning the logs): passes; flipping one byte of the record fails "Record matches the seal"; changing the amount in the record fails "Action in the record is the action that was sealed"; a decision with `revealed=false` returns `sealed_only`.

**Exit check:** for ten random revealed decisions, the panel shows all ✓; on a decision tampered in the test fixture, the panel shows ✗ on the right check and the seal turns broken; blocking requests to the Athena API in devtools and reloading `/verify?id=…` (Phase 27) still verifies from the chain alone.

---

## Phase 27 — The public verifier

**Goal:** anyone — a judge, a vendor, another agent's developer — can paste a decision id or a transaction hash and check it against Arc without trusting Athena's server.

**Steps**

1. **Page:** `/verify` with one large input and a network switch. Accepts `?id=` or `?tx=` so links work.

2. **Input handling:**
   - 32-byte hex → treated as a decision id.
   - 32-byte hex that is also a transaction hash on the selected network (`getTransactionReceipt` succeeds) → treated as a tx: parse the receipt's logs with the treasury ABI; collect every `decisionId` from `DecisionCommitted`, `DecisionExecuted`, `DecisionEscalated`, `EscalationApproved`, `DecisionRevealed`; if one, verify it; if several (a cycle's commits can share a block but not a tx — still handle it), list them to pick.
   - Anything else → "That isn't a decision id or a transaction hash."

3. **"Don't use Athena's API" toggle**, on by default on this page. When on, the page:
   - reads everything from the chain (Phase 26's trustless path, no `apiBytes`, no `revealTx` hint, no `executeTx` hint — it finds the execution in `DecisionExecuted` logs between `committedBlock` and `resolvedBlock` the same way it finds the reveal);
   - renders the record from the on-chain bytes only;
   - shows "No request was made to Athena's servers" with the list of RPC calls made (method and block range), so a skeptic can see it.

4. **Result:** the `VerifyPanel`, then the record rendered with the Phase 25 sections, then a "Verify it yourself" box with a 15-line script anyone can run:
   ```bash
   # needs: node 20+, npm i viem
   node verify.mjs <treasury> <decisionId> https://rpc.testnet.arc.io
   ```
   ```js
   // verify.mjs
   import { createPublicClient, http, parseAbi, hexToBytes } from "viem";
   import { createHash } from "node:crypto";
   const [treasury, id, rpc] = process.argv.slice(2);
   const abi = parseAbi([
     "function getDecision(bytes32) view returns ((bytes32 decisionHash, bytes32 actionHash, uint64 committedBlock, uint64 resolvedBlock, uint8 state, bool revealed, bool flaggedOverdue))",
     "event DecisionRevealed(bytes32 indexed decisionId, bytes preimage)",
   ]);
   const c = createPublicClient({ transport: http(rpc) });
   const d = await c.readContract({ address: treasury, abi, functionName: "getDecision", args: [id] });
   const from = d.resolvedBlock || d.committedBlock;
   const logs = await c.getContractEvents({ address: treasury, abi, eventName: "DecisionRevealed", args: { decisionId: id }, fromBlock: from, toBlock: from + 7300n });
   const bytes = hexToBytes(logs[0].args.preimage);
   const h = "0x" + createHash("sha256").update(bytes).digest("hex");
   console.log(h === d.decisionHash ? "MATCH" : "MISMATCH", h, d.decisionHash);
   console.log(new TextDecoder().decode(bytes));
   ```
   ⚠️ Generate the `getDecision` signature in this snippet from the deployed ABI so the tuple order is exactly the contract's `Decision` struct; a wrong field order decodes garbage.

5. **Share.** A "Copy link" button produces `/verify?net=testnet&id=0x…`. The OG image for this route (dynamic `opengraph-image`) shows the verdict and decision summary, so a link pasted in Discord previews as "✓ Verified — Paid Northwind 404.25 USDC".

**Exit check:** pasting the commit transaction hash of a seeded decision finds the decision and verifies it; with the API blocked in devtools and the toggle on, verification still passes and the RPC call list shows only Arc calls; the snippet run from a terminal prints `MATCH` for the same decision.

---

## THE HUMAN LOOP

## Phase 28 — The escalation inbox

**Goal:** when the contract sends something to a human, the approver sees it immediately, understands why in one line, and knows how long they have.

**Steps**

1. **Data:** `useEscalations(net, { status: "pending" })` + SSE `decision.escalated` / `escalation.resolved`.

2. **Card per pending escalation:**
   ```
   ┌─ OVER THE APPROVAL LIMIT ──────────────────────────────── expires in 21h 14m ─┐
   │ Studio Ka (contractor) · 300.00 USDC · milestone M2 accepted Oct 5             │
   │ Athena: "Milestone accepted and due Oct 8. Paying on time keeps the contractor  │
   │ relationship; the stress balance stays above the floor after payment."          │
   │ Limit for one CONTRACTOR payment: 250.00 USDC                                  │
   │                                                       [Review and decide →]    │
   └─────────────────────────────────────────────────────────────────────────────────┘
   ```
   - The headline is the escalation reason from `ESCALATION_REASON` (Phase 6).
   - The limit line states the exact policy number that was crossed — budget remaining, approval limit, payee cap, or floor — taken from the decision record's `saw.budget` and `rule` sections.
   - Expiry uses `Countdown` against `expiresAt` read **from the chain** (`getEscalation`), not the API's copy.

3. **Tabs:** Pending (default) · Approved · Rejected · Expired. Resolved items show who decided (address chip), when, and the transaction.

4. **Agreement stat** at the top: "Approvers agreed with Athena on 9 of 11 escalations (82%)" — the escalation-agreement metric (backend 30.5) from `/metrics`.

5. **Browser notification** (opt-in). A button "Notify me in this browser" asks for `Notification` permission; when granted and the viewer is an approver, a `decision.escalated` SSE event shows a system notification linking to the escalation. Telegram (backend 30.2) remains the primary channel; this is a convenience.

**Exit check:** the seeded 300 USDC contractor payment appears within a second of `DecisionEscalated`; the countdown matches `expiresAt` on-chain; an approved escalation moves to the Approved tab with the approver's address.

---

## Phase 29 — Deciding an escalation with your own wallet

**Goal:** the approver sees exactly what they are signing, checks it against the seal, and approves or rejects it in one transaction from their own wallet.

**Steps**

1. **Page:** `/escalations/[decisionId]`. Two columns on desktop: **context** (left), **decision** (right, sticky).

2. **Context column:**
   - The decision record (Phase 25 sections, compact), already revealed at escalation time — with the `VerifyPanel`.
   - **Impact if approved** — computed in the browser from fresh reads, labeled "estimate":
     - Budget: `remaining (getBudget) − amount` → "VENDOR budget left this period: 760.00 → 460.00".
     - Floor: `freeOperating − amount` vs `minOperating` → "Free balance after payment: 3,100.00 (floor 2,000.00)". If it would go under the floor, say so in red; the contract will still let the approver approve a floor escalation, but they should know.
     - Forecast: "Lowest stress balance in the next 30 days drops from 2,140.00 to 1,840.00" (subtract the amount from the forecast's stress minimum if the payment was not already in the forecast on this date; otherwise say "already planned in the forecast").
   - **Payee** card with status, screening, scorecard, and the last five payments.
   - **Evidence** summary with the match table.

3. **Decision column — "What you're signing":**
   - Read `getEscalation(decisionId).action` from the chain.
   - Show it decoded: pay `{payee name}` (`{payeeId}`) `{amount exact}` `{token}` for obligation `{obligationId}`, evidence `{evidenceHash}`, max fee `{maxFee}`.
   - Recompute `actionHash(action)` in the browser and compare with `getDecision(decisionId).actionHash`. Show ✓ "This is exactly the action Athena sealed before asking you." If it differs (it cannot, unless the contract is broken), disable Approve.
   - Show the payee's on-chain account (or remote recipient + chain) next to it — the address the money will actually go to.
   - Expiry countdown.

4. **Buttons:**
   - **Approve** → `useTx().send({ functionName: "approveEscalation", args: [decisionId], label: "Approve escalation", invalidate: [...] })`.
   - **Reject** → `rejectEscalation(decisionId)`. Rejection opens a short optional note field; the note is sent afterwards as a decision review (Phase 30) with verdict `disagree`, so the reason is attributable.
   - Both go through simulation first. Expected refusals and their messages (C2): `EscalationExpired`, `BadDecisionState` (already decided by someone else), `EnforcedPause` (treasury paused — approvals are blocked while paused), `PayeeNotActive` / `PayeeCoolingDown` (payee changed since), `InsufficientFunds`, `AlreadySettled`.
   - The approver's wallet pays the gas (USDC on Arc). If the wallet has none, the simulation passes but signing fails; the tx hook's "no gas" message covers it.

5. **After approval:**
   - The page switches to a result view: "Approved by 0xA1…9F. Paid Studio Ka 300.00 USDC in tx 0x…". Read the `DecisionExecuted` / `EscalationApproved` logs from the receipt to confirm.
   - For a cross-chain payee, add the CCTP tracker (Phase 34): "Burned on Arc → waiting for attestation → minted on Base".
   - The backend picks up the event, marks the obligation paid, and runs a follow-up cycle (backend 37.2 trigger `escalation_resolved`).

6. **Approve from a phone.** The page must work in a mobile wallet's in-app browser (WalletConnect or the wallet's own browser), because the approver will often get the Telegram message on their phone. Test it on one.

**Exit check:** approving the seeded 300 USDC escalation from the approver profile pays the contractor and the page shows the transaction; trying again shows "Someone already decided this escalation." at simulation; with the treasury paused, Approve is refused with the pause message before the wallet opens; the "What you're signing" hash check shows ✓.

---

## Phase 30 — Reviewing Athena's decisions

**Goal:** a human can mark any revealed decision *agree* or *disagree*, signed, so "human agreement" is a measured number rather than a claim.

**Steps**

1. **Where:** at the bottom of every decision page, and as a quick action in the decision log (approver only).

2. **Flow:** two buttons — **Agree** and **Disagree** — and an optional note (max 500 characters).
   - Sign with `useSignedAction()("decision_review", decisionId, verdict)`.
   - `POST /decisions/:id/review` with `{ address, message, signature, nonce, issuedAt, verdict, note }`.
   - The note is **not** part of the signed message (only action, target and verdict are). Label it so: "Your note is stored with your signed verdict but is not itself signed."
   - One review per reviewer per decision (the table has a unique constraint). A second attempt shows the existing review instead of the buttons.

3. **Display:** reviews listed with address chip, verdict badge, note (plain text), time, and a drawer showing the signed message and signature. A small summary: "2 reviewers agree, 0 disagree".

4. **Review mode.** On the decision log, an approver can turn on "Review mode": rows show Agree/Disagree buttons inline, and each signature is one click. This is how the team builds an honest agreement number over the event window — review a sample of decisions every day, including ones you disagree with.

5. **Metric.** `/traction` (Phase 41) shows decision agreement and the number of reviews, so the figure has a visible denominator.

**Exit check:** an approver review appears on the decision within a second; replaying the same signature is rejected; the decision-agreement metric on `/traction` moves after the next metrics snapshot.

---
## WATCHING THE AGENT WORK

## Phase 31 — Cycles

**Goal:** every run of the treasury loop is inspectable: what triggered it, how long each step took, what the model planned, what the validator changed, and which decisions came out.

**Steps**

1. **List** (`/cycles`): time, trigger (`schedule`, `invoice`, `payment_in`, `escalation_resolved`, `manual`, `dry_run`), status (`running`, `done`, `failed`, `skipped` + reason), duration, decisions committed, planner mode (model / default policy), overrules count. Dry runs get a `DRY RUN` tag and are excluded from counts on other pages.

2. **Detail** (`/cycles/[cycleId]`):

   **Steps timeline** from `validation.steps[]` (backend 37.1 `step()`), grouped into the stages a person understands:

   | Stage shown | Backend steps | One-line explanation |
   |---|---|---|
   | Catch up | `recover`, `sync` | Finish anything half-done from last time; read new events from Arc |
   | Read the inbox | `ingest`, `validate`, `screen`, `subscriptions` | Extract new invoices, check them, re-screen payees, turn due subscriptions into bills |
   | Look | `snapshot` | Take one pinned picture of every balance |
   | Forecast | `forecast` | Project 30 days, base and stress |
   | Plan | `policy`, `plan` | Work out the options; the model chooses among them |
   | Check | `validate_plan` | Code checks every item; anything infeasible is replaced |
   | Seal | `commit` | Hash every decision onto Arc before acting |
   | Act | `execute` | The contract re-checks and pays, or escalates |
   | Open | `reveal` | Publish every record; the contract verifies each |
   | After | `followups`, `collections`, `metrics` | Vault deposits, CCTP mints, swaps, reminders, numbers |

   Each stage shows its duration and status; expand to see the raw steps. A failed step shows the error string from the cycle row.

   **Inputs** tab: snapshot (rendered like the overview, plus hash), forecast (chart from Phase 14 for that cycle), policy facts (per obligation: allowed options, default choice, discount APR, criticality) as a table.

   **Plan** tab: the model's plan (summary, per-obligation choices with rationales, yield/reserve/consolidate/FX/services items, human notes). The `humanNotes` array — "things a human should look at" — gets its own highlighted box; it is the agent volunteering concerns.

   **Validation** tab: every `ValidatedItem` (backend 27.2): proposed vs final, overruled flag and reason, checks. Overruled items first.

   **Decisions** tab: the cycle's decisions as `DecisionRow`s.

3. **Diff with the previous cycle.** A small "What changed since the last cycle" list: new obligations, status changes, balance delta, new escalations. This is what makes a 15-minute schedule readable.

**Exit check:** a seeded cycle shows all ten stages with durations; the Validation tab of a cycle with an injected bad plan item (backend Phase 27 exit check) shows it overruled with the reason; a skipped cycle (paused treasury) says "skipped: treasury paused".

---

## Phase 32 — The live view

**Goal:** the screen to leave open on a second monitor and the one the demo video is built around — Athena working, one stage and one seal at a time, with real data.

**Steps**

1. **Layout (desktop):**
   ```
   ┌─────────────────────────────── LIVE · TESTNET · next cycle in 6:12 ───────────────────────────────┐
   │                                                                                                    │
   │      ┌──────────────┐     Catch up ✓ · Read inbox ✓ · Look ✓ · Forecast ✓ · Plan ● · Check ○ ·     │
   │      │              │     Seal ○ · Act ○ · Open ○ · After ○                                        │
   │      │   THE SEAL   │                                                                              │
   │      │   (3D, big)  │     ┌ Decision stream ─────────────────────────────────────────────────┐    │
   │      │              │     │ 🔒 PAY EARLY  Northwind  404.25 USDC   sealed  → executed → 🔓✓   │    │
   │      └──────────────┘     │ 🔒 SCHEDULE   Studio Ka  1,200.00      sealed  → recorded → 🔓✓   │    │
   │                           │ 🔒 PAY NOW    Studio Ka  300.00        sealed  → NEEDS HUMAN      │    │
   │   Spendable 18,420.55     └──────────────────────────────────────────────────────────────────┘    │
   │   Runway 47 days                                                                                   │
   │                           ┌ What Athena is thinking ─────────────────────────────────────────┐    │
   │                           │ "Northwind offers 2/10. Paying today is a 37% annualized return,   │    │
   │                           │  far above the 4.8% vault. Stress balance stays above the floor."   │    │
   │                           └──────────────────────────────────────────────────────────────────┘    │
   │  ─────────────────────── activity ticker (SSE, plain language) ──────────────────────────────────  │
   └────────────────────────────────────────────────────────────────────────────────────────────────────┘
   ```

2. **Driving it.** Everything comes from SSE (`cycle.step`, `decision.*`) plus refetches of the current cycle. State machine:
   - `waiting` — no cycle running. Seal `idle`. Show "Next scheduled cycle in mm:ss" (from `CYCLE_CRON` cadence and `lastCycleAt`; ask the backend to include `nextCycleAt` in `/health` so the countdown is exact).
   - `running` — stages light up as `cycle.step` events arrive.
   - When `commit` starts, each `decision.committed` adds a card to the stream and plays `sealing` on the big seal.
   - `decision.executed` / `decision.escalated` update the card.
   - `decision.revealed` plays `cracking → open` on the big seal, runs the Phase 26 verification for that decision in the background, and flips the card to 🔓✓ when it passes.
   - When the cycle finishes, hold the final state for 10 seconds, then return to `waiting` while keeping the last cycle's cards visible.

3. **Pacing.** Arc is fast; a cycle's commits, executions and reveals can land within a few seconds. Queue the visual events and play them at a minimum of 700 ms each, so a viewer can follow, while the data underneath is already final. Show real timestamps on each card so nothing is faked: "sealed 14:02:11.3 · executed 14:02:12.0 · opened 14:02:12.9".

4. **"What Athena is thinking."** Shows the rationale of the decision currently animating, from its record. It is the planner's own text — label it "Athena's reasoning, from the sealed record".

5. **Replay.** When no cycle is running, a **Replay the last cycle** button plays the last completed cycle's steps and decisions through the same queue, compressed to ~30 seconds, labeled `REPLAY` with the original times. This is what a judge sees if they open the page between cycles.

6. **Run now (admin).** Inside `<RoleGate need="admin">`: **Run a cycle now** and **Dry run** buttons calling the admin proxy (Phase 9.3). A dry run animates through Seal with a `DRY RUN — nothing sent` watermark and stops before Act.

7. **Full-screen mode.** A button hides the sidebar and header (Fullscreen API), for recording and for a demo booth.

**Exit check:** with the page open, running a manual cycle on the backend animates every stage and every decision, each card ending 🔓✓ after browser verification; between cycles, Replay plays the last cycle with its original timestamps; a dry run never shows Act or Open.

---

## MOVING MONEY WELL

## Phase 33 — Yield

**Goal:** show the vaults Athena considered, which one it chose and why, what is deposited, what it has earned, and that cash comes back before it is needed.

**Steps**

1. **Data:** `useYieldVaults(net)` (candidates with the agent's scores), `useYieldPositions(net)`, decisions with kind `YIELD_DEPOSIT` / `YIELD_REDEEM`.

2. **Positions card:** per vault — name, address chip, principal, current value, earned (value − principal), APY at deposit vs now, deposited since. Label testnet yield `TESTNET — not real return`.

3. **Vaults considered** table — the decision space the planner chose from (Earn Kit returns vaults without ranking them; the ranking is Athena's):

   | Vault | APY now | 7d / 30d APY | Liquidity | Risk signals | Circle-guarded | Athena's score | |
   |---|---|---|---|---|---|---|---|
   | Steakhouse USDC | 4.8% | 4.6% / 4.9% | deep | none | ✓ | 0.82 | **chosen** |
   | … | | | | | | | |

   Column meanings in tooltips (from the backend's Phase 31 scoring). Show the scoring formula in a collapsible "How Athena scores vaults" box, copied from the backend's definition so the two never disagree.

4. **Why this vault.** The latest `YIELD_DEPOSIT` decision's rationale and its `alternativesConsidered`, with a link to the decision.

5. **Liquidity guard.** "Cash in yield that the forecast needs within 14 days: 0.00" — derived from the forecast and positions; if it is above zero, show which upcoming payments will trigger a redeem. This shows yield never fights the payables.

6. **USYC (optional).** If the backend reports USYC enabled (its 31.6), show a separate row "USYC (tokenized T-bills) — permissioned" with the position; otherwise a short note "USYC is permissioned and not enabled for this treasury."

**Exit check:** after a seeded deposit, the position shows principal and value from the API, the chosen vault is marked in the candidates table, and its row links to the deposit decision.

---

## Phase 34 — Cross-chain: CCTP payouts and Gateway

**Goal:** make Circle's cross-chain tools visible and traceable: a vendor paid natively on Base from an Arc treasury, and funds on other chains pulled home through Gateway.

**Steps**

1. **Data:** `useCrosschain(net)` → rows of `cross_chain_transfers` (direction `cctp_out` or `gateway_in`, domains, amount, burn tx, attestation status, mint tx, status).

2. **Domain names and explorers.** Map CCTP domains to names (26 Arc, 6 Base, 0 Ethereum, …) and explorers in one place. Add an `explorer` field to each entry under `destinations` in `addresses.json` (Base Sepolia: `https://sepolia.basescan.org`) so mint transactions link correctly. ⚠️ VERIFY the explorer URL for each destination you use.

3. **CCTP payout card** per transfer, with a stage `Timeline`:
   ```
   Studio Ka (Base) · 1,200.00 USDC · fee ≤ 0.30
   ● Burned on Arc            tx 0x…  (explorer.testnet.arc.io)
   ● Attested by Circle       14 s
   ● Minted on Base Sepolia   tx 0x…  (sepolia.basescan.org)
   ```
   - Live updates from SSE `crosschain.stage`.
   - Show `maxFee` (from the action) and the actual fee if the backend records it.
   - Link to the decision that paid it, and to the payee.

4. **Gateway consolidation card** per `gateway_in` transfer: from domain → Arc, amount, status, txs.

5. **Unified balance** summary at the top (same data as the overview's Gateway section) with a one-line explanation: "USDC the business holds on other chains, visible as one balance through Circle Gateway and brought to Arc when the agent decides it is needed."

6. **Stuck transfers.** A transfer `burned` for more than 30 minutes shows a warn note "Waiting longer than usual for attestation". The backend's relayer retries; the page just tells the truth.

**Exit check:** the seeded Base contractor payment shows all three stages with working links on both explorers; a consolidation shows its source domain and the arrival on Arc.

---

## Phase 35 — Paying in euros (EURC)

**Goal:** show how Athena handles euro invoices: what it needs in EURC, when it bought it, and at what rate.

**Steps**

1. **Data:** overview EURC balances, obligations with `token = EURC`, decisions with kind `FX` and their follow-up swap status.

2. **EURC need** card: upcoming EURC obligations (next 30 days) total vs EURC on hand → "Need 180.00 EURC more by Oct 20".

3. **Swaps** table: time, USDC in, EURC out, effective rate, reference rate, deviation (bps), status (`quoted`, `swapped`, `refused`), decision link. A refused swap shows why: "Quote was 74 bps worse than reference; limit is 50 bps." (`FX_MAX_DEVIATION_BPS` from the backend).

4. **Explainer line:** "Euro invoices are paid in EURC. Athena buys EURC with Circle's App Kit swap only when a euro bill is coming and the quote is within tolerance — and seals that decision like any payment."

**Exit check:** the seeded translation vendor's EURC invoice appears as a need; after the FX decision executes, the swap row shows both amounts and the rate; the EURC balance on the overview rises by the swapped amount.

---

## ACCOUNTS RECEIVABLE

## Phase 36 — Receivables

**Goal:** everything the business is owed, who is late, what Athena did about it, and every payment matched to an invoice on-chain.

**Steps**

1. **Data:** `useReceivables(net)`, `useReceivable(net, id)` + `useReceivableOnchain(id)`.

2. **List columns:** invoice number, customer, amount due, paid, outstanding, due label, status (`open`, `partial`, `paid`, `written_off`), dunning stage ("Reminder 2 of 4 sent Oct 12"), pay link copy button.

3. **Summary:** total outstanding per token, overdue total, DSO (days sales outstanding) from `/metrics`, "collected this week".

4. **Detail page:**
   - Header: customer, amount, status, due label, receivable id `HashChip`, register tx.
   - **On-chain record** from `getReceivable`: token, customer address (or "anyone may pay"), amount due, amount paid. If the API and the chain disagree on paid amount, show both; the chain wins.
   - **Payments:** `ReceivablePaid` events for this id (from the API's chain mirror, linked to txs), each with payer, amount, running total.
   - **Collections ladder:** the dunning stages from the backend's 35.4 as a `Timeline` — issued, reminder 1, reminder 2, escalated tone, final notice — with sent times and the next scheduled reminder. Show the customer's history ("usually pays 3 days late") that shaped the schedule.
   - **Ways to pay:** the wallet pay page link (`/pay/<id>`) with a QR code (generated client-side as an SVG; a tiny dependency such as `qrcode` is fine), and the agent-payable x402 link (`${apiBase}/pay/<id>`).
   - **Invoice PDF:** download button (signed URL, like vendor documents).
   - **Unattributed inflows:** if the treasury received money that did not come through `payReceivable` (backend's `unattributed_inflows`), list them on the receivables page in a warn card: "Money arrived without naming an invoice. Athena does not guess which invoice it pays." — the Omission defense, visible.

**Exit check:** the three seeded customers' receivables show the right statuses (early, on time, late); the late one shows reminders sent; a payment made on the pay page (Phase 38) appears in Payments within seconds of `ReceivablePaid`.

---

## Phase 37 — Issuing an invoice (admin)

**Goal:** the admin bills a customer from the browser; Athena registers the receivable on-chain and emails the invoice with both pay links.

**Steps**

1. **Page:** `/receivables/new`, admin session required.

2. **Form:**
   - Customer: select existing or "New customer" (name, email, optional wallet).
   - Invoice number: suggested next number, editable; must be unique (the receivable id is derived from it — backend's `receivableId(treasury, invoiceNumber)`).
   - Token: USDC or EURC.
   - Lines: description, quantity, unit price (`AmountInput`); total computed with `bigint` arithmetic and shown exactly.
   - Due date.
   - **Who may pay:** "Only this customer's wallet" (sets `customer` to their address) or "Anyone with the link" (sets `customer` to zero; needed for x402 and for customers who pay from a different wallet). Explain both in one line each.

3. **Submit** → `POST /api/admin/receivables`. Then a status tracker: saved → customer screened → registered on-chain (`ReceivableRegistered`, with tx) → emailed. Driven by polling the receivable and SSE.

4. **Preview.** Before submit, render the invoice as the customer will see it (same component as the pay page header), so the admin catches a typo before it is on-chain.

**Exit check:** issuing a 25.00 USDC invoice to a seeded customer registers it on-chain (visible with `getReceivable`) and the tracker shows the register transaction; trying to reuse an invoice number is refused with a clear message.

---

## Phase 38 — The customer pay page

**Goal:** a customer who has never heard of Athena opens a link, sees what they owe, and pays it from their wallet in two signatures — and the payment lands against the right invoice on-chain.

**Steps**

1. **Standalone layout.** `/pay/[receivableId]` uses its own minimal layout: the business name, "Invoice INV-2026-014", and a small "Powered by Athena on Arc" footer. No sidebar, no console navigation. The network comes from `?net=` (the email links include it).

2. **Data:**
   - `useReceivable(net, id)` from the API for the human details (business name, lines, due date) — public read.
   - `getReceivable(id)` from the chain for the numbers that matter (token, customer, due, paid). **The amount the customer pays is computed from the chain**, never from the API.
   - If the API is down, the page still works from chain data alone and shows "Invoice details unavailable; amount due is read from Arc."

3. **Invoice summary:**
   ```
   ATHENA LABS
   Invoice INV-2026-014 · due Oct 20
   Design review — 2 hours ........ 50.00 USDC
   ──────────────────────────────────────────
   Total ........................... 50.00 USDC
   Paid ............................  0.00 USDC
   Outstanding ..................... 50.00 USDC
   ```

4. **Pay flow** — a 4-step tracker with exactly one primary button at a time:

   | Step | What happens | Button |
   |---|---|---|
   | 1. Connect | wallet connect (Phase 5) | Connect wallet |
   | 2. Network | switch to Arc (adds the chain if needed) | Switch to Arc |
   | 3. Allow | `approve(treasury, amount)` on the token — **exact amount**, never unlimited; skipped if `allowance ≥ amount` | Allow 50.00 USDC |
   | 4. Pay | `payReceivable(receivableId, amount)` on the treasury | Pay 50.00 USDC |

   Before step 3, check and explain:
   - **Wrong payer:** if `customer ≠ 0x0` and the connected address is different → "This invoice can only be paid from 0x12…ab. Switch accounts in your wallet." (prevents a `NotCustomer` revert).
   - **Balance:** ERC-20 balance of the token ≥ amount; otherwise "You have 12.00 USDC on Arc; this invoice needs 50.00." with help links (testnet: Circle faucet; mainnet: "move USDC to Arc" guidance).
   - **Gas:** native balance > a small threshold (e.g. 0.05 USDC, read with 18 decimals); otherwise "You need a little USDC on Arc to pay network fees." On Arc, fees are paid in USDC — say so; many customers will expect ETH.
   - **Already paid:** outstanding = 0 → show the paid receipt view, no buttons.

   **Amount:** defaults to the full outstanding amount. A "Pay part of it" link reveals an `AmountInput` capped at outstanding (the contract refuses overpayment with `Overpayment`).

   Both transactions go through `useTx`. Between them, re-read `allowance` so a slow RPC never causes a second approval.

5. **Receipt view** after `ReceivablePaid`:
   - "Paid 50.00 USDC to Athena Labs for INV-2026-014" with the transaction link and block time.
   - "Print receipt" (print stylesheet: white background, no buttons, includes the transaction hash and the receivable id).
   - "Why this is safe": one paragraph — the payment went to the business's treasury contract and is recorded against this invoice number on Arc; no one can redirect it.

6. **For agents** (collapsed section at the bottom): "Paying from software? This invoice also accepts x402 nanopayments." with the agent-payable URL and a minimal client example:
   ```ts
   import { GatewayClient } from "@circle-fin/x402-batching/client";
   const client = new GatewayClient({ /* chain and signer config — see Circle's x402 docs */ });
   const res = await client.fetch("https://api.athena.example/pay/0x…");   // pays the 402 challenge
   ```
   ⚠️ VERIFY the client constructor options and method name against the `@circle-fin/x402-batching` version the backend pins; copy them from the backend's Phase 36 client code so the two match.

7. **EURC invoices** work identically with the EURC address; show "EURC" everywhere and the EURC balance.

8. **Phishing hygiene.** The page shows the treasury contract address being approved and paid, with an explorer link, and the domain of the app in the footer. It never asks for a signature other than `approve` and `payReceivable`, and never asks to sign a message.

**Exit check:** from the customer profile, paying a seeded 25.00 USDC invoice takes two wallet prompts and ends on the receipt view; the receivable shows `paid` on the receivables page; opening the same link again shows the receipt with no buttons; opening a customer-restricted invoice from another wallet explains who can pay and offers no button; the approve prompt in the wallet shows exactly 25.00, not unlimited.

---
## SERVICES, IDENTITY, TRACTION

## Phase 39 — Services: what Athena buys with x402, and checking the bill

**Goal:** show the agent as a buyer too — paying per call for services with nanopayments — and show it checking a usage-billed vendor's invoice against its own meter.

**Steps**

1. **Data:** `GET /services` (ask the backend for it — Phase 7.6) → purchases (time, URL host, amount, ok, latency, meter key) and per-meter totals; subscriptions with `meter_key`; decisions of kind `TOP_UP_SERVICES`.

2. **Purchases** table with a sparkline of daily spend per meter, success rate and median latency. Show the URL host only, not full URLs with query strings.

3. **Independent metering card** — the AP check that matters:
   ```
   Data API (usage-billed) · invoice for Oct 1–14
   Vendor says:  1,240 calls · 12.40 USDC
   Athena counted: 1,236 calls · 12.36 USDC   (difference 0.3%, within 1% tolerance)  ✓ matched
   ```
   From the obligation's match detail for subscription invoices with a meter key. A difference above tolerance links to the held invoice.

4. **Service credit** — the spend wallet's Gateway balance used for x402 payments, the SERVICES budget remaining, and the last top-up decision.

**Exit check:** after a day of operation, purchases appear with totals per meter; the seeded data-API invoice shows the vendor count vs Athena's count and the match result.

---

## Phase 40 — Agent identity and reputation (ERC-8004)

**Goal:** show who Athena is on-chain — its registered identity, the keys and their powers, and the reputation records it writes about vendors.

**Steps**

1. **Data:** `GET /agent` (ask the backend — Phase 7.6) → `{ agentId, identityRegistry, registrationTx, agentCardUrl, reputationRegistry, feedbackCount }`, plus browser reads of the identity registry (`ownerOf(agentId)`, `tokenURI(agentId)`) and fetching the agent card JSON from `tokenURI` (if it is an `https:` or `data:` URI; never fetch arbitrary schemes).
   ⚠️ VERIFY the ERC-8004 registry function names and the agent card fields against the registry contracts at the addresses in `addresses.json` (`erc8004.identityRegistry`, `erc8004.reputationRegistry`) before building the reads. On mainnet `erc8004` is `null` in `addresses.json`; show "ERC-8004 registries are not configured on mainnet for this deployment" rather than an error.

2. **Identity card:** name, description, agent id, owner address, registration transaction, endpoints from the agent card (API, MCP, x402 pay link pattern), and the treasury contract it operates.

3. **Who can do what** — a diagram built from public addresses (ask the backend to expose them in `/health` as `wallets: { admin, approver, operator, keeper, yield, spend, fx, collections }`):
   ```
   Admin (human)      ── sets budgets, raises caps, unpauses
   Approver (human)   ── approves payees and escalations, pauses
   Operator (agent)   ── commits, executes, reveals, proposes payees, lowers caps
   Keeper (watchdog)  ── flags overdue records
   Internal wallets   ── yield · spend · FX · collections (payees like any other)
   ```
   Each node has its address chip and its on-chain role check (✓ via `hasRole`). This makes the separation of powers concrete: the agent holds a key that cannot approve anything.

4. **Reputation:** the feedback Athena has written about vendors (score, tag, link to the payment it refers to), and any feedback others wrote about Athena. Read from the API, with a per-row link to the registry transaction.

**Exit check:** the identity card shows the agent id and a working registration tx link; every role node shows ✓ for its own role and the operator node shows ✗ for approver; mainnet shows the honest "not configured" note.

---

## Phase 41 — Traction

**Goal:** the page a judge uses to score 30% of the project: live numbers, computed from the chain and the database, mainnet first, each with a link to its evidence, labeled honestly.

**Steps**

1. **Data:** `/metrics` from **every enabled network's API** (two queries), merged in the client. Each metric carries `network` (backend 42.1).

2. **Header line**, written plainly (backend 42.4): "Athena operates the treasury for the Athena team's own operations: 5 vendors, 3 customers, since Oct 2. Scenario runs are excluded from these numbers."

3. **Tiles** (mainnet column first when live, then testnet), each with a sparkline of the daily series and an evidence link:

   | Tile | Evidence link |
   |---|---|
   | Businesses operated | the entity / overview |
   | USDC received | receivables filtered to paid |
   | USDC paid out | decisions filtered to executed payments |
   | Obligations settled on time, no human | obligations "Paid" tab filtered to never escalated |
   | Decisions made vs escalated | decision log, escalations |
   | Human agreement (escalations · reviews) | escalations, reviews |
   | Invoices processed | review queue history |
   | Duplicates caught | invoices filtered to duplicate holds |
   | Payee changes intercepted | payees with invoice-sourced address history |
   | Discounts captured | decisions filtered to `PAY_EARLY` |
   | Funds under management | overview |
   | Yield earned (testnet labeled) | yield |
   | Forecast accuracy | forecast |
   | DPO / DSO | obligations / receivables |
   | Cross-chain payouts | cross-chain |
   | Service purchases | services |
   | Decisions sealed and opened | decision log |
   | Audit record (longest streak with no overdue records; arrears events) | decisions with overdue filter |

4. **Charts:** USDC paid out and received per day (bars), decisions per day split executed / escalated / no-op (stacked bars), cumulative funds under management (line). Recharts, converted for plotting only (Phase 14 rule).

5. **Mainnet section.** When mainnet is live, a highlighted block: "Real money on Arc mainnet" with the mainnet tiles and the list of mainnet payments (each with its explorer link). When it is not, the block is omitted — never shown with zeros.

6. **Updates log.** Links to the daily traction reports the backend commits under `docs/traction/` in the repository (backend 42.3), newest first. Read them at build time from the repo (the web app is in the same monorepo) with a server component that lists the directory; render the markdown as text, not HTML.

7. **Freshness.** "Updated 3 minutes ago from cycle 14:00" under the title; tiles refetch every 60 seconds.

**Exit check:** every tile has a value, a network label and a working evidence link; scenario-tagged decisions do not change any tile; turning off the mainnet API removes the mainnet block without errors.

---

## CONTROL

## Phase 42 — Safety controls

**Goal:** the humans can stop the treasury, change policy within their powers, and anyone can enforce the audit deadline — all from their own wallets, with the consequences stated before they sign.

**Steps**

1. **Page:** `/controls`. Visible to everyone (transparency); actions gated by role.

2. **Pause / unpause.**
   - **Pause** (approver or admin — the contract allows both): a red button with a confirmation dialog: "Pausing stops every commit, execution, payee approval and escalation approval. The agent will keep syncing and publishing records. Only the admin can unpause." Calls `pause()`.
   - **Unpause** (admin only): `unpause()`.
   - Current state read from the chain, with who paused and when (latest `Paused`/`Unpaused` event from `getContractEvents`).

3. **Budgets** (admin edits; everyone reads). The Phase 15 bars, plus an Edit dialog per budget:
   - Fields: limit per period, per-payment approval limit (`AmountInput`), period (days → seconds), evidence required (toggle).
   - Show old → new for each field before signing.
   - Calls `setBudget(category, token, limitPerPeriod, perTxApprovalLimit, periodSeconds, requiresEvidence)`.
   - Warn if the new approval limit is above the period limit, or if the change would let the agent spend more than the treasury holds in one period.
   - **New budget** for a category/token pair that has none (same call).

4. **Operating floor** (admin): `setMinOperating(token, amount)` per token, with the current free balance and the forecast's stress minimum shown beside it, so the admin does not set a floor the treasury is already below.

5. **Payee caps** (admin raises or lowers; shows the agent's lowering history from `PayeeCapChanged` events where `by` is the operator).

6. **Audit deadline — anyone can enforce it.** A card "Overdue records" lists decisions resolved more than `revealDeadlineBlocks` ago and still not revealed (the API's list, double-checked on-chain with `getDecision`). Each has a **Flag overdue** button calling `flagOverdue(decisionId)` — callable by **any** wallet, including a visitor's. Explain: "If Athena fails to publish a record in time, anyone can flag it. A flagged record freezes the agent until it is published." Normally this list is empty, and the card says so with the current streak: "Every record published on time for 6 days."

7. **Contract configuration** (read-only display): `payeeCooldown`, `escalationTtl`, `revealDeadlineBlocks`, CCTP finality threshold and max fee bps, supported tokens — read from the chain. Changing them stays a script operation (backend Phase 15), not a button; say so.

8. **Emergency withdraw** (admin, only while paused — `adminWithdraw` has `whenPaused`): hidden behind a disclosure "Emergency", requires typing `WITHDRAW` and choosing token, destination and amount. Shows the destination in large type. This exists so the demo can show the business always keeps control of its money; it should never be used in normal operation.

**Exit check:** pausing from the approver profile shows the banner everywhere within 5 seconds and blocks escalation approvals; unpausing requires the admin; changing the vendor approval limit from 250 to 200 shows in `getBudget` and in the next cycle's decision records; the Flag overdue button works from a visitor wallet against a forced-overdue decision (backend scenario S6 with `SKIP_REVEAL=true`).

---

## Phase 43 — Admin console

**Goal:** one page where the admin runs the operation: trigger cycles, create the records the three-way match needs, and see that the machine is healthy.

**Steps**

1. **Page:** `/admin`, admin role + admin session. Shows the session state ("Signed in as 0xAd…01 until 15:20 · Sign out").

2. **Operator health** (from `/health`, plus native balance reads of public addresses):
   - Operator and keeper gas balances (native USDC, 18 decimals) with a warning under 2 USDC (the backend's gas floor runs cycles dry below that — its 37.4).
   - Last cycle time and status, next cycle time, operator enabled flag, dry-run flag.
   - Indexer lag: chain head − indexed block.

3. **Cycle controls:** Run now · Dry run (Phase 9.3 proxy). After clicking, link to the live view.

4. **Purchase orders:** a form (vendor, PO number, lines with quantity and unit price, terms such as "2/10 net 30") → `POST /api/admin/purchase-orders`. List of open POs with how much has been invoiced against each.

5. **Receipts / milestone acceptance:** a form (PO, lines received or milestone accepted, date, optional deliverable file → hashed **in the browser** with SHA-256 and only the hash sent) → `POST /api/admin/receipts`. The deliverable's hash becomes part of the evidence bundle; the file itself never leaves the admin's machine unless they choose to upload it.

6. **Shortcuts:** Upload invoices · New payee · Issue invoice.

7. **Dev-only tools** (rendered only when `NEXT_PUBLIC_NETWORKS` does not include `mainnet` *and* `NODE_ENV !== "production"`): links to seed scripts' documentation, a button to open the kitchen sink.

**Exit check:** creating a PO and a receipt from this page lets a matching invoice upload go straight to `obligated` without a hold; the receipt's file hash equals `sha256sum` of the file; operator gas below 2 USDC shows the warning.

---

## QUALITY

## Phase 44 — Loading, empty and error states; accessibility; responsiveness; performance

**Goal:** every page holds up in the states judges will actually hit — slow RPC, empty lists, a backend restart, a phone, a screen reader.

**Steps**

1. **States per data block.** Every card and table independently shows: skeleton (loading), empty state (written for its context), error state (with retry), and stale indicator (data older than expected). One failing block never blanks a page.

2. **Chain-read failures.** If the browser's RPC fails, show "Couldn't reach Arc from your browser" on chain-backed elements (verification, health banner, pay page) and keep API-backed content visible. Retry with backoff; the `fallback` transport (Phase 5) tries the second RPC first.

3. **Accessibility:**
   - Every interactive element reachable by keyboard in a logical order; visible focus ring in seal gold.
   - Status is never color-only: badges carry text and an icon (A5.4).
   - `aria-live="polite"` region for SSE activity and transaction stages; `assertive` only for errors that block an action.
   - Dialogs trap focus and return it on close.
   - Charts have a "View as table" toggle.
   - Amounts are read correctly by screen readers: the `Amount` component renders `aria-label="412.50 USDC"`.
   - Run axe (via `@axe-core/playwright` in Phase 45) on every route; zero serious or critical violations.

4. **Responsive:** test at 375, 768, 1024, 1440 px. Tables become cards; the live view stacks (seal on top, stages, then stream); the escalation page puts "What you're signing" first on phones because that is what the approver needs.

5. **Performance budgets:**

   | Page | First-load JS (gzip) | LCP on Fast 4G |
   |---|---|---|
   | Landing (excluding the lazy seal chunk) | ≤ 180 KB | ≤ 2.0 s |
   | Console pages | ≤ 250 KB | ≤ 2.5 s |
   | Pay page | ≤ 160 KB | ≤ 2.0 s |

   Techniques: server components for static content; `next/dynamic` for the seal, charts and the record drawer; `optimizePackageImports`; no moment/lodash; images through `next/image`.

6. **Error boundary.** `app/(console)/error.tsx` and `app/pay/[receivableId]/error.tsx` show a calm message and a retry, and report the error (console in dev; a lightweight error endpoint or Vercel's logs in production). Never show a stack trace.

**Exit check:** with the backend stopped, every console page renders its chain-backed parts and clear error states for the rest; axe reports no serious violations; the budgets in the table are met in `next build` output and a Lighthouse run.

---

## Phase 45 — Tests

**Goal:** the parts that can lose money or mislead a reviewer are tested: formatting, verification, signing messages, error messages, the pay flow and the approval flow.

**Steps**

1. **Unit tests (Vitest):**
   - `format.test.ts` — Phase 4 cases.
   - `verify.test.ts` — Phase 26 cases with real testnet fixtures, plus tampering cases.
   - `actionHash.test.ts` — the browser's `actionHash(toChainAction(record.action))` equals the hash stored on-chain for three real decisions (fixtures captured once from testnet).
   - `messages.test.ts` — `buildReviewMessage` produces exactly the backend's 40.4 text (copy a known-good message and signature from the backend's tests; `verifyMessage` must accept it).
   - `errors.test.ts` — every error name in the ABI has a `CONTRACT_ERRORS` entry (iterate the ABI's `type: "error"` items), so a new contract error cannot ship without a human message.
   - `invalidate.test.ts` — every SSE event type maps to at least one query key.

2. **Component tests** (Testing Library + MSW for the API): obligation row plan text for each status; escalation card reason sentences; review-queue hold reasons; pay-page step logic (wrong payer, insufficient balance, no gas, already paid, partial).

3. **End-to-end (Playwright)** against the local backend on testnet with seeded data:
   - **Wallet in tests.** Inject a test-only EIP-1193 provider into `window.ethereum` before page load (`page.addInitScript`) that forwards reads to the RPC and signs with a private key held by the test runner through `page.exposeFunction` (viem `privateKeyToAccount` on the Node side). Build it only into the e2e bundle (`NEXT_PUBLIC_E2E=1`); it must never exist in production.
   - **Flows:** visitor browses every route; verifier verifies a decision with the API blocked (`page.route` aborting the API host); approver approves an escalation created by a scenario; customer pays a receivable; admin signs in and runs a dry-run cycle.
   - **Accessibility:** `@axe-core/playwright` on every route.
   - E2E runs spend testnet gas; run them on demand and before submission, not on every commit.

4. **Contract-drift guard.** A test that loads the ABI from `@athena/shared` and checks the functions the frontend calls exist with the expected argument types (`approveEscalation(bytes32)`, `payReceivable(bytes32,uint256)`, `setBudget(bytes32,address,uint256,uint256,uint64,bool)`, …). If the backend changes a signature, this fails before a judge clicks a dead button.

**Exit check:** `pnpm --filter web test` passes; the e2e suite passes once end to end against testnet; the errors test fails if you delete one entry from `CONTRACT_ERRORS`.

---

## Phase 46 — The judge tour and the scenario gallery

**Goal:** a judge with five minutes sees the five things that matter, in order, with real data, without needing the video.

**Steps**

1. **Tour.** "Take the 90-second tour" (landing) starts a guided overlay — a small custom component, no heavy library:
   ```ts
   const TOUR = [
     { route: "/overview",   target: "#spendable",       title: "What the business has",
       body: "Live from the treasury contract on Arc. Spendable means above the operating floor." },
     { route: "/live",       target: "#stages",          title: "The loop",
       body: "Every 15 minutes, and whenever an invoice or payment arrives, Athena runs this cycle." },
     { route: "/decisions",  target: "#first-row",       title: "Sealed before acting",
       body: "Each decision's SHA-256 was committed on-chain before any money moved." },
     { route: "/decisions/[latest]", target: "#verify", title: "Check it yourself",
       body: "Your browser just recomputed the hash and compared it with Arc. No trust in our server needed." },
     { route: "/escalations", target: "#agreement",      title: "When it stops",
       body: "Over a limit, the contract sends it to a human wallet. Here is how often humans agreed." },
     { route: "/traction",   target: "#tiles",           title: "What it has done",
       body: "Every figure is computed from the chain and linked to its evidence." },
   ];
   ```
   Progress lives in memory and `sessionStorage` (wrapped in `try/catch`); "Skip" ends it; Escape closes it; it never blocks interaction.

2. **Scenario gallery** (`/live#scenarios` or a section on `/traction`). The backend's Phase 44 runs fifteen tagged scenarios. Ask the backend's scenario runner to write `docs/scenarios/results.json`:
   ```json
   [{ "id": "S3", "title": "Prompt-injected invoice", "proves": "Vendor text cannot change who gets paid",
      "decisionIds": ["0x…"], "txs": ["0x…"], "ranAt": "2026-10-10T09:12:00Z", "network": "testnet" }]
   ```
   The gallery imports it at build time and shows a card per scenario: what it proves (one sentence), the mistake from the backend's A2 it maps to, and links to its decisions (with verification) and transactions. Scenario cards are labeled `SCENARIO` and kept apart from operating numbers (backend 42.4).

3. **"Ask Athena" page** (`/mcp`): how to connect the MCP server to Claude Desktop or Claude Code (Streamable HTTP URL from `NEXT_PUBLIC_MCP_URL`), the tool list (backend 41.1), and three example questions with the answers they produce:
   - "Why did Athena pay invoice INV-0042 eight days early?"
   - "Verify decision 0x… against the chain."
   - "What is waiting for a human right now?"
   State that the server is read-only by design.

**Exit check:** the tour runs from the landing page through all six stops on seeded data in under two minutes; every scenario card links to at least one verifiable decision or transaction; the MCP page's URL works when pasted into an MCP client.

---

## SHIP

## Phase 47 — Mainnet, side by side

**Goal:** mainnet appears naturally next to testnet — small, real, clearly labeled — without any page pretending testnet is mainnet or hiding that mainnet is small.

**Steps**

1. **Enable it.** When the backend's Phase 45 is done: set `NEXT_PUBLIC_API_MAINNET`, add `mainnet` to `NEXT_PUBLIC_NETWORKS`, and fill the mainnet treasury in `addresses.json`.

2. **Default network.** Keep `testnet` as the default console network (that is where the full operation runs), but show mainnet first on `/traction` and on the landing live strip.

3. **Feature differences, stated, not hidden:**

   | Feature | Testnet | Mainnet |
   |---|---|---|
   | Yield | Earn Kit vaults | per the backend's Phase 45 (USYC only if entitled; otherwise "No yield on mainnet in this deployment") |
   | ERC-8004 | registries configured | "not configured" note |
   | Spend wallet | Developer-Controlled Wallet | Circle Agent Wallet with spending limits (show the limits) |
   | Cross-chain | Base Sepolia | whatever the backend enabled, or "not used on mainnet" |

   Each page reads capabilities from the network config (`null` in `addresses.json` → feature off) and shows a one-line note instead of an empty card.

4. **Visual difference.** On mainnet, the network badge is gold-outlined, and every transaction button says "Sign on Arc mainnet". Amount inputs show a soft warning above 50 USDC on mainnet ("This is real money").

5. **Pay page on mainnet.** Invite one real person (a teammate or a friend) to pay a small real invoice. That payment shows up in the mainnet traction block with its explorer link.

**Exit check:** switching networks changes every number and link; no mainnet page shows a testnet transaction or vice versa (spot-check ten links); mainnet traction shows the real payments with working explorer links.

---

## Phase 48 — Deployment

**Goal:** the app is live on a stable URL with correct environment, security headers and CORS, and stays up through judging.

**Steps**

1. **Vercel project** pointing at the monorepo:
   - Root directory: `apps/web`.
   - Install command: `pnpm install --frozen-lockfile` (run at the repo root; Vercel detects pnpm workspaces).
   - Build command: `pnpm --filter web build`.
   - Node version: 22.
   - Environment variables from A10, separately for Production and Preview. Preview deployments use testnet only (`NEXT_PUBLIC_NETWORKS=testnet`) and **no** admin keys.

2. **Domain.** A short custom domain if you have one; otherwise the Vercel domain. Use the same URL in: the backend's `FRONTEND_URL` and `CORS_ORIGIN`, the pay links in invoice emails, the agent card, the submission.

3. **Security headers** in `next.config.ts`:
   ```ts
   async headers() {
     const api = [process.env.NEXT_PUBLIC_API_TESTNET, process.env.NEXT_PUBLIC_API_MAINNET].filter(Boolean).join(" ");
     const rpc = [process.env.NEXT_PUBLIC_RPC_TESTNET, process.env.NEXT_PUBLIC_RPC_MAINNET].filter(Boolean).join(" ");
     const csp = [
       "default-src 'self'",
       "script-src 'self' 'unsafe-inline'",           // Next.js inline bootstrap + theme script; tighten with nonces if time allows
       "style-src 'self' 'unsafe-inline'",
       "img-src 'self' data: blob:",
       "font-src 'self'",
       `connect-src 'self' ${api} ${rpc} https://*.walletconnect.com wss://*.walletconnect.com https://*.walletconnect.org wss://*.walletconnect.org`,
       "frame-ancestors 'none'",
       "base-uri 'self'",
       "form-action 'self'",
     ].join("; ");
     return [{ source: "/(.*)", headers: [
       { key: "Content-Security-Policy", value: csp },
       { key: "X-Content-Type-Options", value: "nosniff" },
       { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
       { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
       { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
     ]}];
   }
   ```
   ⚠️ VERIFY the WalletConnect hosts against the WalletConnect/Reown docs for the SDK version you pin, and add the signed-URL host of the backend's document storage (Supabase) to `connect-src` only if the browser fetches it (opening in a new tab does not need it). `frame-ancestors 'none'` stops click-jacking of the approval pages.

4. **Backend side.** Confirm the production API allows the production origin in CORS, serves SSE without buffering (disable proxy buffering on its host), and is on HTTPS (the browser blocks mixed content, and `crypto.subtle` needs a secure context).

5. **Monitoring.** An uptime check on `/` and `/overview` every 5 minutes (any free uptime service). Vercel logs for server-route errors (admin proxy, session).

6. **Freeze.** From October 16, deploy only fixes. Tag the commit that is live at submission.

**Exit check:** the production URL loads every route; the browser console shows no CSP violations on any page (check landing, decision, escalation, pay); SSE works in production; the admin proxy works from the production domain and refuses requests from any other origin.

---

## Phase 49 — Demo video and submission

**Goal:** a short video and a submission that show, in the judges' order of weight, an agent making real decisions, real usage, Circle's tools, and the sealed-decision idea.

**Steps**

1. **Shot list (about 3 minutes):**

   | Time | Screen | What to say |
   |---|---|---|
   | 0:00–0:15 | Landing, seal turning | "Athena runs a business treasury in USDC on Arc. Before it spends, it seals its reasoning on-chain." |
   | 0:15–0:35 | Overview → forecast | "This is what the business holds and the 30-day picture it plans against." |
   | 0:35–1:05 | Live view, a real cycle | "An invoice arrives. Athena forecasts, decides to pay early for a 2% discount, seals the decision, pays, and opens the record." |
   | 1:05–1:25 | Decision page, verification | "Your browser recomputes the hash and checks it against Arc. Here's where the validator overruled the model." |
   | 1:25–1:50 | Escalation on the approver's phone and laptop | "Over the limit, the contract stops and asks a human. The approver signs with their own wallet." |
   | 1:50–2:10 | Review queue: duplicate and address-change holds | "It refuses to guess: duplicates and changed payout addresses go to a human." |
   | 2:10–2:30 | Cross-chain, yield, euros | "Contractor paid on Base with CCTP, idle cash in an Earn Kit vault, euro invoices paid in EURC." |
   | 2:30–2:50 | Traction page, mainnet block | "Real numbers since Oct 2, including real payments on Arc mainnet." |
   | 2:50–3:00 | `/verify` with the API blocked | "Don't trust us — verify it against the chain." |

   Record at 1440×900, dark theme, full-screen live view, real data only. If a step fails during recording, use Replay (Phase 32) and say so.

2. **Screenshots** for the submission and README: landing, overview, live view mid-cycle, decision with verification, escalation, traction. Export at 2× in dark theme.

3. **Repository README (frontend section):** what the app shows, how to run it (`pnpm --filter web dev` with the env file), the routes table from A6, and the "verify it yourself" snippet from Phase 27.

4. **Submission form** (forms.gle link from the hackathon page): project name **Athena**; links to the live app, the `/traction` page, the `/verify` page, the repository, the video; the treasury addresses on testnet and mainnet with explorer links; the list of Circle tools with where each is visible in the app (A4's table).

5. **Final checklist (October 17, before 11:59 PM ET):**
   - [ ] Production URL loads every route on desktop and phone.
   - [ ] Latest decision verifies ✓ in a fresh browser with no wallet.
   - [ ] `/verify` works with the API blocked.
   - [ ] Traction tiles show non-zero operating numbers; mainnet block shows real payments.
   - [ ] Escalation inbox and review queue are empty or intentionally populated for the demo, not stale.
   - [ ] No testnet-labeled number appears in a mainnet context.
   - [ ] Admin key not in the client bundle (search `.next/static`).
   - [ ] Video uploaded and public; link in the form.
   - [ ] Form submitted; confirmation saved.

**Exit check:** the submission is in, and a teammate who has not seen the app follows the tour and the verifier on the production URL without help.

---
# Part C — Reference

## C1. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| A USDC balance is off by 10¹² | Reading the native balance (18 decimals) as if it were the ERC-20 (6 decimals), or the reverse | ERC-20 `balanceOf` on `0x3600…0000` for every amount; native balance only for the "gas" line |
| Wallet shows a weird gas symbol or 18-decimal amounts for USDC | The chain object declares native currency wrongly | Fix the shared chain definition (native USDC, 18 decimals) |
| Every write fails before the wallet opens with "insufficient funds" | The wallet has no USDC for gas on Arc | Fund it from the faucet; the tx hook says this in plain words |
| `switchChain` does nothing | Wallet doesn't know Arc and the add-chain request was rejected | Add Arc by hand (Phase 0) or approve the add-chain prompt |
| Verification says "Could not find the reveal event" | RPC refused the log range, or wrong network selected | Lower the chunk size in Phase 26; check `?net=`; the reveal tx hint path avoids log scans |
| "Verification needs HTTPS" | Page served over plain HTTP on a non-localhost host | Use HTTPS (Vercel does); `crypto.subtle` requires a secure context |
| Verification shows ✗ on "Record matches the seal" | Comparing the pretty-printed JSON instead of the canonical bytes | Hash the bytes from the reveal event, never re-serialized JSON |
| ✗ on "Record is in canonical form" only | The browser's RFC 8785 library version differs from the backend's | Pin the same `canonicalize` version in both |
| ✗ on "Action … sealed" for every decision | `toChainAction` field order or types differ from the shared `ACTION_TUPLE` | Use `actionHash` from `@athena/shared/action`; never re-implement it |
| SSE never connects in production | CORS origin missing, or a proxy buffers the stream | Add the origin to the backend's `CORS_ORIGIN`; disable buffering for `/events/stream` |
| SSE connects but nothing updates | Event payload lacks the id the invalidation map needs | Agree payload fields with the backend (Phase 8.2); log unparsed events in dev |
| Approve escalation fails with "Someone already decided this" | Another approver (or a stale tab) resolved it | Refresh; the inbox moves it to Approved/Rejected |
| Approve escalation fails with the pause message | Treasury paused; `approveEscalation` is `whenNotPaused` | Admin unpauses first |
| Pay page: "This invoice can only be paid from 0x…" | Receivable registered with a specific customer address | Connect that wallet, or the admin issues invoices with "Anyone with the link" |
| Pay page: approve succeeded but pay fails with `SafeERC20FailedOperation` or a token revert | Allowance read stale, or balance dropped between steps | The flow re-reads allowance and balance before step 4; reload and retry |
| Admin sign-in: "not an admin of this treasury" | Wrong wallet, or wrong network selected | Check `?net=` and the connected account |
| Admin proxy returns 404 | Route not on the allowlist | Add it deliberately to the allowlist in Phase 9.3 |
| 3D seal is blank | WebGL unavailable or the fiber/drei/React versions mismatch | The SVG fallback should show; fix the version pairing (Phase 1.2) |
| Hydration warnings on the landing | Rendering live numbers or times on the server | Render live values in client islands only |
| Numbers differ between overview and a decision | The overview shows the latest snapshot; the decision shows what it saw at its block | Expected; the decision page says which block it saw |
| Mainnet page shows errors | `NEXT_PUBLIC_API_MAINNET` empty or `treasury` null in `addresses.json` | The page should show "not live yet"; if it errors, a component skipped the null check |

## C2. Contract error messages for humans

`CONTRACT_ERRORS` in `src/lib/chain/errors.ts` maps every custom error to one sentence. The errors test (Phase 45) fails if any ABI error lacks an entry.

| Error | Message shown |
|---|---|
| `ZeroAddress()` | "An address is missing." |
| `ZeroAmount()` | "The amount can't be zero." |
| `ZeroValue()` | "A required value is zero." |
| `RoleCollision()` | "The same address can't hold both of these roles." |
| `Unauthorized()` | "This wallet isn't allowed to do that." |
| `AccessControlUnauthorizedAccount(account, role)` | "Only the {role name} wallet can do this. Connected: {short(account)}." |
| `EnforcedPause()` | "The treasury is paused. An admin must unpause it first." |
| `ExpectedPause()` | "This is only possible while the treasury is paused." |
| `UnsupportedToken(token)` | "The treasury doesn't accept {symbol or short(token)}." |
| `NoBudget(category, token)` | "There's no {category} budget for {symbol} yet. Create one on Controls." |
| `BadPeriod()` | "The budget period must be longer than zero." |
| `BadConfig()` | "That configuration isn't allowed." |
| `InvalidPayeeData()` | "The payee details are incomplete or invalid." |
| `NoPendingPayee(payeeId)` | "There's nothing waiting for approval for this payee." |
| `PayeeNotActive(payeeId)` | "This payee isn't active (pending, suspended, or unknown)." |
| `PayeeCoolingDown(payeeId, activeFrom)` | "This payee becomes payable on {formatDateTime(activeFrom)}, after its safety cooldown." |
| `TokenMismatch()` | "This payee is paid in a different token." |
| `NotTightening(currentCap, newCap)` | "The agent can only lower a cap: {current} → {new} would raise it." |
| `DecisionExists(decisionId)` | "A decision with this id already exists." |
| `UnknownDecision(decisionId)` | "There's no decision with this id on this treasury." |
| `BadDecisionState(decisionId, state)` | "Someone already decided this — it's now {DECISION_STATE[state]}." |
| `CommitNotSettled()` | "The seal must land in an earlier block before acting. Try again in a moment." |
| `ActionMismatch()` | "The action doesn't match what was sealed. Nothing was sent." |
| `UnknownKind(kind)` | "Unknown action type {kind}." |
| `AlreadySettled(obligationId)` | "This bill has already been paid." |
| `EvidenceRequired()` | "Payments in this category need an evidence hash (invoice, PO, receipt)." |
| `FeeNotAllowed()` | "A cross-chain fee isn't allowed for this payee." |
| `FeeTooHigh()` | "The cross-chain fee is above the treasury's limit." |
| `NotCrossChainToken()` | "Only USDC can be sent cross-chain." |
| `InsufficientFunds(token, available, requested)` | "Not enough free {symbol}: {available} available, {requested} needed (operating floor and reserve are protected)." |
| `InsufficientReserve()` | "The reserve doesn't hold that much." |
| `EscalationExpired()` | "This request expired. Athena will re-plan it with fresh numbers." |
| `NotRevealable()` | "This decision can't be published yet." |
| `AlreadyRevealed()` | "This record is already published." |
| `HashMismatch()` | "The record doesn't match its seal." |
| `NotOverdue()` | "This record isn't overdue yet." |
| `AuditInArrears(overdueCount)` | "The agent is frozen: {n} record(s) are overdue for publication." |
| `ReceivableExists(receivableId)` | "An invoice with this number already exists." |
| `UnknownReceivable(receivableId)` | "There's no invoice with this id." |
| `NotCustomer()` | "This invoice can only be paid from the customer's own wallet." |
| `Overpayment(outstanding, attempted)` | "That's more than what's owed: {outstanding} outstanding." |
| `ReentrancyGuardReentrantCall()` | "The transaction was refused for safety. Try again." |
| `SafeERC20FailedOperation(token)` | "The token transfer failed — check the balance and the allowance." |
| ERC-20 `ERC20InsufficientBalance` / `ERC20InsufficientAllowance` or a string revert from the token | "Not enough balance or allowance for this payment." |

Role names for `AccessControlUnauthorizedAccount`: map the role hash with the `ROLE` object (Phase 6.2): `0x00…00` → "admin", `APPROVER_ROLE` → "approver", `OPERATOR_ROLE` → "operator".

The token on Arc may revert with a string message rather than a custom error; `toHumanError` falls back to the last row for any revert whose data does not decode against the treasury ABI but occurs inside `payReceivable` or `approve`.

## C3. Security checklist

- [ ] No admin key, Circle key, entity secret, service-role key or private RPC URL in any `NEXT_PUBLIC_` variable or in `.next/static`.
- [ ] Admin routes go only through the allowlisted proxy, check a signed session, re-check the on-chain role, and reject foreign `Origin` headers.
- [ ] Session cookie is http-only, `Secure`, `SameSite=Strict`, encrypted, and expires.
- [ ] Signed messages (review, sign-in) are built by one function each, include a nonce and an issued-at time, and are shown in plain text by the wallet.
- [ ] Every contract write is simulated before the wallet opens; errors are decoded to C2 messages.
- [ ] The approver sees the action read from the chain (`getEscalation`), and its hash is compared with the sealed `actionHash`, before signing.
- [ ] Payee approval shows the on-chain pending data, not the API's copy.
- [ ] The pay page approves the exact amount, never unlimited; it computes the amount from the chain.
- [ ] Verification uses bytes from the chain and hashes in the browser; the server's opinion is labeled as such.
- [ ] Untrusted text (invoice content, extraction output, model rationale, vendor names, agent card fields) is rendered as text — never `dangerouslySetInnerHTML`, never as a link unless the app formats it.
- [ ] Vendor documents open through short-lived signed URLs in a new tab with `noopener noreferrer`; never embedded.
- [ ] `tokenURI` fetches only `https:` and `data:` URIs, with a size limit and a timeout.
- [ ] CSP set; `frame-ancestors 'none'`; HSTS on.
- [ ] The e2e wallet shim is compiled only with `NEXT_PUBLIC_E2E=1` and absent from production builds.
- [ ] `localStorage`/`sessionStorage` hold only the theme and tour progress, inside `try/catch`.
- [ ] The operator role is never held by a human wallet; the app warns if it sees one.

## C4. Page-by-page acceptance checklist

| Page | Must show | Must work without a wallet | Must work without the API |
|---|---|---|---|
| `/` | hero, live strip, latest sealed decision with in-browser verify | yes | hero and seal (strip hides) |
| `/overview` | spendable, runway, FUM, where-the-money-is, budgets, Gateway, internal wallets | yes | live balance + health banner |
| `/forecast` | base/stress chart, floor line, day drawer, assumptions | yes | no |
| `/obligations` | tabs, plan column, filters in URL | yes | no |
| `/obligations/[id]` | life timeline, document, match, evidence recompute, decisions | yes | no |
| `/invoices/review` | hold reasons as sentences, actions for approver | read-only | no |
| `/invoices/[id]` | extracted (untrusted) vs accepted, duplicate and match detail | yes | no |
| `/invoices/upload` | dropzone, per-file progress and outcome | admin only | no |
| `/payees` | statuses with cooldown countdown, screening, internal group | yes | no |
| `/payees/[id]` | on-chain card, screening, address history, scorecard | yes | on-chain card |
| `/payees/new` | form, status tracker | admin only | no |
| `/decisions` | ledger rows, seal states, filters, verify-all | yes | no |
| `/decisions/[id]` | record sections from verified bytes, overrule panel, on-chain table, VerifyPanel, reviews | yes | yes, via `/verify` |
| `/verify` | input, API-free mode, VerifyPanel, script | yes | **yes** |
| `/escalations` | reasons, limits crossed, chain-read countdowns, agreement | read-only | no |
| `/escalations/[id]` | impact estimate, "what you're signing" with hash check, approve/reject | read-only | signing panel from chain |
| `/cycles`, `/cycles/[id]` | stages with timings, inputs, plan, validation, decisions | yes | no |
| `/live` | stages, seal, decision stream, reasoning, replay | yes | no |
| `/yield` | positions, vaults considered with scores, why-this-vault | yes | no |
| `/crosschain` | CCTP stages with both explorers, Gateway transfers | yes | no |
| `/fx` | EURC need, swaps with rates and refusals | yes | no |
| `/receivables`, `/receivables/[id]` | statuses, dunning, payments, pay links, unattributed inflows | yes | on-chain record |
| `/receivables/new` | form, preview, tracker | admin only | no |
| `/pay/[id]` | invoice, 4-step flow, receipt | needs a wallet to pay | **yes** (amount from chain) |
| `/services` | purchases, metering check | yes | no |
| `/traction` | tiles with evidence, mainnet first, charts, updates log | yes | no |
| `/agent` | identity, role diagram with on-chain checks, reputation | yes | role diagram |
| `/controls` | pause state, budgets, floor, caps, overdue flagging, config | read-only (flagging needs any wallet) | yes |
| `/admin` | health, cycle controls, PO and receipt forms | admin only | no |
| `/mcp` | connection steps, tools, examples | yes | yes |

## C5. Glossary

| Term | Meaning in this app |
|---|---|
| **Seal / sealed** | A decision's SHA-256 hash committed on-chain (`commit`) before any action. Shown in gold. |
| **Open / opened** | The full decision record published on-chain (`reveal`); the contract checks it against the seal. |
| **Verified** | The browser recomputed the hash from the on-chain bytes and every check in Phase 26 passed. |
| **Decision record** | The canonical JSON describing what the agent saw, the forecast, the rule, the evidence, the model's proposal and the action. |
| **Action** | The exact on-chain instruction (kind, obligation, payee, token, amount, fee, evidence hash) whose keccak hash is sealed with the decision. |
| **Escalation** | A payment the contract refused to make on the agent's authority, waiting for the approver's wallet. |
| **Hold** | An invoice Athena refused to act on because of a data problem; resolved by a signed message, not a transaction. |
| **Audit arrears** | One or more records not published in time; the contract freezes new commits and payments until they are. |
| **Spendable** | Free operating balance minus the operating floor. |
| **Operating floor** | The minimum balance the contract keeps untouched for operations (`minOperating`). |
| **Reserve** | Money set aside inside the treasury by a decision, not spendable until released. |
| **Cooldown** | The waiting time after a payee is approved or changed before it can be paid. |
| **Evidence hash** | SHA-256 of the invoice + PO + receipt bundle; ties a payment to outside documents. |
| **Three-way match** | Checking an invoice against its purchase order and the receipt or milestone acceptance. |
| **Cycle** | One run of the treasury loop: catch up, read, look, forecast, plan, check, seal, act, open, after. |
| **Overruled** | The validator replaced an item the model proposed because it broke a rule; the record says why. |
| **Funds under management** | Treasury + yield + Gateway + internal wallets, per network. |
| **Unified balance** | USDC across chains visible as one balance through Circle Gateway. |
| **CCTP** | Circle's Cross-Chain Transfer Protocol: burn on Arc, attest, mint natively on the destination chain. |
| **x402** | HTTP 402 nanopayments; how agents pay Athena's invoices and how Athena pays for services. |
| **Testnet / mainnet** | Arc Testnet (5042002) runs the full operation; Arc Mainnet (5042) runs a small, real operation. Every number is labeled. |
