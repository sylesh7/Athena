"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import Cursor from "@/components/Cursor";
import Nav from "@/components/Nav";
import { Footer } from "@/components/sections";
import { getStream, providerName, txLink, triggerStream, type StreamStatus } from "@/lib/api";

type StepState = "pending" | "active" | "done";

interface Step {
  icon: string;
  title: string;
  state: StepState;
  detail?: React.ReactNode;
}

function buildSteps(s: StreamStatus | null): Step[] {
  const revealed = s?.phase === "revealed" || s?.phase === "settled";
  const settled = s?.phase === "settled";
  const has = (v: unknown) => v !== null && v !== undefined;

  const commitLink = txLink(s?.commitTxHash);
  const revealLink = txLink(s?.revealTxHash);

  return [
    { icon: "⚡", title: "Athena Self-Setup", state: "done", detail: "Circle Agent Wallets + ERC-8004 identities ready" },
    { icon: "🔍", title: "Provider Discovery", state: s ? "done" : "pending", detail: s ? "Evaluated Arc providers by ERC-8004 reputation + price" : undefined },
    {
      icon: "🧠",
      title: "Routing Decision",
      state: revealed ? "done" : s ? "active" : "pending",
      detail: revealed ? `Selected ${providerName(s!)}` : s ? "Sealed until reveal" : undefined,
    },
    {
      icon: "🔒",
      title: "On-Chain Commit",
      state: has(s?.commitTxHash) ? "done" : s ? "active" : "pending",
      detail: commitLink ? <a className="sd-link mono" href={commitLink} target="_blank" rel="noreferrer">commit tx ↗</a> : "sealed hash landing on Arc",
    },
    {
      icon: "💰",
      title: "Bond Posted",
      state: has(s?.commitTxHash) ? "done" : "pending",
      detail: s?.erc8183JobId ? `ERC-8183 job #${BigInt(s.erc8183JobId).toString()} · 1.00 USDC escrowed` : undefined,
    },
    {
      icon: "📡",
      title: "Streaming",
      state: revealed ? "done" : s?.phase === "streaming" ? "active" : "pending",
      detail: s && s.callsCompleted > 0 ? `${s.callsCompleted} paid calls · last quality ${s.lastQualityScore?.toFixed?.(2) ?? "—"}` : undefined,
    },
    {
      icon: "🔓",
      title: "Reveal",
      state: revealed ? "done" : "pending",
      detail: revealed ? (revealLink ? <a className="sd-link mono" href={revealLink} target="_blank" rel="noreferrer">reveal tx ↗</a> : "hash unlocked") : undefined,
    },
    {
      icon: settled ? (s?.bondStatus === "slashed" ? "❌" : "✅") : "🏁",
      title: settled ? (s?.bondStatus === "slashed" ? "Slashed" : "Settled") : "Outcome",
      state: settled ? "done" : "pending",
      detail: settled ? (s?.bondStatus === "slashed" ? "Prediction missed — bond slashed to client" : "Prediction held — bond released to broker") : undefined,
    },
  ];
}

function LiveInner() {
  const router = useRouter();
  const params = useSearchParams();
  const urlTask = params.get("task");
  const [taskId, setTaskId] = useState<string | null>(urlTask);
  const [s, setS] = useState<StreamStatus | null>(null);
  const [mode, setMode] = useState<"success" | "slash">("success");
  const [triggering, setTriggering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastGood = useRef<StreamStatus | null>(null);

  useEffect(() => {
    if (urlTask) setTaskId(urlTask);
  }, [urlTask]);

  useEffect(() => {
    if (!taskId) return;
    let active = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      try {
        const data = await getStream(taskId!, controller.signal);
        if (!active) return;
        lastGood.current = data;
        setS(data);
      } catch {
        /* keep last */
      }
      if (!active) return;
      const settled = lastGood.current?.phase === "settled" || lastGood.current?.phase === "failed";
      timer = setTimeout(tick, settled ? 10000 : 1500);
    }
    tick();
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [taskId]);

  async function onTrigger() {
    setTriggering(true);
    setError(null);
    setS(null);
    lastGood.current = null;
    try {
      const { taskId: id } = await triggerStream({ mode });
      setTaskId(id);
      router.replace(`/live?task=${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "trigger failed");
    } finally {
      setTriggering(false);
    }
  }

  const steps = buildSteps(s);
  const settled = s?.phase === "settled";

  return (
    <main className="dashboard-page">
      <section className="section">
        <div className="dash-head">
          <div>
            <div className="eyebrow">Live Stream View</div>
            <h1>Autonomous Stream Cycle</h1>
          </div>
          {taskId && (
            <Link className="btn-ghost" href={`/stream/${taskId}`}><span>Full detail →</span></Link>
          )}
        </div>

        <div className="live-controls">
          <div className="ns-modes live-modes">
            <button type="button" className={`ns-mode ${mode === "success" ? "ns-mode-on" : ""}`} onClick={() => setMode("success")}>
              <strong>Success</strong><span>bond releases</span>
            </button>
            <button type="button" className={`ns-mode ${mode === "slash" ? "ns-mode-on" : ""}`} onClick={() => setMode("slash")}>
              <strong>Slash</strong><span>bond slashes</span>
            </button>
          </div>
          <button type="button" className="btn-solid" disabled={triggering} onClick={onTrigger}>
            <span>{triggering ? "Triggering…" : "Trigger Demo Stream"}</span>
          </button>
        </div>
        {error && <div className="ns-error-box">✗ {error}</div>}

        <div className="live-timeline">
          {steps.map((step, i) => (
            <div className={`live-step live-${step.state}`} key={i}>
              <div className="live-step-icon">{step.icon}</div>
              <div className="live-step-body">
                <div className="live-step-title">{step.title}</div>
                {step.detail && <div className="live-step-detail">{step.detail}</div>}
              </div>
              {i < steps.length - 1 && <div className="live-connector" />}
            </div>
          ))}
        </div>

        {settled && (
          <div className={`live-outcome ${s?.bondStatus === "slashed" ? "live-outcome-slash" : "live-outcome-ok"}`}>
            {s?.bondStatus === "slashed"
              ? "Bond slashed to client — Athena's prediction did not hold."
              : "Bond released to broker — Athena's prediction held, verifiably."}
          </div>
        )}
      </section>
    </main>
  );
}

export default function LivePage() {
  return (
    <>
      <Cursor />
      <Nav />
      <Suspense fallback={<main className="dashboard-page"><section className="section"><div className="session-empty">Loading…</div></section></main>}>
        <LiveInner />
      </Suspense>
      <Footer />
    </>
  );
}
