# Athena — what only YOU can do (step by step)

Everything the agent could do on its own is done and verified (see `docs/scenarios.md`). The items below need **your wallets,
your accounts, your API keys, or your approval**. Do them in this order — it is sorted by how much each one matters for the
hackathon submission.

> **Deadline: Oct 17, 2026, 11:59 PM ET.** If time is short, do sections **1 → 2 → 3 → 7**, and skip the rest.

Values used throughout (testnet, already deployed):

| What | Value |
|---|---|
| Treasury contract | `0xcf0d101a556a79e3d673c0dad2a6e5c16d27e947` |
| Chain | Arc Testnet, id `5042002` |
| RPC | `https://rpc.testnet.arc.io` |
| Explorer | `https://explorer.testnet.arc.io` |
| USDC (6 decimals) | `0x3600000000000000000000000000000000000000` |
| EURC | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` |
| Pending escalation (12 USDC to Alex Rivera) | `0x23ff71a73e4f904fdbb6a0abbe11980a4f7eb2d32bd3484d78998c29f5479d5d` |
| Your Foundry keystores | `athena-admin`, `athena-approver` (in `%USERPROFILE%\.foundry\keystores`) |

**Never paste a private key, seed phrase, keystore password, or API key into a chat, a commit, or a screenshot.**

---

## 0. Start the stack locally (needed for sections 2, 3 and the demo video)

Open three PowerShell windows.

```powershell
# window 1 — API
cd D:\Projects\Athena\apps\backend
pnpm exec tsx --env-file=.env.local src/api.ts

# window 2 — worker (runs cycles every 15 min, handles triggers and events)
cd D:\Projects\Athena\apps\backend
pnpm exec tsx --env-file=.env.local src/worker.ts

# window 3 — frontend
cd D:\Projects\Athena\frontend
npm run build
npm start          # http://localhost:3000
```

> **Use `pnpm exec tsx …` as shown, not `pnpm api` / `pnpm worker`.** On this PC pnpm's `script-shell` is set to `cmd.exe`,
> which makes `pnpm <script>` open an empty `cmd` prompt and exit instead of running the script (you only see the
> Windows banner). The commands above skip that. To fix it for good, run `pnpm config delete script-shell` once; after
> that `pnpm api` and `pnpm worker` work.

Check it is healthy: open <http://localhost:3100/health> — you should see `"ok":true` and the treasury address.

The worker is running with `DRY_RUN=false`, i.e. cycles move real (testnet) money. For a risk-free run use the **Dry Run**
button on the dashboard.

If your network drops (`ENOTFOUND`, `ECONNRESET`), the worker now reconnects by itself; if the **API** or worker process
dies, just start it again.

---

## 1. Push the code to GitHub (5 min) — do this first

Everything is committed locally (8+ commits ahead of `origin/main`). Nothing is pushed.

```powershell
cd D:\Projects\Athena
git status                 # should say "nothing to commit"
git log --oneline -10      # skim what is about to go out
git push origin main
```

Before pushing, confirm no secret is tracked:

```powershell
git ls-files | Select-String -Pattern "\.env"     # must print nothing (only .env.example style files are OK)
```

`apps/backend/.env.local` and `frontend/.env.local` are git-ignored — they must **not** appear.

---

## 2. Connect MetaMask as the approver and click-test the wallet actions (20 min)

These flows are wired and the contract calls were simulated, but **no one has clicked them with a real wallet yet**.

### 2a. Add Arc Testnet to MetaMask
MetaMask → Networks → Add a network manually:

| Field | Value |
|---|---|
| Network name | Arc Testnet |
| RPC URL | `https://rpc.testnet.arc.io` |
| Chain ID | `5042002` |
| Currency symbol | `USDC` |
| Block explorer | `https://explorer.testnet.arc.io` |

> On Arc, USDC is also the gas token (18-decimals natively, 6-decimals as the ERC-20). That is normal.

### 2b. Import the APPROVER account
The approver key lives in your Foundry keystore. Import it **as a JSON file** so you never handle the raw key:

1. MetaMask → account menu → **Add account or hardware wallet** → **Import account**.
2. Type: **JSON File**.
3. Choose `C:\Users\syles_pv4\.foundry\keystores\athena-approver`.
4. Enter the keystore password you set when you created it.

