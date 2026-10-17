# Athena — 3-minute demo video: what to run, what to show, what to say

**Pitch (say it in the first 10 seconds):**
> "Athena is an autonomous business treasury on Arc. Every decision is hash-committed on-chain *before* money moves and
> revealed *after* — so anyone can verify the agent did what it said — and a human approves anything over the limits."

**Length:** 3:00 max. Target 2:50. Cycles take **2–4 minutes** on this network, so you record in **two takes** and splice
them; never wait on screen for a cycle.

**The story the video tells (6 beats):**
1. An invoice PDF arrives → the agent **extracts, validates, matches, and pays** it (2.50 USDC).
2. A bigger invoice (7 USDC) is **over the limit** → the agent **stops and pings you on Telegram**.
3. You **approve from your wallet** → only then does the contract pay.
4. **Verify On-chain**: the decision hash recomputed in the browser matches the one committed *before* the money moved.
5. A customer **pays a receivable in USDC** from their wallet (approve + pay), settled on Arc.
6. **Email** with the PDF and pay link, and the **Metrics** page.

---

## A. Pre-flight (BEFORE recording — about 15 minutes)

**1. Stack is up** (see `docs/OWNER_STEPS.md` section 0 for the commands: API, worker, frontend):
- <http://localhost:3100/health> → `"ok":true`, `"paused":false`
- <http://localhost:3000/dashboard> → shows real numbers (not demo `80,432`)

**2. Browser:** Chrome, ~1400×900, zoom 100%, one tab, notifications off.

**3. MetaMask:** network **Arc Testnet**, the **approver account** selected and **connected** to the app (click *Connect Wallet*
once). It must hold a few USDC: gas is paid in USDC, and the same wallet pays the receivable on camera.

**4. Telegram:** open your **Athena bot chat** in Telegram Desktop or Telegram Web (a separate window you can show). The
escalation alert arrives there. If you have never received one, check the worker log for
`escalation notification failed`, and confirm `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` in `apps/backend/.env.local`.

**5. The two invoice PDFs** (already generated, purchase orders and delivery receipts already seeded):

| File | What it is | What Athena does |
|---|---|---|
| `docs\demo\pixel-studio-INV-DEMO-001.pdf` | Pixel Studio, **2.50 USDC**, due today | Matches PO → **pays automatically** |
| `docs\demo\alex-rivera-INV-DEMO-002-ESCALATE.pdf` | Alex Rivera, **7.00 USDC**, due today | Over the 6 USDC contractor limit → **escalates + Telegram** |

Do **not** upload them before recording (a second upload of the same file is rejected as a duplicate).
They can be regenerated any time:
```powershell
cd D:\Projects\Athena\apps\backend
pnpm exec tsx --env-file=.env.local scripts/make-demo-invoice.ts demo        # recreates the 2.50 USDC one
pnpm exec tsx --env-file=.env.local scripts/make-demo-invoice.ts escalate    # recreates the 7.00 USDC one
```

**6. The receivable you will pay on camera** (and the email shot). In the app: top nav **RECEIVABLES** → orange **ISSUE INVOICE**
button (top right) → fill *Customer Name* `Pay Demo`, **Customer Email = the email you registered Resend with**,
*Amount (USDC)* `1.00`, *Due Date* two weeks out → **Issue**. Click **Run Cycle** on the dashboard and wait until it shows in
the Receivables list as **PENDING** with a *Pay page →* link (about 2–3 minutes: the worker registers it on-chain). Within
the same cycle the invoice **email** (PDF attached, *Pay online* link) lands in your inbox — leave it open in another window.

**7. Windows ready:** the app (Dashboard), Telegram, your email inbox, the MetaMask pop-up positioned so it is visible.

**8. Rehearse once** with throwaway copies (new invoice numbers each time, so no duplicate problems):
```powershell
pnpm exec tsx --env-file=.env.local scripts/make-demo-invoice.ts test             # 2.50 USDC payment copy
pnpm exec tsx --env-file=.env.local scripts/make-demo-invoice.ts test-escalate    # 7.00 USDC escalation copy
```
They write `docs\demo\_rehearsal-*.pdf` — upload those instead, run sections B and C, then **delete the `_rehearsal-*.pdf` files**.
Funds: the treasury pays 2.50 and 7.00 per run and keeps a 2 USDC floor. It currently holds ~24 USDC, enough for **one rehearsal and
the real take** (2 × 9.50 USDC plus the floor). Ask me to top it up if you want more rehearsals.

> The **Run Cycle** button has a 30-second cooldown on purpose. If it says "wait 30 seconds", wait.

---

## B. Take 1 — start the action (record ~35 seconds, then stop and wait ~3–4 minutes)

| Time | Screen | Do | Say |
|---|---|---|---|
| 0:00–0:12 | **Dashboard** (nav → TREASURY) | Point at Free USDC, the budget bars, the live feed. | "This is Athena's treasury on Arc testnet — balances, budgets by category, and a live feed of every agent action." |
| 0:12–0:35 | **OBLIGATIONS** → **Upload Invoice** | Upload `pixel-studio-INV-DEMO-001.pdf` (green *Received…* banner), then upload `alex-rivera-INV-DEMO-002-ESCALATE.pdf`. Go to **Dashboard** → click **Run Cycle** (feed starts: `CYCLE STEP … ingest, validate …`). | "Vendor invoices arrive as PDFs. An LLM reads them, but it only *suggests*: code validates every amount, checks duplicates, and matches each invoice three ways against the purchase order and the delivery receipt." |

