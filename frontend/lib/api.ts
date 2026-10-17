export const API = process.env.NEXT_PUBLIC_ATHENA_API ?? "http://localhost:3100";
export const EXPLORER = "https://explorer.testnet.arc.io";

export const txLink = (hash?: string | null) =>
  hash ? `${EXPLORER}/tx/${hash}` : null;

export const addrLink = (addr?: string | null) =>
  addr ? `${EXPLORER}/address/${addr}` : null;

// ── amount formatting ──────────────────────────────────────────────────────

export function formatUnits(atomicUnits: string | bigint, decimals = 6): string {
  const n = BigInt(atomicUnits);
  const d = BigInt(10 ** decimals);
  const whole = n / d;
  const frac = n % d;
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr
    ? `${whole.toLocaleString()}.${fracStr}`
    : whole.toLocaleString();
}

export function fmt(atomicUnits: string | bigint, token = "USDC"): string {
  return `${formatUnits(atomicUnits)} ${token}`;
}

// ── types ──────────────────────────────────────────────────────────────────

export type Token = "USDC" | "EURC";

export interface TokenBalance {
  token: Token;
  balance: string;
  reserved: string;
  free: string;
  floor: string;
}

export interface BudgetLine {
  category: string;
  token: Token;
  total: string;
  used: string;
  remaining: string;
}

export interface YieldPosition {
  id: string;
  vault: string;
  protocol: string;
  token: Token;
  principal: string;
  currentValue: string;
  apy: number;
  depositedAt: string;
}

export interface TreasuryOverview {
  balances: TokenBalance[];
  budgets: BudgetLine[];
  runwayDays: number;
  fundsUnderManagement: string;
  yieldPositions: YieldPosition[];
  gatewayBalances: { domain: number; chainName: string; amount: string }[];
  lastCycleAt: string | null;
  paused: boolean;
  overdueCount: number;
}

export type ObligationStatus = "pending" | "scheduled" | "held" | "escalated" | "executed" | "cancelled";

export interface Obligation {
  id: string;
  payeeName: string;
  payeeId: string;
  token: Token;
  amount: string;
  dueDate: string;
  status: ObligationStatus;
  plannedDate: string | null;
  latestDecisionId: string | null;
  invoiceRef: string | null;
  category: string;
}

export interface Invoice {
  id: string;
  ref: string;
  payeeName: string;
  amount: string;
  token: Token;
  holdReason: string;
  status: "held" | "released" | "rejected";
  extractedAt: string;
  fields: Record<string, string>;
}

export type DecisionKind = "PAY" | "PAY_EARLY" | "HOLD" | "NO_OP" | "ESCALATE" | "SCHEDULE" | "YIELD_DEPOSIT" | "YIELD_REDEEM" | "CONSOLIDATE" | "FX_SWAP" | "TOP_UP_SERVICES";
export type DecisionState = "committed" | "executed" | "revealed" | "escalated" | "overdue";

export interface Decision {
  id: string;
  kind: DecisionKind;
  state: DecisionState;
  payeeName: string | null;
  token: Token;
  amount: string;
  rationale: string;
  commitTx: string | null;
  executeTx: string | null;
  revealTx: string | null;
  createdAt: string;
  revealedAt: string | null;
  decisionHash: string | null;
  obligationId: string | null;
}

export interface DecisionVerify {
  recordBytes: string;
  onchainDecisionHash: string;
  recomputedSha256: string;
  match: boolean;
  revealTx: string | null;
}

export type EscalationStatus = "pending" | "approved" | "rejected";

export interface Escalation {
  id: string;
  decisionId: string;
  reason: string;
  payeeName: string;
  token: Token;
  amount: string;
  status: EscalationStatus;
  createdAt: string;
  resolvedAt: string | null;
  resolveTx: string | null;
}

export type PayeeStatus = "draft" | "pending_activation" | "active" | "suspended";

export interface Payee {
  id: string;
  name: string;
  category: string;
  token: Token;
  status: PayeeStatus;
  cap: string;
  riskTier: "low" | "medium" | "high";
  address: string;
  activeFrom: string | null;
  scorecard: { onTime: number; disputes: number; avgDays: number } | null;
}

