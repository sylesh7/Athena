# Athena — 3-minute demo video: what to run, what to show, what to say

**The one-line pitch (say it in the first 10 seconds):**
> "Athena is an autonomous business treasury on Arc. Every decision is hash-committed on-chain *before* money moves and
> revealed *after* — so anyone can verify the agent did what it said, and a human approves anything over the limits."

**Length:** 3:00 max (the submission limit). Target 2:50.

The system is **already running** on your PC (API :3100, worker, frontend :3000). Real cycles take **2–4 minutes** on this
network, so the video is recorded in **two takes** that you splice together — do not wait on screen for a cycle.

---

## A. Pre-flight (do this BEFORE recording — about 10 min)

1. **Check everything is up**
   - <http://localhost:3100/health> → `"ok":true`, `"paused":false`
   - <http://localhost:3000/dashboard> → shows real numbers (not the demo `80,432`)
2. **Browser:** Chrome, window ~1400×900, zoom 100%, one tab. Close other tabs/notifications. Turn on Do Not Disturb.
3. **MetaMask:** on **Arc Testnet**, the **approver** account selected and **connected** to the app (click *Connect Wallet* once).
   The approver needs a few cents of USDC for gas.
4. **The invoice PDF to upload on camera:** `D:\Projects\Athena\docs\demo\pixel-studio-INV-DEMO-001.pdf`
   (Pixel Studio → Athena Labs, **PX-DEMO-001, 2.50 USDC**, PO `PO-DEMO-001`, due today). Its purchase order and delivery
   receipt are already seeded, so it matches and gets **paid automatically**. Do **not** upload it before recording — a second
   upload of the same file is rejected as a duplicate.
5. **Email shot (optional but impressive).** Resend only delivers to **your own Resend account email** while you use
   `onboarding@resend.dev`. About 5 minutes before recording:
   - Open the app at <http://localhost:3000>. In the **top navigation bar** click **RECEIVABLES** (5th item, between APPROVALS
     and METRICS). On that page click the orange **ISSUE INVOICE** button (top right). A form opens. Fill:
     *Customer Name* = `Demo Customer`; **Customer Email = the email you signed up to Resend with**; *Invoice Number* = leave
     blank (auto); *Amount (USDC)* = `5.00`; *Due Date* = a date 2 weeks from today. Click **Issue**. You get a green
     "Issued as a draft…" message.
   - Click **Run Cycle** (dashboard). Within ~3 min the invoice email arrives **with a PDF attached and a "Pay online" link**.
     Keep that email open in another window for the video.
6. **Have these open in tabs/windows ready:** Dashboard, Obligations, Audit Trail, Approvals, Receivables, Metrics, your inbox.
7. **Rehearse the whole demo once first (recommended).** The real demo PDF is single-use (a second upload is rejected as a
   duplicate), so rehearse with a throwaway copy. Each run creates a *new* invoice number and its own PO + receipt:
   ```powershell
   cd D:\Projects\Athena\apps\backend
   pnpm exec tsx --env-file=.env.local scripts/make-demo-invoice.ts test
   ```
   It prints the path of the file it wrote, `docs\demo\_rehearsal-PX-TEST-XXXX.pdf`. Then run sections **B and C** below exactly
   as if recording, using that file instead of `pixel-studio-INV-DEMO-001.pdf`. Each rehearsal spends **2.50 USDC** of
   the testnet treasury. It currently holds ~11.5 USDC with a 2 USDC operating floor, which covers **one rehearsal plus the real
   take**. A third payment would hit the floor and be held; ask me to top it up if you want more rehearsals.
   Delete the `_rehearsal-*.pdf` afterwards so you never upload the wrong file on camera.

> The 30-second cooldown on **Run Cycle** is intentional. If you see "wait 30 seconds", wait.

---

## B. Take 1 — capture the live action (record ~1 min, then keep the app running)

| Time | On screen | Do | Say |
|---|---|---|---|
| 0:00–0:15 | **Dashboard** | Slowly point at: Free USDC, Reserved, Runway, the budget bars, the live feed. | "This is Athena's treasury on Arc testnet: balances, budgets per category, and a live feed of every agent action." |
| 0:15–0:45 | **Obligations → Upload Invoice** | Click **Upload Invoice**, choose `pixel-studio-INV-DEMO-001.pdf`. The green banner says *Received…*. Switch to **Dashboard** and click **Run Cycle**. Watch the feed show `CYCLE STEP … recover, sync, ingest, validate …`. | "A vendor invoice arrives as a PDF. Athena extracts it with an LLM, but the model only *suggests* — code validates every number, checks for duplicates, and matches it three ways against the purchase order and delivery receipt." |

