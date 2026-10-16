/**
 * stream/state.ts — in-memory status store for /stream-status/:taskId
 * (Phase 3.5, H7/H8). One process's memory, not persisted — acceptable for
 * a hackathon demo where the entrypoint process lives for the demo's
 * duration; a restart loses in-flight stream progress (on-chain commit/reveal
 * state is unaffected since that lives in AthenaCommit, not here).
 */

export type StreamPhase = "committing" | "streaming" | "revealed" | "settled" | "failed";
export type BondStatus = "posted" | "released" | "slashed";

// Phase 4 (stretch, Provider 3 only) — see cctp/crossChainPayout.ts.
// Absent entirely for streams that never triggered a cross-chain payout.
export type CctpStatus = "pending" | "burned" | "attested" | "minted" | "failed";

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
  // Sealed until phase === "revealed" — the routing decision (which provider,
  // what was predicted) is not exposed early. See sealCommitment/getSealedCommitment
  // below for the mechanism that keeps this true.
  selectedProviderUrl?: string;
  predictedQualityScore?: number;
  predictedLatencyMs?: number;
  // Safe to expose live — these are already-observed facts about calls that
  // already happened, not the sealed prediction they're compared against.
  callsCompleted: number;
  lastQualityScore: number | null;
  lastLatencyMs: number | null;
  callHistory: CallRecord[];
  predictionMet: boolean | null; // null until revealed
  bondStatus: BondStatus | null;
  commitTxHash: `0x${string}` | null;
  revealTxHash: `0x${string}` | null;
  // Not sensitive (unlike the sealed fields above) — just a public on-chain
  // job reference, ZERO_BYTES32 if ERC-8183 setup failed for this stream
  // (see lib/erc8183.ts; non-fatal by design, the core flow still settles).
  erc8183JobId: `0x${string}` | null;
  // Populated only once revealed — see sealCommitment/getSealedCommitment.
  // Lets anyone independently recompute SHA-256(decisionPreimage) and diff it
  // against getCommitment(taskId).commitHash read directly on-chain.
  commitHash: `0x${string}` | null;
  decisionPreimage: string | null;
  // True only if the pre-reveal integrity recompute (see streamLoop.ts)
  // didn't match the sealed hash — a regression/corruption signal, not
  // something that should ever fire in normal operation.
  preimageIntegrityWarning: boolean;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  cctpStatus?: CctpStatus;
  cctpBurnTxHash?: `0x${string}`;
  cctpMintTxHash?: `0x${string}`;
  cctpError?: string;
}

const streams = new Map<string, StreamStatus>();

export function initStream(taskId: `0x${string}`, initial: Partial<StreamStatus> = {}): StreamStatus {
  const now = Date.now();
  const status: StreamStatus = {
    taskId,
    phase: "committing",
    callsCompleted: 0,
    lastQualityScore: null,
    lastLatencyMs: null,
    callHistory: [],
    predictionMet: null,
    bondStatus: null,
    commitTxHash: null,
    revealTxHash: null,
    erc8183JobId: null,
    commitHash: null,
    decisionPreimage: null,
    preimageIntegrityWarning: false,
    error: null,
    createdAt: now,
    updatedAt: now,
    ...initial,
  };
  streams.set(taskId, status);
  return status;
}

export function updateStream(taskId: `0x${string}`, patch: Partial<StreamStatus>): StreamStatus {
  const existing = streams.get(taskId) ?? initStream(taskId);
  const updated: StreamStatus = { ...existing, ...patch, updatedAt: Date.now() };
  streams.set(taskId, updated);
  return updated;
}

export function getStream(taskId: string): StreamStatus | undefined {
  return streams.get(taskId);
}

export function listStreams(): StreamStatus[] {
  return Array.from(streams.values()).sort((a, b) => b.createdAt - a.createdAt);
}

// Sealed commitment store — deliberately NOT part of StreamStatus and never
// touched by getStream()/listStreams(), so the decision preimage/hash is
// structurally impossible to leak through the public API before reveal.
// streamLoop.ts seals it right after computing the commit hash, and only
// copies it into the public StreamStatus (via updateStream) once the stream
// is actually revealed.
const sealedCommitments = new Map<string, { commitHash: `0x${string}`; decisionPreimage: string }>();

export function sealCommitment(taskId: `0x${string}`, commitHash: `0x${string}`, decisionPreimage: string): void {
  sealedCommitments.set(taskId, { commitHash, decisionPreimage });
}

export function getSealedCommitment(taskId: string): { commitHash: `0x${string}`; decisionPreimage: string } | undefined {
  return sealedCommitments.get(taskId);
}