export type DunningStage = 0 | 1 | 2 | 3 | 4;

export interface Receivable {
  id: string;
  customerName: string;
  customerAddress: string | null;
  token: Token;
  amount: string;
  dueDate: string;
  issuedAt: string;
  paidAt: string | null;
  status: "pending" | "overdue" | "paid";
  dunningStage: DunningStage;
  payLink: string;
  x402Link: string;
}

export interface CrossChainTransfer {
  id: string;
  payeeName: string;
  token: Token;
  amount: string;
  destChain: string;
  burnTx: string | null;
  attestTx: string | null;
  mintTx: string | null;
  stage: "burning" | "attesting" | "minting" | "complete";
  createdAt: string;
}

export interface MetricsSnapshot {
  network: "testnet" | "mainnet";
  businessesOperated: number;
  totalUsdcReceived: string;
  totalUsdcPaid: string;
  obligationsSettledOnTime: number;
  decisionsTotal: number;
  decisionsEscalated: number;
  invoicesProcessed: number;
  duplicatesCaught: number;
  discountsCaptured: string;
  fundsUnderManagement: string;
  yieldEarned: string;
  forecastAccuracy: number;
  crossChainPayouts: number;
  decisionsOnChain: number;
  auditStreak: number;
  updatedAt: string;
}

export interface SSEEvent {
  type: string;
  data: Record<string, unknown>;
  ts: number;
}

// ── Mock data ──────────────────────────────────────────────────────────────

export const MOCK_OVERVIEW: TreasuryOverview = {
  balances: [
    { token: "USDC", balance: "125432500000", reserved: "45000000000", free: "80432500000", floor: "10000000000" },
    { token: "EURC", balance: "8200000000", reserved: "0", free: "8200000000", floor: "2000000000" },
  ],
  budgets: [
    { category: "VENDOR", token: "USDC", total: "80000000000", used: "54300000000", remaining: "25700000000" },
    { category: "SERVICES", token: "USDC", total: "12000000000", used: "8940000000", remaining: "3060000000" },
    { category: "YIELD", token: "USDC", total: "30000000000", used: "20000000000", remaining: "10000000000" },
    { category: "FX", token: "EURC", total: "10000000000", used: "1800000000", remaining: "8200000000" },
    { category: "CONTRACTOR", token: "USDC", total: "20000000000", used: "7500000000", remaining: "12500000000" },
  ],
  runwayDays: 87,
  fundsUnderManagement: "153632500000",
  yieldPositions: [
    { id: "yp-001", vault: "USYC Vault", protocol: "Arc Earn Kit", token: "USDC", principal: "12000000000", currentValue: "12148320000", apy: 4.92, depositedAt: "2026-09-15T10:00:00Z" },
    { id: "yp-002", vault: "USYC Vault II", protocol: "Arc Earn Kit", token: "USDC", principal: "8000000000", currentValue: "8065440000", apy: 4.08, depositedAt: "2026-09-22T14:00:00Z" },
  ],
  gatewayBalances: [
    { domain: 26, chainName: "Arc", amount: "3200000000" },
    { domain: 6, chainName: "Base", amount: "890000000" },
  ],
  lastCycleAt: "2026-10-09T10:30:00Z",
  paused: false,
  overdueCount: 0,
};

export const MOCK_OBLIGATIONS: Obligation[] = [
  { id: "obl-001", payeeName: "Northwind Labs", payeeId: "py-001", token: "USDC", amount: "3500000000", dueDate: "2026-10-14", status: "scheduled", plannedDate: "2026-10-14", latestDecisionId: "dec-001", invoiceRef: "INV-0041", category: "VENDOR" },
  { id: "obl-002", payeeName: "Acme Hosting", payeeId: "py-002", token: "USDC", amount: "299000000", dueDate: "2026-10-10", status: "executed", plannedDate: "2026-10-10", latestDecisionId: "dec-002", invoiceRef: "INV-0040", category: "SERVICES" },
  { id: "obl-003", payeeName: "CloudCorp", payeeId: "py-003", token: "USDC", amount: "12000000000", dueDate: "2026-10-12", status: "escalated", plannedDate: null, latestDecisionId: "dec-003", invoiceRef: "INV-0039", category: "VENDOR" },
  { id: "obl-004", payeeName: "Apex Consulting", payeeId: "py-004", token: "USDC", amount: "5000000000", dueDate: "2026-10-15", status: "held", plannedDate: null, latestDecisionId: null, invoiceRef: "INV-0038", category: "CONTRACTOR" },
  { id: "obl-005", payeeName: "DigitalOps EU", payeeId: "py-005", token: "EURC", amount: "2200000000", dueDate: "2026-10-18", status: "pending", plannedDate: "2026-10-18", latestDecisionId: null, invoiceRef: "INV-0037", category: "VENDOR" },
  { id: "obl-006", payeeName: "Stratum Analytics", payeeId: "py-006", token: "USDC", amount: "900000000", dueDate: "2026-10-09", status: "executed", plannedDate: "2026-10-08", latestDecisionId: "dec-004", invoiceRef: "INV-0036", category: "SERVICES" },
];

