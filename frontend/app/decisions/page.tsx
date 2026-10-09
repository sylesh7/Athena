"use client";

import { useEffect, useState } from "react";
import Nav from "@/components/Nav";
import Amount from "@/components/Amount";
import StatusBadge from "@/components/StatusBadge";
import TxLink from "@/components/TxLink";
import { getDecisions, getDecisionVerify, type Decision, type DecisionVerify } from "@/lib/api";

function shortId(id: string) {
  return `${id.slice(0, 10)}…${id.slice(-6)}`;
}

function timeLabel(iso: string) {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function DecisionsPage() {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [selected, setSelected] = useState<Decision | null>(null);
  const [verify, setVerify] = useState<DecisionVerify | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [tab, setTab] = useState<"record" | "verify">("record");

  useEffect(() => { getDecisions().then(setDecisions); }, []);

  async function select(d: Decision) {
    setSelected(d);
    setVerify(null);
    setTab("record");
  }

  async function runVerify() {
    if (!selected) return;
    setVerifying(true);
    const v = await getDecisionVerify(selected.id);
    setVerify(v);
    setTab("verify");
    setVerifying(false);
  }

  return (
    <div className="tpage">
      <Nav />
      <main>
        <section className="section">
          <div className="page-head">
            <div>
              <div className="eyebrow">Commit · Execute · Reveal</div>
              <h1>Audit Trail</h1>
            </div>
          </div>

          <div className="two-col" style={{ alignItems: "start" }}>
            {/* Decision list */}
            <div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Decision ID</th>
                    <th>Kind</th>
                    <th>Payee</th>
                    <th className="right">Amount</th>
                    <th>State</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {decisions.map((d) => (
                    <tr key={d.id} onClick={() => select(d)} style={{ background: selected?.id === d.id ? "rgba(201,135,61,.06)" : undefined }}>
                      <td className="mono">{shortId(d.id)}</td>
                      <td><StatusBadge status={d.kind} /></td>
                      <td style={{ fontWeight: 500 }}>{d.payeeName ?? <span className="dim">—</span>}</td>
                      <td className="right">
                        {BigInt(d.amount) > BigInt(0) ? <Amount value={d.amount} token={d.token} /> : <span className="dim">—</span>}
                      </td>
                      <td><StatusBadge status={d.state} /></td>
                      <td className="dim" style={{ fontSize: ".72rem" }}>{timeLabel(d.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Detail panel */}
            {selected ? (
              <div>
                <div className="detail-panel">
                  <div className="detail-head">
                    <div>
                      <div style={{ fontSize: ".6rem", letterSpacing: ".2em", color: "var(--gold-glow)" }}>DECISION</div>
                      <div className="mono" style={{ fontSize: ".72rem", marginTop: ".3rem", wordBreak: "break-all" }}>{selected.id}</div>
                    </div>
                    <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: "1.1rem" }}>✕</button>
                  </div>
                  <div className="detail-body">
                    <div style={{ display: "flex", gap: ".5rem", marginBottom: "1.2rem" }}>
                      <StatusBadge status={selected.kind} />
                      <StatusBadge status={selected.state} />
                    </div>

                    <div className="tabs" style={{ marginBottom: "1rem" }}>
                      <button className={`tab${tab === "record" ? " active" : ""}`} onClick={() => setTab("record")}>Record</button>
                      <button className={`tab${tab === "verify" ? " active" : ""}`} onClick={() => { setTab("verify"); if (!verify) runVerify(); }}>
                        {verifying ? "Verifying…" : "Verify On-chain"}
                      </button>
                    </div>

                    {tab === "record" && (
                      <>
                        {[
                          ["Payee", selected.payeeName ?? "—"],
                          ["Amount", selected.amount !== "0" ? `${selected.amount} atomic units (${selected.token})` : "—"],
                          ["Rationale", selected.rationale],
                          ["Committed", timeLabel(selected.createdAt)],
                          ["Revealed", selected.revealedAt ? timeLabel(selected.revealedAt) : "Not yet revealed"],
                        ].map(([k, v]) => (
                          <div className="detail-row" key={k}>
                            <span className="detail-key">{k}</span>
                            <span className="detail-val" style={{ maxWidth: "60%", textAlign: "right", lineHeight: "1.5" }}>{v}</span>
                          </div>
                        ))}

                        <div style={{ marginTop: "1.2rem" }}>
                          <div className="panel-head">Transactions</div>
                          {[
                            ["Commit", selected.commitTx],
                            ["Execute", selected.executeTx],
                            ["Reveal", selected.revealTx],
                          ].map(([label, hash]) => (
                            <div className="detail-row" key={label as string}>
                              <span className="detail-key">{label}</span>
                              <TxLink hash={hash as string | null} />
                            </div>
                          ))}
                        </div>

                        <div style={{ marginTop: "1.2rem" }}>
                          <div className="panel-head">Decision Hash</div>
                          <div className="json-block" style={{ maxHeight: "4rem", fontSize: ".65rem" }}>
                            {selected.decisionHash ?? "Not committed yet"}
                          </div>
                        </div>
                      </>
                    )}

                    {tab === "verify" && (
                      <>
                        {verifying && <div style={{ color: "var(--muted)", fontSize: ".82rem", padding: "1rem 0" }}>Computing SHA-256 and reading chain…</div>}
                        {verify && (
                          <>
                            {verify.match ? (
                              <div className="verify-strip">
                                <span className="verify-icon">✓</span>
                                Hash verified — record matches what was committed on-chain
                              </div>
                            ) : (
                              <div className="verify-fail-strip">
                                <span className="verify-icon">✕</span>
                                Hash mismatch — revealed record does not match commit
                              </div>
                            )}
                            {[
                              ["On-chain hash", verify.onchainDecisionHash],
                              ["Recomputed SHA-256", verify.recomputedSha256],
                              ["Match", verify.match ? "YES" : "NO"],
                              ["Reveal tx", verify.revealTx ?? "—"],
                            ].map(([k, v]) => (
                              <div className="detail-row" key={k as string}>
                                <span className="detail-key">{k}</span>
                                <span className="detail-val mono" style={{ color: k === "Match" ? (verify.match ? "#6bff9f" : "var(--rust-glow)") : undefined }}>
                                  {v as string}
                                </span>
                              </div>
                            ))}
                            <div className="panel-head" style={{ marginTop: "1.2rem" }}>Record bytes (revealed)</div>
                            <div className="json-block">{verify.recordBytes}</div>
                          </>
                        )}
                        {!verifying && !verify && (
                          <button className="btn-solid" onClick={runVerify} style={{ marginTop: ".5rem" }}>
                            <span>Run Verification</span>
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="empty-state">Select a decision to inspect its record and verify the on-chain hash</div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
