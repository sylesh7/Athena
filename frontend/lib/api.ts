/**
 * lib/api.ts — typed client for Athena's backend entrypoint.
 *
 * The backend (Backend B) runs on http://localhost:3100 by default (it moved
 * off :3000 so it doesn't collide with this Next.js dev server). Override with
 * NEXT_PUBLIC_ATHENA_API if it's hosted elsewhere.
 *
 * Types here mirror backend/stream/state.ts's StreamStatus exactly — keep them
 * in sync. Note the sealed-until-reveal fields (selectedProviderUrl,
 * predicted*, commitHash, decisionPreimage) are undefined/null until
 * phase === "revealed".
 */

export const ATHENA_API = process.env.NEXT_PUBLIC_ATHENA_API ?? "http://localhost:3100";

// Each streamed call is a $0.000001 USDC nanopayment (providerServer.ts).
export const PER_CALL_USDC = 0.000001;

export type StreamPhase = "committing" | "streaming" | "revealed" | "settled" | "failed";
export type BondStatus = "posted" | "released" | "slashed";

export interface CallRecord {
  callNumber: number;
  qualityScore: number;
  latencyMs: number;
  qualityMet: boolean;
  latencyMet: boolean;
}

export interface StreamStatus {
  taskId: `0x${string}`;
  phase: StreamPhase;
  selectedProviderUrl?: string;
  predictedQualityScore?: number;
  predictedLatencyMs?: number;
  callsCompleted: number;
  lastQualityScore: number | null;
  lastLatencyMs: number | null;
  callHistory: CallRecord[];
  predictionMet: boolean | null;
  bondStatus: BondStatus | null;
  commitTxHash: `0x${string}` | null;
  revealTxHash: `0x${string}` | null;
  erc8183JobId: `0x${string}` | null;
  commitHash: `0x${string}` | null;
  decisionPreimage: string | null;
  preimageIntegrityWarning: boolean;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

export async function getStreams(signal?: AbortSignal): Promise<StreamStatus[]> {
  const res = await fetch(`${ATHENA_API}/streams`, { signal, cache: "no-store" });
  if (!res.ok) throw new Error(`GET /streams -> ${res.status}`);
  return (await res.json()) as StreamStatus[];
}

export async function getStream(taskId: string, signal?: AbortSignal): Promise<StreamStatus> {
  const res = await fetch(`${ATHENA_API}/stream-status/${taskId}`, { signal, cache: "no-store" });
  if (!res.ok) throw new Error(`GET /stream-status/${taskId} -> ${res.status}`);
  return (await res.json()) as StreamStatus;
}

export interface Agent {
  key: string;
  name: string;
  role: string;
  address: `0x${string}`;
  tokenId: string;
  custody: string;
  usdcBalance: number;
  reputation: { avgQuality: number | null; sampleSize: number };
  arcscan: string;
}

export async function getAgents(signal?: AbortSignal): Promise<Agent[]> {
  const res = await fetch(`${ATHENA_API}/agents`, { signal, cache: "no-store" });
  if (!res.ok) throw new Error(`GET /agents -> ${res.status}`);
  return ((await res.json()) as { agents: Agent[] }).agents;
}

/**
 * Trigger a real on-chain stream server-side (the x402 payment is genuine,
 * just initiated by the backend so the browser doesn't need an x402 payer).
 * Returns the taskId to navigate to Stream Detail / Live View.
 */
export async function triggerStream(
  opts: { taskDescription?: string; mode?: "success" | "slash" } = {}
): Promise<{ taskId: `0x${string}`; statusUrl: string; mode: string }> {
  const res = await fetch(`${ATHENA_API}/demo/trigger-stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error ?? `trigger-stream -> ${res.status}`);
  return json as { taskId: `0x${string}`; statusUrl: string; mode: string };
}

export const EXPLORER = "https://testnet.arcscan.app";
export const txLink = (hash?: string | null) => (hash ? `${EXPLORER}/tx/${hash}` : null);

// ── display mappers ────────────────────────────────────────────────────────

export type DisplayStatus = "Committed" | "Streaming" | "Revealed" | "Settled" | "Slashed" | "Failed";

/** Collapse (phase, bondStatus) into the single badge the UI shows. */
export function displayStatus(s: StreamStatus): DisplayStatus {
  if (s.phase === "failed") return "Failed";
  if (s.phase === "settled") return s.bondStatus === "slashed" ? "Slashed" : "Settled";
  if (s.phase === "revealed") return "Revealed";
  if (s.phase === "streaming") return "Streaming";
  return "Committed";
}

const PROVIDER_BY_PORT: Record<string, string> = {
  "3001": "Crypto Price",
  "3002": "Market Analytics",
  "3003": "Price Feed",
};

/** Provider is sealed until reveal — surface that honestly rather than faking a name. */
export function providerName(s: StreamStatus): string {
  if (!s.selectedProviderUrl) return "Sealed until reveal";
  const port = s.selectedProviderUrl.match(/:(\d+)\b/)?.[1];
  return port && PROVIDER_BY_PORT[port] ? `Provider — ${PROVIDER_BY_PORT[port]}` : s.selectedProviderUrl;
}

export function usdcStreamed(s: StreamStatus): number {
  return s.callsCompleted * PER_CALL_USDC;
}

export interface DashboardStatsData {
  totalStreams: number;
  totalUsdc: number;
  slashRate: number; // % of settled streams that slashed
  avgAccuracy: number; // % of resolved streams where the prediction held
}

export function computeStats(list: StreamStatus[]): DashboardStatsData {
  const settled = list.filter((s) => s.phase === "settled");
  const slashed = settled.filter((s) => s.bondStatus === "slashed").length;
  const resolved = list.filter((s) => s.predictionMet !== null);
  const met = resolved.filter((s) => s.predictionMet === true).length;
  return {
    totalStreams: list.length,
    totalUsdc: list.reduce((sum, s) => sum + usdcStreamed(s), 0),
    slashRate: settled.length ? (slashed / settled.length) * 100 : 0,
    avgAccuracy: resolved.length ? (met / resolved.length) * 100 : 0,
  };
}
