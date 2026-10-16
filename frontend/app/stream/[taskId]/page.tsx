"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Cursor from "@/components/Cursor";
import Nav from "@/components/Nav";
import { Footer } from "@/components/sections";
import {
  displayStatus,
  getStream,
  providerName,
  txLink,
  usdcStreamed,
  type DisplayStatus,
  type StreamStatus,
} from "@/lib/api";

const BADGE_CLASS: Record<DisplayStatus, string> = {
  Committed: "badge-committed",
  Streaming: "badge-streaming",
  Revealed: "badge-revealed",
  Settled: "badge-settled",
  Slashed: "badge-slashed",
  Failed: "badge-slashed",
};

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return "0x" + Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function short(v?: string | null, head = 10, tail = 8) {
  if (!v) return "—";
  return v.length > head + tail ? `${v.slice(0, head)}…${v.slice(-tail)}` : v;
}

function avg(nums: number[]): number | null {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

export default function StreamDetailPage() {
  const params = useParams<{ taskId: string }>();
  const taskId = params.taskId;
  const [s, setS] = useState<StreamStatus | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [verify, setVerify] = useState<"idle" | "ok" | "fail">("idle");
  const lastGood = useRef<StreamStatus | null>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;

    async function tick() {
      try {
        const data = await getStream(taskId, controller.signal);
        if (!active) return;
        lastGood.current = data;
        setS(data);
        setNotFound(false);
      } catch (err) {
        if (!active || controller.signal.aborted) return;
        if (!lastGood.current) setNotFound(true);
      }
      if (!active) return;
      const settled = s?.phase === "settled" || s?.phase === "failed";
      timer = setTimeout(tick, settled ? 10000 : 2000);
    }
    tick();
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  // Independently recompute SHA-256(decisionPreimage) once revealed and compare
  // to the on-chain commit hash — the whole tamper-evidence claim, in-browser.
  useEffect(() => {
    if (!s?.decisionPreimage || !s.commitHash) {
      setVerify("idle");
      return;
    }
    sha256Hex(s.decisionPreimage).then((h) => setVerify(h === s.commitHash ? "ok" : "fail"));
  }, [s?.decisionPreimage, s?.commitHash]);

  if (notFound) {
    return (
      <>
        <Cursor />
        <Nav />
        <main className="dashboard-page">
          <section className="section">
            <div className="eyebrow">Stream Detail</div>
            <h1>Stream not found</h1>
            <p className="sd-muted">
              No stream with taskId <span className="mono">{short(taskId)}</span> in the backend&apos;s memory.
              It may have been from a previous backend session (in-memory state resets on restart).
            </p>
            <Link className="btn-ghost" href="/dashboard"><span>← Back to Dashboard</span></Link>
          </section>
        </main>
        <Footer />
      </>
    );
  }

  const revealed = s?.phase === "revealed" || s?.phase === "settled";
  const actualQuality = s ? avg(s.callHistory.map((c) => c.qualityScore)) : null;
  const actualLatency = s ? avg(s.callHistory.map((c) => c.latencyMs)) : null;
  const status = s ? displayStatus(s) : "Committed";

  return (
    <>
      <Cursor />
      <Nav />
      <main className="dashboard-page">
        <section className="section">
          <div className="dash-head">
            <div>
              <div className="eyebrow">Stream Detail</div>
              <h1 className="mono sd-taskid">{short(taskId, 12, 10)}</h1>
            </div>
            {s && <span className={`badge ${BADGE_CLASS[status]}`}>{status}</span>}
          </div>

          {!s ? (
            <div className="session-empty">Loading stream…</div>
          ) : (
            <div className="sd-grid">
              {/* Section A — Commitment */}
              <div className="sd-section">
                <div className="sd-section-head">
                  <span className="sd-index">A</span> Commitment · sealed before anything ran
                </div>
                <Row label="Bond posted" value={`${s.callHistory.length >= 0 ? "1.000000" : "—"} USDC`} />
                <Row
                  label="Commit hash"
                  value={revealed ? short(s.commitHash, 12, 10) : "•••• sealed until reveal"}
                  mono={revealed}
                />
                <Row label="ERC-8183 job" value={s.erc8183JobId ? String(BigInt(s.erc8183JobId)) : "—"} mono />
                <LinkRow label="Commit tx" hash={s.commitTxHash} />
              </div>

              {/* Section B — Stream */}
              <div className="sd-section">
                <div className="sd-section-head">
                  <span className="sd-index">B</span> Stream · live per-call feed
                  <span className="sd-runtotal">{usdcStreamed(s).toFixed(6)} USDC streamed</span>
                </div>
                {s.callHistory.length === 0 ? (
                  <div className="sd-muted sd-pad">No calls yet.</div>
                ) : (
                  <div className="call-feed">
                    <div className="call-row call-head">
                      <span>#</span><span>Quality</span><span>Latency</span><span>MCP verdict</span>
                    </div>
                    {s.callHistory.map((c) => {
                      const pass = c.qualityMet && c.latencyMet;
                      return (
                        <div className="call-row" key={c.callNumber}>
                          <span className="mono">{c.callNumber}</span>
                          <span className={`mono ${c.qualityMet ? "met" : "miss"}`}>{c.qualityScore.toFixed(2)}</span>
                          <span className={`mono ${c.latencyMet ? "met" : "miss"}`}>{c.latencyMs}ms</span>
                          <span className={pass ? "verdict-continue" : "verdict-slash"}>
                            {pass ? "continue" : "miss"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Section C — Reveal & Outcome */}
              <div className="sd-section">
                <div className="sd-section-head"><span className="sd-index">C</span> Reveal &amp; Outcome</div>
                {!revealed ? (
                  <div className="sd-muted sd-pad">Sealed — the routing decision unlocks once the stream reveals.</div>
                ) : (
                  <>
                    <div className={`verify-badge verify-${verify}`}>
                      {verify === "ok"
                        ? "Verified · sha256(preimage) matches the on-chain commit hash — the decision was provably unaltered"
                        : verify === "fail"
                          ? "Mismatch · recomputed hash does not match the on-chain commit"
                          : "Verifying…"}
                    </div>
                    <PredVsActual
                      label="Quality"
                      predicted={s.predictedQualityScore}
                      actual={actualQuality}
                      met={actualQuality !== null && s.predictedQualityScore !== undefined && actualQuality >= s.predictedQualityScore}
                      fmt={(n) => n.toFixed(2)}
                    />
                    <PredVsActual
                      label="Latency"
                      predicted={s.predictedLatencyMs}
                      actual={actualLatency}
                      met={actualLatency !== null && s.predictedLatencyMs !== undefined && actualLatency <= s.predictedLatencyMs}
                      fmt={(n) => `${Math.round(n)}ms`}
                      lowerIsBetter
                    />
                    <Row label="Selected provider" value={providerName(s)} />
                    <Row
                      label="Bond outcome"
                      value={s.bondStatus === "released" ? "Released to broker" : s.bondStatus === "slashed" ? "Slashed to client" : "—"}
                    />
                    <LinkRow label="Reveal tx" hash={s.revealTxHash} />
                    {s.decisionPreimage && (
                      <div className="sd-preimage">
                        <div className="sd-label">Decision preimage (verify yourself)</div>
                        <code className="sd-preimage-code">{s.decisionPreimage}</code>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          <div className="sd-back">
            <Link className="btn-ghost" href="/dashboard"><span>← Dashboard</span></Link>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="sd-row">
      <span className="sd-label">{label}</span>
      <span className={mono ? "mono sd-rowval" : "sd-rowval"}>{value}</span>
    </div>
  );
}

function LinkRow({ label, hash }: { label: string; hash?: string | null }) {
  const link = txLink(hash);
  return (
    <div className="sd-row">
      <span className="sd-label">{label}</span>
      {link ? (
        <a className="mono sd-rowval sd-link" href={link} target="_blank" rel="noreferrer">
          {short(hash, 10, 8)} ↗
        </a>
      ) : (
        <span className="sd-rowval">—</span>
      )}
    </div>
  );
}

function PredVsActual({
  label,
  predicted,
  actual,
  met,
  fmt,
  lowerIsBetter,
}: {
  label: string;
  predicted?: number;
  actual: number | null;
  met: boolean;
  fmt: (n: number) => string;
  lowerIsBetter?: boolean;
}) {
  return (
    <div className="sd-row">
      <span className="sd-label">{label}</span>
      <span className="sd-rowval mono">
        pred {lowerIsBetter ? "≤" : "≥"} {predicted !== undefined ? fmt(predicted) : "—"} · actual{" "}
        {actual !== null ? fmt(actual) : "—"} · <span className={met ? "met" : "miss"}>{met ? "MET" : "MISS"}</span>
      </span>
    </div>
  );
}
