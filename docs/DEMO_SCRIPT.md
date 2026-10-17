# Athena — 3-minute demo video: what to run, what to show, what to say

**Pitch (say it in the first 10 seconds):**
> "Athena is an autonomous business treasury on Arc. Every decision is hash-committed on-chain *before* money moves and
> revealed *after* — so anyone can verify the agent did what it said — and a human approves anything over the limits."

**Length:** 3:00 max. Target 2:50. A real cycle takes **2–4 minutes** on this network, so you record in **two takes** and
splice them; never wait on screen for a cycle.

**The story the video tells (7 beats):**
1. **Upload** an invoice PDF → the agent **extracts, validates, matches, and pays** it (2.50 USDC).
2. A bigger invoice (7 USDC) is **over the limit** → the agent **stops and pings you on Telegram**.
3. You **issue an invoice to a customer** (typing their email) → Athena registers it on-chain and **emails it** with the PDF.
4. You **approve** the over-limit payment **from your wallet** → only then does the contract pay.
5. **Verify On-chain**: the decision hash recomputed in the browser equals the one committed *before* the money moved.
6. The customer opens the **email**, clicks **Pay**, and **pays USDC** from their wallet (approve + pay), settled on Arc.
7. **Metrics**.

---

## A. Pre-flight (BEFORE recording — about 15 minutes)

**1. Stack is up** (`docs/OWNER_STEPS.md` section 0 has the commands: API, worker, frontend):
- <http://localhost:3100/health> → `"ok":true`, `"paused":false`
- <http://localhost:3000/dashboard> → shows real numbers (not demo `80,432`)

**2. Browser:** Chrome, ~1400×900, zoom 100%, one tab, notifications off.

**3. MetaMask:** network **Arc Testnet**, the **approver account** selected and **connected** to the app (click *Connect Wallet*
once). It needs a few USDC: gas is paid in USDC, and the same wallet pays the receivable on camera.

**3b. Allow the deployed site to reach your local API (one-time, important).** The links in Telegram and the email open the
**deployed** site, `https://athena-rho-sandy.vercel.app`, whose data comes from the API on your PC (`localhost:3100`). Recent
Chrome versions ask permission for that. Before recording: open `https://athena-rho-sandy.vercel.app/dashboard` in **Chrome**;
when Chrome asks to *"access other apps and services on this device"* / *"look for devices on your local network"*, click
**Allow**. If you missed the prompt, click the lock icon next to the address bar → **Site settings** → **Local network
access** → **Allow**, then reload. If the page then shows real numbers (Free USDC, budgets), you're set. Use Chrome for the
recording — other browsers may block this. The API and worker must be running on this PC while you record.

**4. Telegram:** open your **Athena bot chat** in Telegram Desktop or Web (a separate window you can show). The escalation
alert arrives there. If you never received one, check the worker log for `escalation notification failed`, and confirm
`TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` in `apps/backend/.env.local`.

**5. Your inbox** open in another window, signed in to the **same email you registered Resend with** (with
`onboarding@resend.dev`, Resend only delivers to that address — see section E).

**6. The two invoice PDFs** (purchase orders and delivery receipts are already seeded):

| File (in `docs/demo/`) | What it is | What Athena does |
|---|---|---|
| `pixel-studio-INV-DEMO-001.pdf` | Pixel Studio, **2.50 USDC**, due today | Matches PO → **pays automatically** |
| `alex-rivera-INV-DEMO-002-ESCALATE.pdf` | Alex Rivera, **7.00 USDC**, due today | Over the 6 USDC contractor limit → **escalates + Telegram** |

Do **not** upload them before recording (a second upload of the same file is rejected as a duplicate). Put them somewhere easy
to find in the file picker (e.g. the Desktop) — you will browse to them on camera. Regenerate any time:
```powershell
cd D:\Projects\Athena\apps\backend
pnpm exec tsx --env-file=.env.local scripts/make-demo-invoice.ts demo        # recreates the 2.50 USDC one
pnpm exec tsx --env-file=.env.local scripts/make-demo-invoice.ts escalate    # recreates the 7.00 USDC one
```