Check the address matches the approver you used on-chain:
```powershell
cast wallet address --account athena-approver
```
It must equal the account shown in MetaMask. This account needs a little USDC for gas (a few cents).
If it has none, get testnet USDC from **<https://faucet.circle.com>** (select Arc Testnet).

### 2c. Click-test in the app (http://localhost:3000)

1. Click **Connect Wallet** (top right) → MetaMask → approve the connection.
2. **Approvals → Escalations**: select the pending *Alex Rivera · 12 USDC* row.
   - **Approve Escalation** → MetaMask pops up → confirm.
   - ⚠ Approving **executes the 12 USDC payment** to Alex Rivera's placeholder address (seeded, not a real person). That is
     fine on testnet and is exactly the demo you want ("a human approved this over-limit payment"). If you would rather not
     spend the 12 USDC, click **Reject** instead — it also demonstrates the flow.
   - Wait ~10 s: the status flips to *approved* and a *Resolve tx* link appears. The worker then reveals the decision.
3. **Audit Trail**: open the decision → **Verify On-chain** → it must say *Hash verified*. Then click **Agree** (this asks
   MetaMask to *sign a message*, not send a transaction).
4. **Obligations → Review Queue**: select a held invoice (e.g. *INV-2041 — no purchase order*) → **Release** or **Reject**
   → sign the message. (Release re-runs matching; it will usually hold again for the same reason — that is correct.)
5. **Receivables → pick an open receivable → Open Pay Page** (the URL is `/pay/0x…`).
   - Connect **any** wallet that holds testnet USDC (use a second MetaMask account funded from the faucet, or the approver).
   - **Pay USDC** → MetaMask asks twice: (1) *approve* USDC, (2) *payReceivable*. Both must confirm.
   - The receivable flips to *paid* once the indexer sees it (~1 min).
   - ⚠ Receivables seeded with a customer wallet can only be paid by that wallet. The seeded ones have no restriction.

If a click shows **"Contract refused: …"** the app simulated the call first and the contract would have reverted — the text
is the contract's error name (e.g. `NotCustomer`, `BadDecisionState`). That is the system working; tell me the name and I will
explain it.

---

## 3. Deployment (done)

Both halves are public:

| Part | Where | URL |
|---|---|---|
| Frontend | Vercel project `athena` (root directory `frontend`, Git-linked, every push to `main` deploys) | <https://athena-rho-sandy.vercel.app> |
| Backend (API + worker) | Render web service `athena-backend` (free plan, Docker, auto-deploys on push to `main`) | <https://athena-backend-1xua.onrender.com> |

The `…-sylesh7s-projects.vercel.app` aliases are behind Vercel login — don't share those.

### 3a. Backend → Render

- One image, the root `Dockerfile`; `ATHENA_PROCESS` picks what runs (`api`, `worker`, `keeper`, or `all`). Render's free
  plan has no background-worker type, so the service runs `all`: the API on `$PORT` plus the worker (restarted if it
  exits) in the same container — see `apps/backend/docker-start.sh`.
- Variables are copied from `apps/backend/.env.local` (never commit them), plus `ATHENA_PROCESS=all`,
  `CORS_ORIGIN=https://athena-rho-sandy.vercel.app,http://localhost:3000` and `FRONTEND_URL=https://athena-rho-sandy.vercel.app`.
  `PUBLIC_BASE_URL` and `SERVICE_URLS` default to Render's `RENDER_EXTERNAL_URL`. Change variables in the Render
  dashboard (the CLI cannot edit them).
- **The free plan sleeps** after ~15 min without HTTP traffic — the worker sleeps with it, and the first request takes
  ~50 s to wake it (the worker catches up on start). Before a demo or judging, open `/health` a minute early, or point a
  free uptime pinger at `/health` every 10 min. A paid Render Background Worker would let the worker (and its keys) run
  separately from the API again.
- **Never run the worker locally AND on Render at the same time** against the same database/keys — stop one first.
  (A database lock prevents two simultaneous cycles, but two workers still double up on triggers.)