export const MOCK_INVOICES: Invoice[] = [
  { id: "inv-003", ref: "INV-0038", payeeName: "Apex Consulting", amount: "5000000000", token: "USDC", holdReason: "Three-way match failed — no matching purchase order found", status: "held", extractedAt: "2026-10-08T16:20:00Z", fields: { vendor: "Apex Consulting", amount: "5000.00", currency: "USD", dueDate: "2026-10-15", description: "Strategy consulting Q4" } },
  { id: "inv-007", ref: "INV-0035", payeeName: "Unknown Vendor", amount: "780000000", token: "USDC", holdReason: "Payee not in registry — address on invoice does not match any active payee", status: "held", extractedAt: "2026-10-07T09:10:00Z", fields: { vendor: "Unknown Vendor", amount: "780.00", currency: "USD", dueDate: "2026-10-20", description: "Software license" } },
];

export const MOCK_DECISIONS: Decision[] = [
  { id: "0xdec001aabbccddee001122334455667788990011aabbccddee001122334455667", kind: "PAY", state: "revealed", payeeName: "Northwind Labs", token: "USDC", amount: "3500000000", rationale: "Invoice INV-0041 due in 5 days, three-way match passed, payee active, within VENDOR budget. Paying on schedule.", commitTx: "0xabc111", executeTx: "0xabc112", revealTx: "0xabc113", createdAt: "2026-10-09T10:30:00Z", revealedAt: "2026-10-09T10:31:45Z", decisionHash: "0x7f3a9b...", obligationId: "obl-001" },
  { id: "0xdec002aabbccddee001122334455667788990011aabbccddee001122334455668", kind: "PAY_EARLY", state: "revealed", payeeName: "Acme Hosting", token: "USDC", amount: "299000000", rationale: "Early payment discount of 2% APR beats best Arc Earn Kit vault yield (4.08%). Capturing $0.16 discount on $299 subscription.", commitTx: "0xbcd221", executeTx: "0xbcd222", revealTx: "0xbcd223", createdAt: "2026-10-09T09:15:00Z", revealedAt: "2026-10-09T09:17:02Z", decisionHash: "0x8e4c2a...", obligationId: "obl-002" },
  { id: "0xdec003aabbccddee001122334455667788990011aabbccddee001122334455669", kind: "ESCALATE", state: "escalated", payeeName: "CloudCorp", token: "USDC", amount: "12000000000", rationale: "Payment amount $12,000 exceeds payee cap of $10,000. Escalating to approver.", commitTx: "0xcde331", executeTx: "0xcde332", revealTx: null, createdAt: "2026-10-09T08:00:00Z", revealedAt: null, decisionHash: "0x9f5d3b...", obligationId: "obl-003" },
  { id: "0xdec004aabbccddee001122334455667788990011aabbccddee001122334455670", kind: "PAY", state: "revealed", payeeName: "Stratum Analytics", token: "USDC", amount: "900000000", rationale: "Invoice due today, match passed, within budget. Paying on due date.", commitTx: "0xdef441", executeTx: "0xdef442", revealTx: "0xdef443", createdAt: "2026-10-08T14:00:00Z", revealedAt: "2026-10-08T14:02:10Z", decisionHash: "0xa06e4c...", obligationId: "obl-006" },
  { id: "0xdec005aabbccddee001122334455667788990011aabbccddee001122334455671", kind: "HOLD", state: "committed", payeeName: null, token: "USDC", amount: "0", rationale: "Cycle completed — 1 obligation held pending review queue resolution.", commitTx: "0xef5551", executeTx: null, revealTx: null, createdAt: "2026-10-08T10:30:00Z", revealedAt: null, decisionHash: "0xb17f5d...", obligationId: null },
];