**7. Do NOT pre-create the receivable.** You issue it **on camera** in Take 1 (that is the "putting the email" shot), and pay
it in Take 2. *Fallback if you want a safety net:* pre-create a separate one named `Backup Customer` the same way and leave it.

**8. Rehearse once** with throwaway copies (fresh invoice numbers each time, so no duplicate problems):
```powershell
pnpm exec tsx --env-file=.env.local scripts/make-demo-invoice.ts test             # 2.50 USDC payment copy
pnpm exec tsx --env-file=.env.local scripts/make-demo-invoice.ts test-escalate    # 7.00 USDC escalation copy
```
They write `docs/demo/_rehearsal-*.pdf` — upload those, run sections B and C, then **delete the `_rehearsal-*.pdf` files**.
Funds: each run pays 2.50 + 7.00 and the treasury keeps a 2 USDC floor. It holds ~24 USDC, enough for **one rehearsal and the
real take**. Ask me to top it up if you want more.

> The **Run Cycle** button has a 30-second cooldown on purpose. If it says "wait 30 seconds", wait.

---

## B. Take 1 — do the inputs (record ~55 seconds, then STOP and wait ~3–4 minutes)

| Time | Screen | Do (everything on camera) | Say |
|---|---|---|---|
| 0:00–0:08 | **Dashboard** (nav → TREASURY) | Point at Free USDC, budget bars, the live feed. | "This is Athena's treasury on Arc testnet — balances, budgets per category, and a live feed of every agent action." |
| 0:08–0:30 | **OBLIGATIONS** → **Upload Invoice** | Click **Upload Invoice** → in the file picker choose `pixel-studio-INV-DEMO-001.pdf` → green banner *"Received. Extraction and validation run…"*. Click **Upload Invoice** again → choose `alex-rivera-INV-DEMO-002-ESCALATE.pdf` → banner again. | "Vendor invoices arrive as PDFs. An LLM reads them, but it only *suggests* — code validates every amount, checks for duplicates, and matches each invoice three ways against the purchase order and the delivery receipt." |
| 0:30–0:50 | **RECEIVABLES** → orange **ISSUE INVOICE** | Fill: *Customer Name* `Pay Demo`; **Customer Email** = your Resend email (type it slowly, on screen); *Amount (USDC)* `1.00`; *Due Date* two weeks out. Click **Issue** → green *"Issued as a draft…"*. | "On the receivables side I issue an invoice to a customer. Athena will register it on-chain and email it to them." |
| 0:50–0:55 | **Dashboard** | Click **Run Cycle**. The feed starts scrolling `CYCLE STEP … ingest, validate …`. | "Now the agent runs a cycle." |

**STOP recording.** Wait ~3 minutes. After ~2 minutes click **Run Cycle** once more so the payment step runs (30 s cooldown).
**Telegram buzzes** when the 7 USDC escalation is raised, and **the invoice email lands in your inbox**.

Check before Take 2 (not on camera):
- Audit Trail shows **PAY_NOW · Pixel Studio · 2.5 USDC**
- Telegram has the alert
- Your inbox has the invoice email (PDF attached)
- Receivables lists **Pay Demo** as PENDING with a *Pay page →* link (it appears once the worker registers it on-chain)

---

## C. Take 2 — the results (record ~2 minutes)