- Health: <https://athena-backend-1xua.onrender.com/health> → `"ok":true`. Logs: `render logs -r srv-db9rpd3rjlhs73fuk0o0`.
- `railway.json` is kept for Railway (same Dockerfile); that account's trial has expired.

### 3b. Frontend → Vercel

Environment variables (production): `NEXT_PUBLIC_ATHENA_API` and `ATHENA_API_URL` = the Render URL above, and
`ATHENA_ADMIN_API_KEY` (server-only). `NEXT_PUBLIC_*` values are baked in at build time, so after changing one, redeploy
(`vercel redeploy <latest production url> --target production` from `frontend/`, or push to `main`).

> `ATHENA_ADMIN_API_KEY` must **never** be named `NEXT_PUBLIC_…`. It is used only by the server routes that run a cycle,
> upload an invoice, issue a receivable and add a payee.

---

## 4. Raise the payee cooldown (3 min, needs the ADMIN wallet)

Right now new payees can be paid immediately after activation (cooldown = 0, set for bootstrapping). For the demo's
"safe by default" story, raise it to 10 minutes. From `packages\contracts`:

```powershell
cd D:\Projects\Athena\packages\contracts
$T = "0xcf0d101a556a79e3d673c0dad2a6e5c16d27e947"; $R = "https://rpc.testnet.arc.io"
# setConfig(payeeCooldown, escalationTtl, revealDeadlineBlocks, cctpMinFinality, maxCctpFeeBps)
cast send $T "setConfig(uint64,uint64,uint64,uint32,uint16)" 600 259200 7200 1000 100 --rpc-url $R --account athena-admin
```
(`259200` = 3 days, the existing TTL; the others are unchanged.) Confirm: success + a tx hash.
Note: with a 10-minute cooldown, a payee you activate in the demo cannot be paid for 10 minutes — activate payees *before*
you record the video.

---

## 5. Real email with Resend (10 min, optional)

Reminder emails are built and were verified against a local stub (subject, amount, pay links, PDF attached). To send real ones:

1. <https://resend.com> → sign up → **API Keys** → create a key (starts with `re_`).
2. Without a verified domain, Resend only delivers to **your own account email**, and only from `onboarding@resend.dev`.
   That is enough for the demo.
3. Put in `apps\backend\.env.local` (and the Render service variables):
   ```
   RESEND_API_KEY=re_...
   FROM_EMAIL=Athena Labs <onboarding@resend.dev>
   ```
4. Restart the worker.
5. In the app: **Receivables → Issue Invoice** with *Customer Email = your own email* → within one cycle you get the invoice
   email with the PDF attached and a **Pay online** link.

---

## 6. Optional live checks (only if you have time — they do not affect the core demo)

### 6a. Cross-chain payout (CCTP)
Never run live. You need a payee on another chain, which only the approver can activate.
1. App → **Approvals → Payees → Add Payee** is for Arc payees only. For a remote payee call the API directly:
   ```powershell
   $h = @{ "x-admin-key" = "<your ADMIN_API_KEY>"; "content-type" = "application/json" }
   $b = '{"slug":"vendor:base-vendor","name":"Base Vendor","kind":"vendor","category":"VENDOR","token":"USDC","domain":6,"remoteRecipient":"0x000000000000000000000000<20-byte-address-without-0x>","perTxCap":"50"}'
   Invoke-RestMethod -Method Post -Uri http://localhost:3100/payees -Headers $h -Body $b
   ```
2. Wait one cycle (worker screens and proposes it), then **Approvals → Payees → Activate** with the approver wallet.
3. The relayer wallet needs gas on the destination chain (Base Sepolia ETH) — fund the `RELAYER` address.
4. Upload an invoice for that vendor; the cross-chain tab on Metrics fills in when the burn/attest/mint completes.

### 6b. FX leg (USDC → EURC → back)
Needs EURC obligations/budget; EURC is already a supported token. Ask me to drive it — it takes a prepared EURC invoice and
a funded FX wallet, and I can run it through the cycle.

---

## 7. Submit (30 min) — do not leave this to the end

Checklist (from the hackathon brief):

