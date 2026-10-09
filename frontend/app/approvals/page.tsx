"use client";

import { useEffect, useState } from "react";
import Nav from "@/components/Nav";
import Amount from "@/components/Amount";
import StatusBadge from "@/components/StatusBadge";
import TxLink from "@/components/TxLink";
import { getEscalations, getPayees, type Escalation, type Payee, formatUnits } from "@/lib/api";
import { useAccount } from "wagmi";

function timeLabel(iso: string) {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function ApprovalsPage() {
  const [tab, setTab] = useState<"escalations" | "payees">("escalations");
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [payees, setPayees] = useState<Payee[]>([]);
  const [selectedEsc, setSelectedEsc] = useState<Escalation | null>(null);
  const { address, isConnected } = useAccount();

  useEffect(() => {
    getEscalations().then(setEscalations);
    getPayees().then(setPayees);
  }, []);

  const pending = escalations.filter((e) => e.status === "pending");
  const pendingPayees = payees.filter((p) => p.status === "pending_activation");

  return (
    <div className="tpage">
      <Nav />
      <main>
        <section className="section">
          <div className="page-head">
            <div>
              <div className="eyebrow">Human In The Loop</div>
              <h1>Approvals</h1>
            </div>
            {isConnected && (
              <div style={{ fontSize: ".68rem", color: "var(--muted)", letterSpacing: ".1em" }}>
                Connected: <span className="mono" style={{ color: "var(--gold-glow)" }}>{address?.slice(0, 8)}…{address?.slice(-4)}</span>
              </div>
            )}
          </div>

          {!isConnected && (
            <div style={{ padding: "1rem 1.2rem", border: "1px solid var(--gold)", color: "var(--gold-glow)", fontSize: ".78rem", marginBottom: "1.6rem" }}>
              Connect your approver wallet to sign escalation approvals and payee activations on-chain.
            </div>
          )}

          <div className="tabs">
            <button className={`tab${tab === "escalations" ? " active" : ""}`} onClick={() => setTab("escalations")}>
              Escalations {pending.length > 0 && <span style={{ color: "var(--rust-glow)", marginLeft: ".4rem" }}>({pending.length} pending)</span>}
            </button>
            <button className={`tab${tab === "payees" ? " active" : ""}`} onClick={() => setTab("payees")}>
              Payees {pendingPayees.length > 0 && <span style={{ color: "var(--gold-glow)", marginLeft: ".4rem" }}>({pendingPayees.length} pending)</span>}
            </button>
          </div>

          {tab === "escalations" && (
            <div className="two-col" style={{ alignItems: "start" }}>
              <div>
                {escalations.length === 0 ? (
                  <div className="empty-state">No escalations</div>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Payee</th>
                        <th className="right">Amount</th>
                        <th>Reason</th>
                        <th>Status</th>
                        <th>Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {escalations.map((e) => (
                        <tr key={e.id} onClick={() => setSelectedEsc(e)} style={{ background: selectedEsc?.id === e.id ? "rgba(201,135,61,.06)" : undefined }}>
                          <td style={{ fontWeight: 500 }}>{e.payeeName}</td>
                          <td className="right"><Amount value={e.amount} token={e.token} /></td>
                          <td className="dim" style={{ fontSize: ".75rem", maxWidth: "18rem" }}>{e.reason}</td>
                          <td><StatusBadge status={e.status} /></td>
                          <td className="dim" style={{ fontSize: ".72rem" }}>{timeLabel(e.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {selectedEsc && (
                <div className="detail-panel">
                  <div className="detail-head">
                    <div>
                      <div style={{ fontSize: ".6rem", letterSpacing: ".2em", color: "var(--rust-glow)" }}>ESCALATION</div>
                      <div style={{ fontWeight: 600, marginTop: ".3rem" }}>{selectedEsc.payeeName}</div>
                    </div>
                    <button onClick={() => setSelectedEsc(null)} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: "1.1rem" }}>✕</button>
                  </div>
                  <div className="detail-body">
                    <div style={{ padding: ".75rem 1rem", background: "rgba(255,159,107,.06)", border: "1px solid #8a4a1e", marginBottom: "1.2rem", fontSize: ".8rem", color: "#ff9f6b" }}>
                      {selectedEsc.reason}
                    </div>
                    {[
                      ["Amount", `${formatUnits(selectedEsc.amount)} ${selectedEsc.token}`],
                      ["Status", selectedEsc.status],
                      ["Decision ID", `${selectedEsc.decisionId.slice(0, 16)}…`],
                      ["Created", timeLabel(selectedEsc.createdAt)],
                    ].map(([k, v]) => (
                      <div className="detail-row" key={k as string}>
                        <span className="detail-key">{k}</span>
                        <span className="detail-val">{v}</span>
                      </div>
                    ))}

                    {selectedEsc.status === "pending" && (
                      <div style={{ marginTop: "1.4rem" }}>
                        {isConnected ? (
                          <div style={{ display: "flex", gap: ".6rem", flexWrap: "wrap" }}>
                            <button className="btn-solid" style={{ padding: ".65rem 1.2rem", fontSize: ".68rem" }}>
                              <span>Approve Escalation</span>
                            </button>
                            <button className="btn-ghost" style={{ padding: ".65rem 1.2rem" }}>
                              <span>Reject</span>
                            </button>
                          </div>
                        ) : (
                          <div style={{ color: "var(--muted-2)", fontSize: ".72rem" }}>Connect approver wallet to sign this action on-chain</div>
                        )}
                        <div style={{ marginTop: ".6rem", fontSize: ".62rem", color: "var(--muted-2)" }}>
                          Signs AthenaTreasury.approveEscalation() · simulated before wallet prompt
                        </div>
                      </div>
                    )}

                    {selectedEsc.resolveTx && (
                      <div className="detail-row" style={{ marginTop: ".8rem" }}>
                        <span className="detail-key">Resolve tx</span>
                        <TxLink hash={selectedEsc.resolveTx} />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === "payees" && (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Category</th>
                  <th>Token</th>
                  <th className="right">Cap</th>
                  <th>Risk</th>
                  <th>Address</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {payees.map((p) => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 500 }}>{p.name}</td>
                    <td className="dim" style={{ fontSize: ".72rem", letterSpacing: ".1em" }}>{p.category}</td>
                    <td className="dim">{p.token}</td>
                    <td className="right"><Amount value={p.cap} token={p.token} /></td>
                    <td>
                      <span style={{
                        fontSize: ".62rem", letterSpacing: ".15em", textTransform: "uppercase",
                        color: p.riskTier === "high" ? "var(--rust-glow)" : p.riskTier === "medium" ? "var(--gold-glow)" : "var(--muted)",
                      }}>
                        {p.riskTier}
                      </span>
                    </td>
                    <td className="mono dim">{p.address}</td>
                    <td><StatusBadge status={p.status} /></td>
                    <td>
                      {p.status === "pending_activation" && (
                        isConnected ? (
                          <button className="btn-solid" style={{ padding: ".35rem .8rem", fontSize: ".62rem" }}>
                            <span>Activate</span>
                          </button>
                        ) : (
                          <span style={{ color: "var(--muted-2)", fontSize: ".68rem" }}>Connect wallet</span>
                        )
                      )}
                      {p.status === "active" && (
                        <button className="btn-ghost" style={{ padding: ".35rem .8rem" }}>
                          <span style={{ fontSize: ".62rem" }}>Suspend</span>
                        </button>
                      )}
                      {(p.status === "draft" || p.status === "suspended") && (
                        <span style={{ color: "var(--muted-2)", fontSize: ".68rem" }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </div>
  );
}
