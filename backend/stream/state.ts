/**
 * stream/state.ts — in-memory status store for /stream-status/:taskId
 * (Phase 3.5, H7/H8). One process's memory, not persisted — acceptable for
 * a hackathon demo where the entrypoint process lives for the demo's
 * duration; a restart loses in-flight stream progress (on-chain commit/reveal
 * state is unaffected since that lives in AthenaCommit, not here).
 */

export type StreamPhase = "committing" | "streaming" | "revealed" | "settled" | "failed";
export type BondStatus = "posted" | "released" | "slashed";

export interface StreamStatus {
  taskId: `0x${string}`;
  phase: StreamPhase;
  selectedProviderUrl?: string;
  predictedQualityScore?: number;
  predictedLatencyMs?: number;
  callsCompleted: number;
  lastQualityScore: number | null;
  lastLatencyMs: number | null;
  predictionMet: boolean | null; // null until revealed
  bondStatus: BondStatus | null;
  commitTxHash: `0x${string}` | null;
  revealTxHash: `0x${string}` | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
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
    predictionMet: null,
    bondStatus: null,
    commitTxHash: null,
    revealTxHash: null,
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