- [ ] Code pushed to GitHub (section 1) and the repo is **public** (or shared with the judges as instructed).
- [ ] Frontend URL works for someone not on your machine (section 3).
- [ ] **Demo video, under 3 minutes.** Suggested script:
  1. (0:00) Dashboard: balances, budgets, live feed.
  2. (0:20) Upload an invoice → it appears in the review queue / becomes an obligation.
  3. (0:50) Audit Trail: a payment decision → **Verify On-chain** → *Hash verified* (commit → execute → reveal).
  4. (1:20) The 12 USDC escalation → connect approver wallet → **Approve** → show the tx on the explorer.
  5. (1:50) A receivable → pay it with a wallet (or the x402 link).
  6. (2:20) Metrics: decisions on-chain, 0 overdue reveals. Close with one line: *"every decision is committed before money moves and revealed after; a missed reveal freezes the agent."*
- [ ] Traction numbers for the update:
  ```powershell
  cd D:\Projects\Athena\apps\backend
  pnpm exec tsx --env-file=.env.local scripts/traction.ts
  ```
  Paste the output into the **Canteen Discord** (`discord.gg/bDaEfsSqc8`) using the update command `arc-canteen update traction`.
- [ ] Submission form: <https://forms.gle/BBWrdfuircrKiG2i6>.
- [ ] Event page (Luma): `luma.com/ivroypr5` — use the passphrase from your BACKEND_README.
- [ ] Links to include: GitHub repo, live frontend, explorer link to the treasury contract and to one revealed decision,
  `docs/scenarios.md` (all the live scenario tx hashes).

---

## 8. Security housekeeping (important)

- **The exposed wallet.** Earlier in this project a seed phrase ended up in an env var and in an error message. Treat
  that wallet as **compromised**: never put funds in it again and do not use it as admin/approver anywhere real.
  (Your current admin/approver are the keystore accounts above — confirm with `cast wallet address --account athena-admin`.)
- Rotate the **OpenAI key** and **Telegram bot token** if you ever pasted them anywhere public; check the OpenAI dashboard
  usage (you funded $10; the app's own budget guard caps it at $4 total / $0.50 a day).
- Back up `%USERPROFILE%\.foundry\keystores` and remember the passwords — they are the only copy of the admin and approver keys.
- Never commit `.env.local`. `git ls-files | Select-String "\.env"` should stay empty.
- **Mainnet is not enabled.** Do not point anything at mainnet until we have agreed the funding wallet and amounts
  (the plan caps it at ~25 USDC and 10 USDC budgets).

---

## 9. Quick troubleshooting

| Symptom | Fix |
|---|---|
| `forge`/`cast`: *dns error / No such host* | Windows resolves but forge's resolver fails. Retry; or add `104.18.21.97 rpc.testnet.arc.io` to `C:\Windows\System32\drivers\etc\hosts` (Administrator), and remove it afterwards. |
| `cast send`: *unexpected argument '--slow'* | `--slow` exists only on `forge script`, not `cast send`. Just drop it. |
| `NoPendingPayee(...)` on `approvePayee` | That payee is already approved (or was never proposed). Not an error. |
| `pnpm api` / `pnpm worker` only prints the Windows banner and returns | pnpm's `script-shell=cmd.exe` setting. Use `pnpm exec tsx --env-file=.env.local src/api.ts` (or `src/worker.ts`), or run `pnpm config delete script-shell` once. |
| Dashboard shows demo numbers | The frontend can't reach the API → check `NEXT_PUBLIC_ATHENA_API` and that the API is up (`/health`). |
| "Dry run queued" but nothing happens | The worker is not running (or lost its connection). Restart `pnpm worker`. |
| Pay page: *Contract refused: NotCustomer* | That receivable is restricted to a specific customer wallet. Use that wallet. |
| Approve button does nothing | Wallet not connected, or not on Arc Testnet (chain 5042002), or the account is not the approver. |
| "Could not start the cycle: …429" | The 30-second cooldown on the Run Cycle button. Wait and retry. |
| `ECONNRESET` / `ENOTFOUND` in logs | Flaky network to Supabase/RPC. The worker self-heals; the API and frontend just need a retry. |
| Disk fills up again | `%USERPROFILE%\.foundry\anvil\tmp` (fixed in the test harness; delete leftovers). |

If anything here is unclear or fails, send me the exact error text (not keys or passwords) and which step you were on.