export const MOCK_ESCALATIONS: Escalation[] = [
  { id: "esc-001", decisionId: "0xdec003aabbccddee001122334455667788990011aabbccddee001122334455669", reason: "Payment $12,000 exceeds payee cap $10,000 for CloudCorp", payeeName: "CloudCorp", token: "USDC", amount: "12000000000", status: "pending", createdAt: "2026-10-09T08:00:00Z", resolvedAt: null, resolveTx: null },
];

export const MOCK_PAYEES: Payee[] = [
  { id: "py-001", name: "Northwind Labs", category: "VENDOR", token: "USDC", status: "active", cap: "10000000000", riskTier: "low", address: "0x1234...abcd", activeFrom: "2026-09-01", scorecard: { onTime: 98, disputes: 0, avgDays: -1 } },
  { id: "py-002", name: "Acme Hosting", category: "SERVICES", token: "USDC", status: "active", cap: "2000000000", riskTier: "low", address: "0x2345...bcde", activeFrom: "2026-09-01", scorecard: { onTime: 100, disputes: 0, avgDays: 0 } },
  { id: "py-003", name: "CloudCorp", category: "VENDOR", token: "USDC", status: "active", cap: "10000000000", riskTier: "medium", address: "0x3456...cdef", activeFrom: "2026-09-10", scorecard: { onTime: 85, disputes: 1, avgDays: 2 } },
  { id: "py-004", name: "Apex Consulting", category: "CONTRACTOR", token: "USDC", status: "active", cap: "8000000000", riskTier: "low", address: "0x4567...def0", activeFrom: "2026-09-15", scorecard: { onTime: 92, disputes: 0, avgDays: 1 } },
  { id: "py-005", name: "DigitalOps EU", category: "VENDOR", token: "EURC", status: "active", cap: "5000000000", riskTier: "low", address: "0x5678...ef01", activeFrom: "2026-09-20", scorecard: null },
  { id: "py-006", name: "NewPartner Inc", category: "VENDOR", token: "USDC", status: "pending_activation", cap: "5000000000", riskTier: "medium", address: "0x6789...f012", activeFrom: null, scorecard: null },
  { id: "py-007", name: "DraftVendor LLC", category: "SERVICES", token: "USDC", status: "draft", cap: "1000000000", riskTier: "low", address: "0x7890...0123", activeFrom: null, scorecard: null },
];

export const MOCK_RECEIVABLES: Receivable[] = [
  { id: "rec-001", customerName: "Volta Systems", customerAddress: "0xaa11...bb22", token: "USDC", amount: "4500000000", dueDate: "2026-10-15", issuedAt: "2026-10-01", paidAt: null, status: "pending", dunningStage: 0, payLink: "/pay/rec-001", x402Link: "http://localhost:3100/pay/rec-001" },
  { id: "rec-002", customerName: "Meridian Group", customerAddress: null, token: "USDC", amount: "2100000000", dueDate: "2026-10-05", issuedAt: "2026-09-25", paidAt: null, status: "overdue", dunningStage: 2, payLink: "/pay/rec-002", x402Link: "http://localhost:3100/pay/rec-002" },
  { id: "rec-003", customerName: "Prism Labs", customerAddress: "0xcc33...dd44", token: "EURC", amount: "950000000", dueDate: "2026-09-30", issuedAt: "2026-09-15", paidAt: "2026-09-29T14:32:00Z", status: "paid", dunningStage: 0, payLink: "/pay/rec-003", x402Link: "http://localhost:3100/pay/rec-003" },
  { id: "rec-004", customerName: "Axiom Capital", customerAddress: "0xee55...ff66", token: "USDC", amount: "8000000000", dueDate: "2026-10-20", issuedAt: "2026-10-05", paidAt: null, status: "pending", dunningStage: 0, payLink: "/pay/rec-004", x402Link: "http://localhost:3100/pay/rec-004" },
];