| Time | Screen | Do | Say |
|---|---|---|---|
| 0:55–1:10 | **Telegram** window | Show the message: *"Athena needs a decision — Alex Rivera: 7 USDC — Why it escalated: over the per-payment approval limit — Agent's reasoning … — Review: …"*. Click its **Review** link. | "The 7 USDC invoice is over the approval limit, so Athena didn't pay. It committed its decision on-chain, stopped, and pinged me on Telegram with its reasoning." |
| 1:10–1:30 | **Approvals** (opens on the escalation) | **Approve Escalation** → MetaMask → **Confirm**. Green line *"approveEscalation confirmed on Arc"* with **View transaction** — click it to show the explorer. | "I approve from my approver wallet. The contract checks I hold the approver role, and only then executes the payment. Hard rules revert; soft rules escalate." |
| 1:30–1:55 | **AUDIT TRAIL** | Click **PAY_NOW · Pixel Studio · 2.5 USDC**. Show the rationale and the Commit / Execute / Reveal links, then **Verify On-chain** → green **Hash verified**. | "The 2.50 USDC invoice was within limits, so Athena paid it on its own — after committing the hash of its decision on-chain. The browser recomputes the SHA-256 and it matches. If the agent ever fails to reveal, the contract freezes it." |
| 1:55–2:15 | **Inbox** | Open the invoice email to **Pay Demo**: PDF attached, **Pay online** link. Click **Pay online**. | "And here's the customer's side: Athena emailed the invoice with the PDF and a pay link." |
| 2:15–2:45 | **Pay page** (opened from the email) | **Connect wallet** if needed → **Pay USDC**. MetaMask asks twice: **(1) approve** USDC, **(2) payReceivable** — confirm both. Card turns green: **"Payment received — receivable settled on-chain"** → click **View transaction →**. | "The customer pays in USDC from their own wallet — approve, then pay — settled on Arc in under a second. Agents can pay the same invoice over x402." |
| 2:45–3:00 | **METRICS** → Dashboard | Show Decisions On-chain, Total USDC Paid, Audit Streak. | "Every number is derived from on-chain events. Athena: a treasury you can audit — committed before it acts, revealed after, a human in the loop for anything big. Built on Arc with Circle." |

---

## D. If something goes wrong

| Problem | What to do |
|---|---|
| No Telegram message | The escalation still exists: open **Approvals**. Check the worker log for `escalation notification failed`; it retries every cycle. Fallback: show an older message in the chat history. |
| PDF stays "held" / no payment yet | Click **Run Cycle** again (wait out the 30 s cooldown). Splice in an earlier PAY_NOW if needed. |
| Email did not arrive | The *Customer Email* must be your **Resend account email**; check Resend → Logs. Use the `Backup Customer` receivable (step 7) or skip the email shot and open the pay page from Receivables → **Pay page →**. |
| Pay page says the receivable isn't found / won't load | The worker hasn't registered it on-chain yet — run another cycle and wait for it to show as PENDING in Receivables. |
| Approve button does nothing | Wallet not connected, wrong network (must be chain 5042002), or not the approver account. |
| Pay page: *Contract refused: …* | The app simulated first and the contract would revert. The error name is the contract's own rule (e.g. `NotCustomer` = restricted to another wallet). Use another receivable. |
| Dashboard shows demo numbers | The API is down — start it (`docs/OWNER_STEPS.md` section 0). |

---

## E. Where Resend emails go

- To the **Customer Email on the receivable** (the field in **Issue Invoice**). Customers without an email are skipped.
- **From** is `FROM_EMAIL` in `apps/backend/.env.local` — currently `Athena Labs <onboarding@resend.dev>`.
- With `onboarding@resend.dev` (no verified domain), Resend **only delivers to the email your Resend account was registered
  with**; any other recipient is rejected. The seeded customers use `*.example` addresses, so those go nowhere.
- To email real customers, verify a domain in Resend and change `FROM_EMAIL` to an address on it.
- The email's **Pay online** link uses `FRONTEND_URL` (currently `http://localhost:3000`, so it opens on your PC only; set it to
  the public frontend URL after deploying).
- Ladder: invoice on issue → reminder 3 days before due → "due today" → overdue reminders at +7 and +14 days (late payers
  earlier) → then a human takes over.

## F. Where Telegram messages go

- To the chat in `TELEGRAM_CHAT_ID` through your bot (`TELEGRAM_BOT_TOKEN`), sent by the **worker** the moment an escalation
  is raised (retried every cycle if Telegram was unreachable).
- The message names the payee and amount, why it escalated, the agent's reasoning, the expiry, and a **Review** link that opens
  the escalation directly in the app (`/approvals?decision=<id>`), also using `FRONTEND_URL`.
