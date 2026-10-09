"use client";

import { useEffect, useState } from "react";
import Nav from "@/components/Nav";
import Amount from "@/components/Amount";
import StatusBadge from "@/components/StatusBadge";
import {
  getTreasuryOverview, triggerCycle,
  type TreasuryOverview, type SSEEvent, MOCK_FEED, formatUnits,
} from "@/lib/api";

function timeSince(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

function feedLabel(type: string) {
  return type.replace(/\./g, " ").toUpperCase();
}

function feedMsg(e: SSEEvent): string {
  const d = e.data as Record<string, string>;
  if (e.type === "decision.revealed") return `Revealed: ${d.payee} · ${formatUnits(d.amount)} ${d.token}`;
  if (e.type === "decision.committed") return `Committed: ${d.payee} · ${formatUnits(d.amount)} ${d.token}`;
  if (e.type === "decision.escalated") return `Escalated: ${d.payee} · ${d.reason}`;
  if (e.type === "cycle.step") return `Cycle step: ${d.step} — ${d.status}`;
  if (e.type === "payment.in") return `Payment received: ${d.from} · ${formatUnits(d.amount)} ${d.token}`;
  return JSON.stringify(d);
}

export default function DashboardPage() {
  const [data, setData] = useState<TreasuryOverview | null>(null);
  const [feed, setFeed] = useState<SSEEvent[]>(MOCK_FEED);
  const [running, setRunning] = useState(false);
  const [cycleMsg, setCycleMsg] = useState<string | null>(null);

  useEffect(() => {
    getTreasuryOverview().then(setData);
  }, []);

  const usdc = data?.balances.find((b) => b.token === "USDC");
  const eurc = data?.balances.find((b) => b.token === "EURC");

  async function handleCycle(dry: boolean) {
    setRunning(true);
    setCycleMsg(null);
    await triggerCycle(dry);
    setCycleMsg(dry ? "Dry-run complete — no transactions sent." : "Cycle triggered. Events will stream below.");
    setRunning(false);
  }

  return (
    <div className="tpage">
      <Nav />
      <main>
        <section className="section">
          <div className="page-head">
            <div>
              <div className="eyebrow">Treasury</div>
              <h1>Overview</h1>
            </div>
            <div className="page-head-actions">
              <button className="btn-ghost" onClick={() => handleCycle(true)} disabled={running}>
                <span>{running ? "Running…" : "Dry Run"}</span>
              </button>
              <button className="btn-solid" onClick={() => handleCycle(false)} disabled={running}>
                <span>Run Cycle</span>
              </button>
            </div>
          </div>

          {cycleMsg && (
            <div style={{ padding: ".8rem 1rem", border: "1px solid var(--gold)", color: "var(--gold-glow)", fontSize: ".78rem", marginBottom: "1.4rem" }}>
              {cycleMsg}
            </div>
          )}

          {/* Cycle strip */}
          {data && (
            <div className="cycle-strip">
              <div className="cycle-info">
                Last cycle: <strong>{data.lastCycleAt ? timeSince(data.lastCycleAt) : "—"}</strong>
              </div>
              <div className="cycle-info">
                Overdue reveals: <strong style={{ color: data.overdueCount > 0 ? "var(--rust-glow)" : "#6bff9f" }}>{data.overdueCount}</strong>
              </div>
              <div className="cycle-info">
                Status: <StatusBadge status={data.paused ? "held" : "active"} />
              </div>
              <div className="cycle-info">
                Runway: <strong>{data.runwayDays} days</strong>
              </div>
            </div>
          )}

          {/* Stat cards */}
          <div className="stat-grid">
            <div className="stat-card">
              <div className="sv">{usdc ? formatUnits(usdc.free) : "—"}</div>
              <div className="sl">Free USDC</div>
              <div className="sc">of {usdc ? formatUnits(usdc.balance) : "—"} total</div>
            </div>
            <div className="stat-card">
              <div className="sv">{usdc ? formatUnits(usdc.reserved) : "—"}</div>
              <div className="sl">Reserved USDC</div>
              <div className="sc">floor: {usdc ? formatUnits(usdc.floor) : "—"}</div>
            </div>
            <div className="stat-card">
              <div className="sv">{eurc ? formatUnits(eurc.free) : "—"}</div>
              <div className="sl">Free EURC</div>
              <div className="sc">of {eurc ? formatUnits(eurc.balance) : "—"} total</div>
            </div>
            <div className="stat-card">
              <div className="sv">{data?.runwayDays ?? "—"}</div>
              <div className="sl">Runway Days</div>
              <div className="sc">at current burn rate</div>
            </div>
          </div>

          {/* Budget bars */}
          <div className="section-label">Budget consumption</div>
          <table className="budget-table">
            <tbody>
              {(data?.budgets ?? []).map((b) => {
                const pct = Number((BigInt(b.used) * BigInt(100)) / BigInt(b.total));
                return (
                  <tr key={b.category}>
                    <td className="budget-cat">{b.category}</td>
                    <td>
                      <div className="budget-track">
                        <div className={`budget-fill${pct > 80 ? " warn" : ""}`} style={{ width: `${pct}%` }} />
                      </div>
                    </td>
                    <td className="budget-amt">
                      {formatUnits(b.used)} / {formatUnits(b.total)} {b.token} · <span style={{ color: pct > 80 ? "var(--rust-glow)" : "inherit" }}>{pct}%</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Yield positions */}
          {(data?.yieldPositions?.length ?? 0) > 0 && (
            <>
              <div className="section-label" style={{ marginTop: "2rem" }}>Yield positions</div>
              <table className="data-table" style={{ marginBottom: "2rem" }}>
                <thead>
                  <tr>
                    <th>Vault</th>
                    <th>Protocol</th>
                    <th className="right">Principal</th>
                    <th className="right">Current Value</th>
                    <th className="right">APY</th>
                  </tr>
                </thead>
                <tbody>
                  {data!.yieldPositions.map((p) => (
                    <tr key={p.id}>
                      <td>{p.vault}</td>
                      <td className="dim">{p.protocol}</td>
                      <td className="right"><Amount value={p.principal} token={p.token} /></td>
                      <td className="right gold"><Amount value={p.currentValue} token={p.token} /></td>
                      <td className="right gold">{p.apy.toFixed(2)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {/* Live feed */}
          <div className="live-feed">
            <div className="feed-head">
              <span className="feed-dot" />
              Live Events
            </div>
            {feed.map((e, i) => (
              <div className="feed-item" key={i}>
                <span className="feed-time">{timeSince(new Date(e.ts).toISOString())}</span>
                <span className="feed-type">{feedLabel(e.type)}</span>
                <span className="feed-msg">{feedMsg(e)}</span>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
