"use client";

import { useEffect, useState } from "react";
import Nav from "@/components/Nav";
import Amount from "@/components/Amount";
import StatusBadge from "@/components/StatusBadge";
import TxLink from "@/components/TxLink";
import { getMetrics, getCrosschain, getTreasuryOverview, type MetricsSnapshot, type CrossChainTransfer, type YieldPosition, formatUnits } from "@/lib/api";

function pct(a: number, b: number) {
  return b === 0 ? 0 : Math.round((a / b) * 100);
}

export default function MetricsPage() {
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);
  const [crosschain, setCrosschain] = useState<CrossChainTransfer[]>([]);
  const [yields, setYields] = useState<YieldPosition[]>([]);

  useEffect(() => {
    getMetrics().then(setMetrics);
    getCrosschain().then(setCrosschain);
    getTreasuryOverview().then((o) => setYields(o.yieldPositions));
  }, []);

  if (!metrics) return (
    <div className="tpage">
      <Nav />
      <main><section className="section"><div className="eyebrow">Loading…</div></section></main>
    </div>
  );

  const TILES = [
    { label: "Total USDC Paid", value: formatUnits(metrics.totalUsdcPaid), note: "USDC · " + metrics.network },
    { label: "Total USDC Received", value: formatUnits(metrics.totalUsdcReceived), note: "USDC · " + metrics.network },
    { label: "Obligations On Time", value: `${metrics.obligationsSettledOnTime}`, note: "no human required" },
    { label: "Decisions On-chain", value: `${metrics.decisionsOnChain}`, note: `${metrics.decisionsEscalated} escalated` },
    { label: "Invoices Processed", value: `${metrics.invoicesProcessed}`, note: `${metrics.duplicatesCaught} duplicates caught` },
    { label: "Discounts Captured", value: formatUnits(metrics.discountsCaptured), note: "USDC early-pay savings" },
    { label: "Funds Under Management", value: formatUnits(metrics.fundsUnderManagement), note: "USDC equivalent" },
    { label: "Yield Earned", value: formatUnits(metrics.yieldEarned), note: "USDC · " + metrics.network },
    { label: "Forecast Accuracy", value: `${metrics.forecastAccuracy.toFixed(1)}%`, note: "14-day rolling MAE" },
    { label: "Cross-chain Payouts", value: `${metrics.crossChainPayouts}`, note: "via CCTP V2" },
    { label: "Businesses Operated", value: `${metrics.businessesOperated}`, note: "entities on-chain" },
    { label: "Audit Streak", value: `${metrics.auditStreak}d`, note: "no overdue reveals" },
  ];

  const escRate = pct(metrics.decisionsEscalated, metrics.decisionsTotal);
  const onTimeRate = pct(metrics.obligationsSettledOnTime, metrics.decisionsTotal);

  return (
    <div className="tpage">
      <Nav />
      <main>
        <section className="section">
          <div className="page-head">
            <div>
              <div className="eyebrow">Traction · {metrics.network === "mainnet" ? "Mainnet" : "Arc Testnet"}</div>
              <h1>Metrics</h1>
            </div>
            <div style={{ fontSize: ".68rem", color: "var(--muted)", letterSpacing: ".1em" }}>
              Updated: {new Date(metrics.updatedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
            </div>
          </div>

          {/* Agent performance bar */}
          <div style={{ border: "1px solid var(--line)", padding: "1.2rem 1.4rem", marginBottom: "2rem", display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "1.2rem" }}>
            {[
              { label: "Autonomous rate", value: `${onTimeRate}%`, sub: "decisions without human" },
              { label: "Escalation rate", value: `${escRate}%`, sub: "required human approval" },
              { label: "Reveal compliance", value: metrics.auditStreak > 0 ? "100%" : "< 100%", sub: `${metrics.auditStreak}d streak` },
            ].map(({ label, value, sub }) => (
              <div key={label}>
                <div style={{ fontSize: "clamp(1.6rem,3vw,2.4rem)", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{value}</div>
                <div style={{ fontSize: ".62rem", letterSpacing: ".2em", color: "var(--muted)", textTransform: "uppercase", marginTop: ".3rem" }}>{label}</div>
                <div style={{ fontSize: ".6rem", color: "var(--muted-2)", marginTop: ".2rem" }}>{sub}</div>
              </div>
            ))}
          </div>

          {/* Metric tiles */}
          <div className="section-label">All metrics</div>
          <div className="metric-grid">
            {TILES.map((t) => (
              <div className="metric-tile" key={t.label}>
                <div className="mv">{t.value}</div>
                <div className="ml">{t.label}</div>
                <div className="mn">{t.note}</div>
              </div>
            ))}
          </div>

          {/* Two col: yield + crosschain */}
          <div className="two-col">
            {/* Yield positions */}
            <div>
              <div className="panel-head">Yield Positions (Earn Kit)</div>
              {yields.length === 0 ? (
                <div className="empty-state">No active yield positions</div>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Vault</th>
                      <th className="right">Principal</th>
                      <th className="right">Value</th>
                      <th className="right">APY</th>
                    </tr>
                  </thead>
                  <tbody>
                    {yields.map((p) => {
                      const gain = BigInt(p.currentValue) - BigInt(p.principal);
                      const gainPositive = gain > BigInt(0);
                      return (
                        <tr key={p.id}>
                          <td>
                            <div style={{ fontWeight: 500 }}>{p.vault}</div>
                            <div className="dim" style={{ fontSize: ".68rem" }}>{p.protocol}</div>
                          </td>
                          <td className="right"><Amount value={p.principal} token={p.token} /></td>
                          <td className="right">
                            <Amount value={p.currentValue} token={p.token} />
                            {gainPositive && <div className="gold" style={{ fontSize: ".65rem" }}>+{formatUnits(gain)} {p.token}</div>}
                          </td>
                          <td className="right gold">{p.apy.toFixed(2)}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Cross-chain transfers */}
            <div>
              <div className="panel-head">Cross-chain Transfers (CCTP V2)</div>
              {crosschain.length === 0 ? (
                <div className="empty-state">No cross-chain transfers</div>
              ) : (
                crosschain.map((c) => (
                  <div key={c.id} style={{ border: "1px solid var(--line)", padding: "1rem 1.2rem", marginBottom: ".8rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: ".8rem" }}>
                      <div>
                        <div style={{ fontWeight: 500, fontSize: ".85rem" }}>{c.payeeName}</div>
                        <div className="dim" style={{ fontSize: ".68rem" }}>{c.destChain}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <Amount value={c.amount} token={c.token} />
                        <div style={{ marginTop: ".2rem" }}><StatusBadge status={c.stage} /></div>
                      </div>
                    </div>
                    {/* Burn → Attest → Mint pipeline */}
                    <div style={{ display: "flex", gap: ".5rem", alignItems: "center", fontSize: ".65rem", color: "var(--muted)", flexWrap: "wrap" }}>
                      {[
                        { label: "Burn", tx: c.burnTx, done: !!c.burnTx },
                        { label: "Attest", tx: c.attestTx, done: !!c.attestTx },
                        { label: "Mint", tx: c.mintTx, done: !!c.mintTx },
                      ].map(({ label, tx, done }, i) => (
                        <span key={label} style={{ display: "flex", alignItems: "center", gap: ".3rem" }}>
                          {i > 0 && <span style={{ color: "var(--muted-2)" }}>→</span>}
                          <span style={{ color: done ? "#6bff9f" : "var(--muted-2)", letterSpacing: ".1em" }}>{label}</span>
                          {tx && <TxLink hash={tx} label="↗" />}
                        </span>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