export const MOCK_CROSSCHAIN: CrossChainTransfer[] = [
  { id: "cc-001", payeeName: "DigitalOps EU (Base)", token: "USDC", amount: "2200000000", destChain: "Base Sepolia", burnTx: "0xburn001", attestTx: "0xattest001", mintTx: "0xmint001", stage: "complete", createdAt: "2026-10-08T11:00:00Z" },
  { id: "cc-002", payeeName: "Stratum Analytics (Arbitrum)", token: "USDC", amount: "900000000", destChain: "Arbitrum Sepolia", burnTx: "0xburn002", attestTx: "0xattest002", mintTx: null, stage: "attesting", createdAt: "2026-10-09T09:45:00Z" },
];

export const MOCK_METRICS: MetricsSnapshot = {
  network: "testnet",
  businessesOperated: 1,
  totalUsdcReceived: "15600000000",
  totalUsdcPaid: "47832000000",
  obligationsSettledOnTime: 38,
  decisionsTotal: 89,
  decisionsEscalated: 3,
  invoicesProcessed: 23,
  duplicatesCaught: 2,
  discountsCaptured: "143000000",
  fundsUnderManagement: "153632500000",
  yieldEarned: "213760000",
  forecastAccuracy: 94.2,
  crossChainPayouts: 5,
  decisionsOnChain: 89,
  auditStreak: 12,
  updatedAt: "2026-10-09T10:30:00Z",
};

export const MOCK_FEED: SSEEvent[] = [
  { type: "decision.revealed", data: { payee: "Acme Hosting", amount: "299000000", token: "USDC" }, ts: Date.now() - 120000 },
  { type: "decision.committed", data: { payee: "Northwind Labs", amount: "3500000000", token: "USDC" }, ts: Date.now() - 240000 },
  { type: "cycle.step", data: { step: "forecast", status: "done" }, ts: Date.now() - 360000 },
  { type: "decision.escalated", data: { payee: "CloudCorp", amount: "12000000000", reason: "cap exceeded" }, ts: Date.now() - 480000 },
  { type: "payment.in", data: { from: "Prism Labs", amount: "950000000", token: "EURC" }, ts: Date.now() - 600000 },
];

// ── API functions: real backend → UI types ─────────────────────────────────
// The backend returns snake_case rows wrapped in { items }. These adapters map them onto the UI types above.
// Mock data is used ONLY when the backend is unreachable (network error); an HTTP error is surfaced as an error.

type Row = Record<string, any>;
const day = (iso?: string | null) => (iso ? String(iso).slice(0, 10) : "");
const upper = (s?: string | null) => (s ?? "").toUpperCase();
const tok = (t?: string | null): Token => (upper(t) === "EURC" ? "EURC" : "USDC");

export const REASONS: Record<number, string> = {
  1: "Exceeds the category budget for this period",
  2: "Exceeds the per-transaction approval limit",
  3: "Exceeds this payee's per-transaction cap",
  4: "Would breach the operating liquidity floor",
};
const HOLD_REASONS: Record<string, string> = {
  no_po: "No purchase order matches this invoice",
  mismatch: "Three-way match failed (invoice, PO and receipt disagree)",
  unknown_vendor: "Vendor is not a registered, active payee",
  amount_unparseable: "The total could not be parsed as an exact amount",
  line_sum_mismatch: "Line items do not add up to the printed total",
  duplicate: "Duplicate of an invoice already processed",
  address_changed: "Payout address differs from the one on record",
  extraction_failed: "Automatic extraction failed",
};

async function fetchJson<T = any>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Real data when the API answers; mock only when it is unreachable (network failure). */
async function load<T>(path: string, map: (j: any) => T | Promise<T>, mock: T): Promise<T> {
  let raw: any;
  try { raw = await fetchJson(path); }
  catch (e) {
    if (e instanceof TypeError) { console.warn(`[athena] API unreachable (${API}) — showing demo data`); return mock; }
    throw e;
  }
  return map(raw);
}

