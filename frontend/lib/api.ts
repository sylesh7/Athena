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

export type DecisionKind = "PAY" | "PAY_EARLY" | "HOLD" | "NO_OP" | "ESCALATE";
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

// ── API fetchers (fall back to mock when backend is offline) ──────────────

async function get<T>(path: string, mock: T): Promise<T> {
  try {
    const res = await fetch(`${API}${path}`, { cache: "no-store" });
    if (!res.ok) return mock;
    return (await res.json()) as T;
  } catch {
    return mock;
  }
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
    { id: "yp-001", vault: "Morpho USDC", protocol: "Morpho Blue", token: "USDC", principal: "12000000000", currentValue: "12148320000", apy: 4.92, depositedAt: "2026-09-15T10:00:00Z" },
    { id: "yp-002", vault: "Morpho USDC-2", protocol: "Morpho Blue", token: "USDC", principal: "8000000000", currentValue: "8065440000", apy: 4.08, depositedAt: "2026-09-22T14:00:00Z" },
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
  { id: "0xdec002aabbccddee001122334455667788990011aabbccddee001122334455668", kind: "PAY_EARLY", state: "revealed", payeeName: "Acme Hosting", token: "USDC", amount: "299000000", rationale: "Early payment discount of 2% APR beats best vault yield (4.08%). Capturing $0.16 discount on $299 subscription.", commitTx: "0xbcd221", executeTx: "0xbcd222", revealTx: "0xbcd223", createdAt: "2026-10-09T09:15:00Z", revealedAt: "2026-10-09T09:17:02Z", decisionHash: "0x8e4c2a...", obligationId: "obl-002" },
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

// ── API functions ──────────────────────────────────────────────────────────

export const getTreasuryOverview = () => get<TreasuryOverview>("/treasury/overview", MOCK_OVERVIEW);
export const getObligations = (status?: string) => get<Obligation[]>(`/obligations${status ? `?status=${status}` : ""}`, MOCK_OBLIGATIONS);
export const getHeldInvoices = () => get<Invoice[]>("/invoices?status=held", MOCK_INVOICES);
export const getDecisions = () => get<Decision[]>("/decisions", MOCK_DECISIONS);
export const getDecision = (id: string) => get<Decision>(`/decisions/${id}`, MOCK_DECISIONS[0]);
export const getDecisionVerify = (id: string) => get<DecisionVerify>(`/decisions/${id}/verify`, { recordBytes: "0x7b226b696e64223a225041...}", onchainDecisionHash: "0x7f3a9bcc4d2e1f...", recomputedSha256: "0x7f3a9bcc4d2e1f...", match: true, revealTx: "0xabc113" });
export const getEscalations = () => get<Escalation[]>("/escalations", MOCK_ESCALATIONS);
export const getPayees = () => get<Payee[]>("/payees", MOCK_PAYEES);
export const getReceivables = () => get<Receivable[]>("/receivables", MOCK_RECEIVABLES);
export const getCrosschain = () => get<CrossChainTransfer[]>("/crosschain", MOCK_CROSSCHAIN);
export const getMetrics = () => get<MetricsSnapshot>("/metrics", MOCK_METRICS);
export const triggerCycle = (dryRun = false) =>
  fetch(`${API}/admin/cycle/${dryRun ? "dry-run" : "run"}`, { method: "POST" }).catch(() => null);