**Stop recording.** Wait ~3 minutes. After ~2 minutes click **Run Cycle** once more so the payment step runs.
**Telegram will buzz** when the 7 USDC escalation is raised.

Check before Take 2 (not on camera): Audit Trail shows **PAY_NOW · Pixel Studio · 2.5 USDC**, and Telegram has the alert.

---

## C. Take 2 — the results (record ~2 minutes 25 seconds)

| Time | Screen | Do | Say |
|---|---|---|---|
| 0:35–0:55 | **Telegram** window | Show the message: *"Athena needs a decision — Alex Rivera: 7 USDC — Why it escalated: over the per-payment approval limit — Agent's reasoning … — Review: …"*. Click its **Review** link. | "The 7 USDC invoice is over the approval limit, so Athena didn't pay. It committed its decision on-chain, stopped, and pinged me on Telegram with its reasoning." |
| 0:55–1:20 | **Approvals** (opens straight on the escalation) | Click **Approve Escalation** → MetaMask → **Confirm**. A green line appears: *"approveEscalation confirmed on Arc"* with a **View transaction** link — click it to show the explorer. | "I approve from my approver wallet. The contract checks I hold the approver role, and only then executes the payment. Hard rules revert; soft rules escalate." |
| 1:20–1:50 | **AUDIT TRAIL** | Click the **PAY_NOW · Pixel Studio · 2.5 USDC** row. Show the rationale and the Commit / Execute / Reveal links, then click **Verify On-chain** and point at the green **Hash verified** strip. | "This 2.50 USDC invoice was within limits, so Athena paid it on its own — after committing the hash of its decision on-chain. The browser recomputes the SHA-256 and it matches. If the agent ever fails to reveal, the contract freezes it." |
| 1:50–2:30 | **RECEIVABLES** | Open **Pay Demo** → **Pay page →**. **Connect wallet** if needed → **Pay USDC**. MetaMask asks twice: **(1) approve** USDC, **(2) payReceivable** — confirm both. The card turns green: **"Payment received — receivable settled on-chain"**; click **View transaction →**. | "Athena also collects. Customers get a pay link; this is the customer paying in USDC from their own wallet — approve, then pay — settled on Arc in under a second. Agents can pay the same invoice over x402." |
| 2:30–2:42 | **Inbox** | Show the invoice email: PDF attached, *Pay online* link. | "Athena emails the invoice with the PDF and the pay link, and escalates reminders as it ages." |
| 2:42–3:00 | **METRICS** → Dashboard | Show Decisions On-chain, Total USDC Paid, Audit Streak. | "Every number is derived from on-chain events. Athena: a treasury you can audit — committed before it acts, revealed after, with a human in the loop for anything big. Built on Arc with Circle." |

---

## D. If something goes wrong

| Problem | What to do |
|---|---|
| No Telegram message | The escalation still exists: open **Approvals**. Check the worker log for `escalation notification failed`; the worker retries every cycle. As a fallback, show the older message in the chat history. |
| PDF stays "held" / no payment yet | Click **Run Cycle** again (wait out the 30 s cooldown). Splice in a shot of an earlier PAY_NOW if needed. |
| Approve button does nothing | Wallet not connected, wrong network (must be chain 5042002), or not the approver account. |
| Pay page: *Contract refused: …* | The app simulated first and the contract would revert. Name of the error is the contract's own rule (e.g. `NotCustomer` = that receivable is restricted to another wallet). Use another receivable. |
| Dashboard shows demo numbers | The API is down — start it (`docs/OWNER_STEPS.md` section 0). |
| Email did not arrive | The receivable's *Customer Email* must be your Resend account email; check Resend → Logs. Skip the shot if needed. |

---

## E. Where Resend emails go

- To the **Customer Email on the receivable** (the field in **Issue Invoice**). Customers without an email are skipped.
- **From** is `FROM_EMAIL` in `apps/backend/.env.local` — currently `Athena Labs <onboarding@resend.dev>`.
- With `onboarding@resend.dev` (no verified domain), Resend **only delivers to the email your Resend account was registered
  with**; any other recipient is rejected. The seeded customers use `*.example` addresses, so those go nowhere.
- To email real customers, verify a domain in Resend and change `FROM_EMAIL` to an address on it.
- Ladder: invoice on issue → reminder 3 days before due → "due today" → overdue reminders at +7 and +14 days (late payers
  earlier) → then a human takes over.

## F. Where Telegram messages go

- To the chat in `TELEGRAM_CHAT_ID` through your bot (`TELEGRAM_BOT_TOKEN`), sent by the **worker** the moment an
  escalation is raised (and retried every cycle if Telegram was unreachable).
- The message names the payee and amount, why it escalated, the agent's reasoning, the expiry, and a **Review** link that opens
  the escalation directly in the app (`/approvals?decision=<id>`). The link uses `FRONTEND_URL` (currently
  `http://localhost:3000`, so it only opens on your PC — set it to the public frontend URL after deploying).