/** Display-only: "120.00" / "1,250.50 USDC" → atomic 6-decimal string; anything unparseable shows as 0 (the invoice stays held anyway). */
const printedToAtomic = (v?: string | null): string => {
  const num = String(v ?? "").replace(/[^0-9.]/g, "");
  if (!/^[0-9]+(.[0-9]{1,6})?$/.test(num)) return "0";
  const [w, f = ""] = num.split(".");
  return (BigInt(w!) * 1_000_000n + BigInt(f.padEnd(6, "0"))).toString();
};

const items = (j: any): Row[] => (Array.isArray(j) ? j : j?.items ?? []);

export const getTreasuryOverview = () =>
  load<TreasuryOverview>("/treasury/overview", async (o) => {
    let runway = 0;
    try {
      const f = await fetchJson("/treasury/forecast");
      const short = (f.days as Row[] | undefined)?.findIndex((d) => BigInt(d.balanceStress) < 0n) ?? -1;
      runway = short >= 0 ? short : (f.days?.length ?? 0);
    } catch { /* forecast is optional */ }
    const tokens = (o.treasury?.tokens ?? {}) as Record<string, Row>;
    const balances: TokenBalance[] = Object.entries(tokens).map(([t, v]) => ({
      token: tok(t), balance: String(v.balance), reserved: String(v.reserved), free: String(v.freeOperating), floor: String(v.minOperating),
    }));
    const budgets: BudgetLine[] = (o.budgets ?? []).map((b: Row) => ({
      category: b.category, token: tok(b.token), total: String(b.limit), used: String(b.spent), remaining: String(b.remaining),
    }));
    const yieldPositions: YieldPosition[] = (o.yield ?? []).map((y: Row, i: number) => ({
      id: String(y.vault ?? i), vault: y.name ?? `${String(y.vault).slice(0, 8)}…`, protocol: "Arc Earn Kit", token: "USDC" as Token,
      principal: String(y.principal ?? 0), currentValue: String(y.value ?? 0), apy: y.apyBps ? Number(y.apyBps) / 100 : 0, depositedAt: o.takenAt,
    }));
    const gatewayBalances = (o.gateway ?? []).map((g: Row) => ({ domain: Number(g.domain), chainName: `${g.wallet} wallet`, amount: String(g.balance) }));
    const usdc = balances.find((b) => b.token === "USDC");
    const fum =
      BigInt(usdc?.balance ?? 0) +
      yieldPositions.reduce((s, y) => s + BigInt(y.currentValue), 0n) +
      gatewayBalances.reduce((s: bigint, g: { amount: string }) => s + BigInt(g.amount), 0n);
    return {
      balances, budgets, runwayDays: runway, fundsUnderManagement: fum.toString(), yieldPositions, gatewayBalances,
      lastCycleAt: o.takenAt ?? null, paused: Boolean(o.treasury?.paused), overdueCount: Number(o.treasury?.overdueCount ?? 0),
    };
  }, MOCK_OVERVIEW);

const OBL_STATUS: Record<string, ObligationStatus> = { open: "pending", scheduled: "scheduled", held: "held", escalated: "escalated", paid: "executed", cancelled: "cancelled" };
export const getObligations = (status?: string) =>
  load<Obligation[]>(`/obligations${status ? `?status=${status}` : ""}`, (j) =>
    items(j).map((o) => ({
      id: o.obligation_id, payeeName: o.payee_name ?? "Unknown", payeeId: o.payee_id, token: tok(o.token), amount: String(o.amount),
      dueDate: day(o.due_date), status: OBL_STATUS[o.status] ?? "pending", plannedDate: o.planned_pay_date ? day(o.planned_pay_date) : null,
      latestDecisionId: o.decision_id ?? null, invoiceRef: o.invoice_number ?? null, category: o.category,
    })), MOCK_OBLIGATIONS);

export const getHeldInvoices = () =>
  load<Invoice[]>("/invoices?status=held", (j) =>
    items(j).map((i) => ({
      id: i.id, ref: i.invoice_number ?? "(unreadable)", payeeName: i.payee_name ?? "Unknown vendor", amount: i.total != null ? String(i.total) : printedToAtomic(i.printed_total),
      token: tok(i.token ?? i.printed_currency),
      holdReason: HOLD_REASONS[i.hold_reason] ?? String(i.hold_reason ?? "held"), status: "held" as const, extractedAt: i.created_at,
      fields: Object.fromEntries(
        Object.entries({ invoice: i.invoice_number, due: day(i.due_date), match: i.match_status }).filter(([, v]) => v).map(([k, v]) => [k, String(v)]),
      ),
    })), MOCK_INVOICES);

