"use client";

import { useEffect, useState } from "react";
import Cursor from "@/components/Cursor";
import Nav from "@/components/Nav";
import Reveal from "@/components/Reveal";
import { Footer } from "@/components/sections";
import { getAgents, type Agent } from "@/lib/api";

function short(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    async function tick() {
      try {
        const data = await getAgents(controller.signal);
        if (active) {
          setAgents(data);
          setError(false);
        }
      } catch {
        if (active && !controller.signal.aborted) setError(true);
      }
    }
    tick();
    const id = setInterval(tick, 8000);
    return () => {
      active = false;
      controller.abort();
      clearInterval(id);
    };
  }, []);

  return (
    <>
      <Cursor />
      <Nav />
      <main className="dashboard-page">
        <section className="section">
          <div className="eyebrow">Agent Roster</div>
          <h1>Registered Agents</h1>
          <p className="sd-muted ns-intro">
            Athena&apos;s broker and its provider agents — each a real ERC-8004 on-chain identity on Arc,
            with live reputation accrued from settled streams.
          </p>

          {error && !agents && (
            <div className="session-empty">
              Can&apos;t reach the backend. Start it with <span className="mono">npm run dev</span> in backend/.
            </div>
          )}
          {!agents && !error && <div className="session-empty">Loading agents…</div>}

          {agents && (
            <Reveal className="agent-grid">
              {agents.map((a) => {
                const rep = a.reputation.avgQuality;
                return (
                  <div className="agent-card" key={a.key}>
                    <div className="agent-role">{a.role}</div>
                    <div className="agent-name">{a.name}</div>
                    <div className="agent-rows">
                      <div className="agent-line">
                        <span className="sd-label">Address</span>
                        <a className="mono sd-link" href={a.arcscan} target="_blank" rel="noreferrer">
                          {short(a.address)} ↗
                        </a>
                      </div>
                      <div className="agent-line">
                        <span className="sd-label">ERC-8004 token</span>
                        <span className="mono">#{a.tokenId}</span>
                      </div>
                      <div className="agent-line">
                        <span className="sd-label">Custody</span>
                        <span className="mono">{a.custody === "circle-dcw" ? "Circle DCW" : "EOA"}</span>
                      </div>
                      <div className="agent-line">
                        <span className="sd-label">USDC balance</span>
                        <span className="mono">{a.usdcBalance.toFixed(6)}</span>
                      </div>
                      <div className="agent-line">
                        <span className="sd-label">Reputation</span>
                        <span className="mono">
                          {rep === null ? "no history yet" : `${(rep * 100).toFixed(0)}% · ${a.reputation.sampleSize} reviews`}
                        </span>
                      </div>
                    </div>
                    {rep !== null && (
                      <div className="agent-rep-bar">
                        <div className="agent-rep-fill" style={{ width: `${Math.round(rep * 100)}%` }} />
                      </div>
                    )}
                  </div>
                );
              })}
            </Reveal>
          )}
        </section>
      </main>
      <Footer />
    </>
  );
}
