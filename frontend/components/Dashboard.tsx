"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import Reveal from "./Reveal";
import {
  computeStats,
  displayStatus,
  getStreams,
  providerName,
  usdcStreamed,
  type DisplayStatus,
  type StreamStatus,
} from "@/lib/api";

const POLL_MS = 4000;

const BADGE_CLASS: Record<DisplayStatus, string> = {
  Committed: "badge-committed",
  Streaming: "badge-streaming",
  Revealed: "badge-revealed",
  Settled: "badge-settled",
  Slashed: "badge-slashed",
  Failed: "badge-slashed",
};

function truncate(value: string) {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function StatusBadge({ status }: { status: DisplayStatus }) {
  return <span className={`badge ${BADGE_CLASS[status]}`}>{status}</span>;
}

/**
 * Live dashboard — polls the backend's GET /streams every few seconds and
 * renders the stat tiles + session list from real in-flight/settled streams.
 * /streams is the backend's in-memory store, so it reflects streams from the
 * current backend session; a backend restart clears it (on-chain state is
 * unaffected). Handles loading / empty / backend-offline gracefully.
 */
export default function DashboardLive() {
  const [streams, setStreams] = useState<StreamStatus[] | null>(null);
  const [offline, setOffline] = useState(false);
  const lastGood = useRef<StreamStatus[] | null>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    async function tick() {
      try {
        const data = await getStreams(controller.signal);
        if (!active) return;
        // newest first
        data.sort((a, b) => b.createdAt - a.createdAt);
        lastGood.current = data;
        setStreams(data);
        setOffline(false);
      } catch (err) {
        if (!active || controller.signal.aborted) return;
        // keep showing the last good data instead of blanking on a transient blip
        setOffline(true);
        if (lastGood.current) setStreams(lastGood.current);
      }
    }

    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      active = false;
      controller.abort();
      clearInterval(id);
    };
  }, []);

  const stats = computeStats(streams ?? []);
  const loading = streams === null && !offline;

  const statTiles = [
    { label: "Total Streams", value: loading ? "—" : String(stats.totalStreams) },
    { label: "Total USDC Streamed", value: loading ? "—" : stats.totalUsdc.toFixed(6) },
    { label: "Slash Rate", value: loading ? "—" : `${stats.slashRate.toFixed(1)}%` },
    { label: "Avg. Prediction Accuracy", value: loading ? "—" : `${stats.avgAccuracy.toFixed(1)}%` },
  ];

  return (
    <>
      <Reveal className="div-grid dash-stats">
        {statTiles.map((stat) => (
          <div className="div-cell" key={stat.label}>
            <div className="stat-label">{stat.label}</div>
            <div className="stat-value mono">{stat.value}</div>
          </div>
        ))}
      </Reveal>

      <div className="dash-status-line">
        <span className={offline ? "conn-dot conn-off" : "conn-dot conn-live"} />
        {offline ? "Backend offline — showing last known data" : "Live"}
      </div>

      <div className="session-head">
        <span>Task ID</span>
        <span>Provider</span>
        <span>Status</span>
        <span>USDC Streamed</span>
        <span></span>
      </div>

      {streams && streams.length > 0 ? (
        <div className="session-list">
          {streams.map((s) => (
            <Link href={`/stream/${s.taskId}`} className="session-row" key={s.taskId}>
              <span className="mono">
                <span className="cell-label">Task ID</span>
                {truncate(s.taskId)}
              </span>
              <span>
                <span className="cell-label">Provider</span>
                {providerName(s)}
              </span>
              <span>
                <span className="cell-label">Status</span>
                <StatusBadge status={displayStatus(s)} />
              </span>
              <span className="mono">
                <span className="cell-label">USDC Streamed</span>
                {usdcStreamed(s).toFixed(6)} USDC
              </span>
              <span className="row-view">View</span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="session-empty">
          {loading
            ? "Loading streams…"
            : offline
              ? "Can't reach the backend at the configured API URL. Start it with `npm run dev` in backend/."
              : "No streams yet. Start one from New Stream and it'll appear here live."}
        </div>
      )}
    </>
  );
}