const dkind = (k: string): DecisionKind => (k === "PAY_NOW" ? "PAY" : (k as DecisionKind));
const dstate = (d: Row): DecisionState =>
  d.state === "escalated" ? "escalated" : d.revealed ? "revealed" : d.execute_tx ? "executed" : "committed";
const mapDecision = (d: Row): Decision => ({
  id: d.decision_id, kind: dkind(d.kind), state: dstate(d), payeeName: d.payee_name ?? null, token: tok(d.token), amount: String(d.amount ?? 0),
  rationale: d.rationale ?? "", commitTx: d.commit_tx ?? null, executeTx: d.execute_tx ?? null, revealTx: d.reveal_tx ?? null,
  createdAt: d.created_at, revealedAt: d.revealed ? d.created_at : null, decisionHash: d.decision_hash ?? null, obligationId: d.obligation_id ?? null,
});
export const getDecisions = () => load<Decision[]>("/decisions?limit=100", (j) => items(j).map(mapDecision), MOCK_DECISIONS);
export const getDecision = (id: string) => load<Decision>(`/decisions/${id}`, (d) => mapDecision(d), MOCK_DECISIONS[0]);
export const getDecisionVerify = (id: string) =>
  load<DecisionVerify>(`/decisions/${id}/verify`, (v) => ({
    recordBytes: v.recordBytes, onchainDecisionHash: v.onchainDecisionHash, recomputedSha256: v.recomputedSha256,
    match: Boolean(v.match) && v.revealedBytesEqual !== false, revealTx: v.revealTx ?? null,
  }), { recordBytes: "", onchainDecisionHash: "", recomputedSha256: "", match: false, revealTx: null });

export const getEscalations = () =>
  load<Escalation[]>("/escalations", (j) =>
    items(j).map((e) => ({
      id: e.decision_id, decisionId: e.decision_id, reason: REASONS[Number(e.reason)] ?? `Escalation reason ${e.reason}`,
      payeeName: e.payee_name ?? "Unknown", token: tok(e.token), amount: String(e.amount ?? 0),
      status: (e.status === "approved" ? "approved" : e.status === "pending" ? "pending" : "rejected") as EscalationStatus,
      createdAt: e.decision_created_at ?? e.expires_at, resolvedAt: e.resolved_at ?? null, resolveTx: e.resolved_tx ?? null,
    })), MOCK_ESCALATIONS);

const PAYEE_STATUS: Record<string, PayeeStatus> = { draft: "draft", proposed: "pending_activation", active: "active", suspended: "suspended", blocked: "suspended" };
export const getPayees = () =>
  load<Payee[]>("/payees", (j) =>
    items(j).map((p) => {
      const sc = p.scorecard ?? {};
      return {
        id: p.payee_id, name: p.name, category: p.category, token: tok(p.token), status: PAYEE_STATUS[p.status] ?? "draft", cap: String(p.per_tx_cap ?? 0),
        riskTier: (p.risk_tier ?? "low") as Payee["riskTier"], address: p.account ?? p.remote_recipient ?? "", activeFrom: p.active_from ? day(p.active_from) : null,
        scorecard: sc.onTime !== undefined ? { onTime: Number(sc.onTime), disputes: Number(sc.disputes ?? 0), avgDays: Number(sc.avgDays ?? 0) } : null,
      };
    }), MOCK_PAYEES);

export const getReceivables = () =>
  load<Receivable[]>("/receivables", (j) =>
    items(j).map((r) => {
      const paid = r.status === "paid";
      const overdue = !paid && new Date(r.due_date).getTime() < Date.now();
      const remaining = BigInt(r.amount_due) - BigInt(r.amount_paid ?? 0);
      return {
        id: r.receivable_id, customerName: r.customer_name, customerAddress: r.customer_wallet ?? null, token: tok(r.token),
        amount: (remaining > 0n ? remaining : BigInt(r.amount_due)).toString(),
        dueDate: day(r.due_date), issuedAt: day(r.issued_at), paidAt: paid ? (r.updated_at ?? r.issued_at) : null,
        status: paid ? "paid" : overdue ? "overdue" : "pending", dunningStage: Math.min(4, Number(r.dunning_stage ?? 0)) as DunningStage,
        payLink: `/pay/${r.receivable_id}`, x402Link: `${API}/pay/${r.receivable_id}`,
      };
    }), MOCK_RECEIVABLES);