**Stop recording.** Leave the app alone for **~3 minutes** while the cycle runs. (Click **Run Cycle** once more after ~2 minutes
so the payment step runs; the 30 s cooldown allows it.)

---

## C. Take 2 — the results (record ~2 min)

Check first (not on camera): **Audit Trail** now shows a new **PAY_NOW · Pixel Studio · 2.5 USDC · revealed**.

| Time | On screen | Do | Say |
|---|---|---|---|
| 0:45–1:15 | **Audit Trail** | Click the new **PAY_NOW — Pixel Studio**. Show the rationale text and the three transaction links (Commit, Execute, Reveal). | "The agent decided to pay today, and wrote its reasoning. It committed the hash of that decision on-chain first, executed the payment in a later block, then revealed the full record." |
| 1:15–1:40 | Same panel → **Verify On-chain** | Click **Verify On-chain**. Point at the green **Hash verified** strip and the two identical hashes. Optionally click the **Execute** link to show the transaction on the explorer. | "Anyone can recompute the SHA-256 of the record in their browser and compare it to the hash that was committed before the money moved. If the agent ever fails to reveal, the contract freezes it." |
| 1:40–2:10 | **Approvals** | Show the **Alex Rivera · 12 USDC** escalation with status **APPROVED** and its **Resolve tx** link. (It was over the per-transaction limit, so the agent committed it and stopped.) | "This 12 USDC payment exceeded the approval limit. Athena didn't pay — it escalated to a human. I approved it from my approver wallet, and only then did the contract execute it. Hard rules revert; soft rules escalate." |
| 2:10–2:30 | **Inbox** + **Receivables** | Show the invoice **email** (PDF attached, *Pay online* link). Then **Receivables** → open the pay page. | "On the receivables side Athena issues invoices, emails customers with a PDF and a pay link, escalates reminders, and settles payments on-chain — including agent-to-agent payments over x402." |
| 2:30–2:50 | **Metrics** | Show Decisions On-chain, Total USDC Paid, Audit Streak. | "Every number here is derived from on-chain events: decisions revealed, USDC moved, zero overdue reveals." |
| 2:50–3:00 | Dashboard | Hold on the dashboard. | "Athena: a treasury agent you can audit — committed before it acts, revealed after, and a human in the loop for anything big. Built on Arc with Circle." |

### If you want a **live** human approval on camera
The 12 USDC escalation is already resolved. To show a live click you need a *new* pending escalation, which needs ≥ 8 USDC in
the treasury. Ask me to prepare one (an over-limit invoice + funding) — otherwise showing the resolved escalation is fine.

---

## D. What to show if something goes wrong

| Problem | Fallback |
|---|---|
| The PDF is still "held" or no PAY_NOW yet | Show the **earlier** PAY_NOW (Pixel Studio 3 USDC or the 2.5 USDC rehearsal) — it proves the same flow. Splice the real one in later. |
| Run Cycle says "wait 30 seconds" | Wait; it is a rate limit. |
| Dashboard shows demo numbers | The API is down — start it (see `docs/OWNER_STEPS.md` section 0). |
| Wallet shows "Contract refused: …" | That is the app simulating first. Read the error name aloud — it is the contract's own rule. |
| Email did not arrive | Check the receivable's **customer email is your Resend account email**; check Resend → Logs. Skip the shot if needed. |

---

## E. Where Resend emails go

- A reminder/invoice email is sent **to the email address stored on the receivable's customer** (the *Customer Email* field in
  **Issue Invoice**). Customers without an email are skipped.
- **From** is `FROM_EMAIL` in `apps/backend/.env.local` — currently `Athena Labs <onboarding@resend.dev>`.
- With `onboarding@resend.dev` (no verified domain), Resend **only delivers to the email you registered your Resend account with**.
  Any other recipient is rejected. The three seeded customers use `*.example` addresses, so their emails go nowhere.
- To email real customers, verify a domain in Resend and change `FROM_EMAIL` to an address on that domain.
- The ladder: invoice on issue, reminder 3 days before due, "due today", then overdue reminders at +7 and +14 days (late payers
  earlier); after the last step it hands the case to a human. Each email contains the PDF (first one), the pay link and the x402 link.
