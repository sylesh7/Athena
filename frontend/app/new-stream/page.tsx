"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Cursor from "@/components/Cursor";
import Nav from "@/components/Nav";
import { Footer } from "@/components/sections";
import { triggerStream } from "@/lib/api";

type Mode = "success" | "slash";
type Phase = "idle" | "paying" | "error";

export default function NewStreamPage() {
  const router = useRouter();
  const [description, setDescription] = useState("Get the USDC/ETH price every second and verify quality live");
  const [mode, setMode] = useState<Mode>("success");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  const descError = description.trim().length < 10 ? "Minimum 10 characters" : null;
  const canSubmit = !descError && phase !== "paying";

  async function onSubmit() {
    if (!canSubmit) return;
    setPhase("paying");
    setError(null);
    try {
      const { taskId } = await triggerStream({ taskDescription: description.trim(), mode });
      router.push(`/live?task=${taskId}`);
    } catch (err) {
      setPhase("error");
      setError(err instanceof Error ? err.message : "Failed to start stream");
    }
  }

  return (
    <>
      <Cursor />
      <Nav />
      <main className="dashboard-page">
        <section className="section ns-section">
          <div className="eyebrow">New Stream</div>
          <h1>Start a Stream</h1>
          <p className="sd-muted ns-intro">
            You act as the client. Athena discovers a provider, commits a hashed prediction + USDC bond,
            streams paid nanopayment calls, then reveals — the bond releases or slashes based on whether
            reality matched. Every step lands on Arc.
          </p>

          <label className="ns-field">
            <span className="sd-label">Task description</span>
            <textarea
              className="ns-input"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Get USDC/ETH price every second for 60 seconds"
            />
            {descError && <span className="ns-err">{descError}</span>}
          </label>

          <div className="ns-field">
            <span className="sd-label">Outcome to demonstrate</span>
            <div className="ns-modes">
              <button
                type="button"
                className={`ns-mode ${mode === "success" ? "ns-mode-on" : ""}`}
                onClick={() => setMode("success")}
              >
                <strong>Success</strong>
                <span>Organic prediction — bond should release</span>
              </button>
              <button
                type="button"
                className={`ns-mode ${mode === "slash" ? "ns-mode-on" : ""}`}
                onClick={() => setMode("slash")}
              >
                <strong>Slash</strong>
                <span>Forces an unmeetable prediction — bond slashes</span>
              </button>
            </div>
          </div>

          <div className="ns-cost">
            <span className="sd-label">Estimated cost</span>
            <span className="mono">$0.01 session fee + ~$0.00001 stream nanopayments + 1.00 USDC bond (returned if prediction holds)</span>
          </div>

          <div className="ns-actions">
            <button type="button" className="btn-solid" disabled={!canSubmit} onClick={onSubmit}>
              <span>{phase === "paying" ? "Starting stream…" : "Start Stream"}</span>
            </button>
            <Link className="btn-ghost" href="/dashboard"><span>Cancel</span></Link>
          </div>

          {phase === "paying" && (
            <div className="ns-steps">
              <div className="ns-step ns-step-on">1 · Paying $0.01 session fee via x402 (server-side, real)</div>
              <div className="ns-step ns-step-on">2 · Athena routing → commit hash + USDC bond on-chain</div>
              <div className="ns-step">3 · Redirecting to the live stream view…</div>
            </div>
          )}

          {error && <div className="ns-error-box">Error — {error}</div>}
        </section>
      </main>
      <Footer />
    </>
  );
}
