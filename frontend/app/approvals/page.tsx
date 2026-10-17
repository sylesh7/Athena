"use client";

import { useEffect, useState } from "react";
import Nav from "@/components/Nav";
import Amount from "@/components/Amount";
import StatusBadge from "@/components/StatusBadge";
import TxLink from "@/components/TxLink";
import { getEscalations, getPayees, type Escalation, type Payee, formatUnits } from "@/lib/api";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { treasuryAbi, treasuryAddress, errorText } from "@/lib/treasury";

function timeLabel(iso: string) {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function ApprovalsPage() {
  const [tab, setTab] = useState<"escalations" | "payees">("escalations");
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [payees, setPayees] = useState<Payee[]>([]);
  const [selectedEsc, setSelectedEsc] = useState<Escalation | null>(null);
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string; tx?: string } | null>(null);

  const refresh = () => { getEscalations().then(setEscalations); getPayees().then(setPayees); };
  useEffect(refresh, []);

  // Simulate first (a revert never reaches the wallet), then sign, then wait for the receipt and re-read from the API.
  async function act(key: string, fn: "approveEscalation" | "rejectEscalation" | "approvePayee" | "rejectPayee" | "suspendPayee", id: string) {
    if (!address || !publicClient) return;
    setBusy(key); setNotice(null);
    try {
      const to = await treasuryAddress();
      const args = [id as `0x${string}`] as const;
      await publicClient.simulateContract({ address: to, abi: treasuryAbi, functionName: fn, args, account: address });
      const hash = await writeContractAsync({ address: to, abi: treasuryAbi, functionName: fn, args });
      await publicClient.waitForTransactionReceipt({ hash });
      setNotice({ ok: true, text: `${fn} confirmed on Arc.`, tx: hash });
      setSelectedEsc(null);
      setTimeout(refresh, 4000); // the indexer picks the event up within a few seconds
    } catch (e) {
      setNotice({ ok: false, text: errorText(e) });
    } finally { setBusy(null); }
  }

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

          {notice && (
            <div style={{ padding: ".8rem 1rem", border: `1px solid ${notice.ok ? "#1e6a3a" : "var(--rust)"}`, color: notice.ok ? "#6bff9f" : "var(--rust-glow)", fontSize: ".78rem", marginBottom: "1.2rem" }}>
              {notice.text} {notice.tx && <TxLink hash={notice.tx} label="View transaction →" />}
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
                            <button className="btn-solid" style={{ padding: ".65rem 1.2rem", fontSize: ".68rem" }} disabled={busy !== null} onClick={() => act("esc-ok", "approveEscalation", selectedEsc.decisionId)}>
                              <span>{busy === "esc-ok" ? "Waiting for wallet…" : "Approve Escalation"}</span>
                            </button>
                            <button className="btn-ghost" style={{ padding: ".65rem 1.2rem" }} disabled={busy !== null} onClick={() => act("esc-no", "rejectEscalation", selectedEsc.decisionId)}>
                              <span>{busy === "esc-no" ? "Waiting for wallet…" : "Reject"}</span>
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
                          <span style={{ display: "inline-flex", gap: ".4rem" }}>
                            <button className="btn-solid" style={{ padding: ".35rem .8rem", fontSize: ".62rem" }} disabled={busy !== null} onClick={() => act("p-" + p.id, "approvePayee", p.id)}>
                              <span>{busy === "p-" + p.id ? "…" : "Activate"}</span>
                            </button>
                            <button className="btn-ghost" style={{ padding: ".35rem .8rem" }} disabled={busy !== null} onClick={() => act("r-" + p.id, "rejectPayee", p.id)}>
                              <span style={{ fontSize: ".62rem" }}>Reject</span>
                            </button>
                          </span>
                        ) : (
                          <span style={{ color: "var(--muted-2)", fontSize: ".68rem" }}>Connect wallet</span>
                        )
                      )}
                      {p.status === "active" && (
                        isConnected ? (
                          <button className="btn-ghost" style={{ padding: ".35rem .8rem" }} disabled={busy !== null} onClick={() => act("s-" + p.id, "suspendPayee", p.id)}>
                            <span style={{ fontSize: ".62rem" }}>{busy === "s-" + p.id ? "…" : "Suspend"}</span>
                          </button>
                        ) : <span style={{ color: "var(--muted-2)", fontSize: ".68rem" }}>Connect wallet</span>
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