const CC_STAGE: Record<string, CrossChainTransfer["stage"]> = { burned: "attesting", attested: "minting", minted: "complete", failed: "burning" };
export const getCrosschain = () =>
  load<CrossChainTransfer[]>("/crosschain", (j) =>
    items(j).map((c) => ({
      id: String(c.id), payeeName: c.direction === "gateway_in" ? "Gateway inflow" : "Cross-chain payout", token: "USDC" as Token, amount: String(c.amount),
      destChain: `domain ${c.destination_domain}`, burnTx: c.burn_tx ?? null, attestTx: c.attestation ? (c.burn_tx ?? null) : null, mintTx: c.mint_tx ?? null,
      stage: CC_STAGE[c.status] ?? "burning", createdAt: c.updated_at,
    })), MOCK_CROSSCHAIN);

export const getMetrics = () =>
  load<MetricsSnapshot>("/metrics", (j) => {
    const m = (j.latest?.data ?? {}) as Row;
    return {
      network: (j.latest?.network ?? m.network ?? "testnet") as MetricsSnapshot["network"], businessesOperated: Number(m.businessesOperated ?? 0),
      totalUsdcReceived: String(m.usdcReceived ?? 0), totalUsdcPaid: String(m.usdcPaidOut ?? 0), obligationsSettledOnTime: Number(m.obligationsSettledOnTimeNoHuman ?? 0),
      decisionsTotal: Number(m.decisionsMade ?? 0), decisionsEscalated: Number(m.decisionsEscalated ?? 0), invoicesProcessed: Number(m.invoicesProcessed ?? 0),
      duplicatesCaught: Number(m.duplicatesCaught ?? 0), discountsCaptured: String(m.discountsCaptured ?? 0), fundsUnderManagement: String(m.fundsUnderManagement ?? 0),
      yieldEarned: String(Math.max(0, Number(m.yieldEarned ?? 0))), forecastAccuracy: Number(m.forecastAccuracyPct ?? 0),
      crossChainPayouts: Number(m.crossChainPayoutsMinted ?? 0), decisionsOnChain: Number(m.decisionsRevealedOnChain ?? 0),
      auditStreak: Number(m.auditArrearsEvents ?? 0) === 0 ? Math.max(1, j.series?.length ?? 1) : 0,
      updatedAt: m.asOf ?? j.latest?.taken_at ?? new Date().toISOString(),
    };
  }, MOCK_METRICS);

/** The treasury address, read from the API so the frontend never hard-codes a deployment. */
export const getTreasuryAddress = async (): Promise<`0x${string}`> => (await fetchJson<Row>("/health")).treasury;

/** Runs/dry-runs a cycle through the same-origin Next route, which holds the admin key server-side. */
export const triggerCycle = async (dryRun = false): Promise<{ ok: boolean; message: string }> => {
  try {
    const r = await fetch("/api/cycle", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dryRun }) });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, message: r.ok ? "Queued for the worker." : j?.error ?? `HTTP ${r.status}` };
  } catch {
    return { ok: false, message: "Could not reach the frontend server." };
  }
};

// Signed approver actions that are not contract calls (invoice release/reject). Message format matches apps/backend/src/api/signed.ts.
export const signedMessage = (a: { action: string; target: string; verdict: string; nonce: string; issuedAt: string }) =>
  `Athena review\naction: ${a.action}\ntarget: ${a.target}\nverdict: ${a.verdict}\nnonce: ${a.nonce}\nissuedAt: ${a.issuedAt}`;

export async function postSigned(path: string, body: Record<string, unknown>): Promise<{ ok: boolean; message: string }> {
  const r = await fetch(`${API}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, message: r.ok ? "Done." : j?.error?.message ?? `HTTP ${r.status}` };
}
