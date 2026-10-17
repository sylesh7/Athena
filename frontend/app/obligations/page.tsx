"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAccount, useSignMessage } from "wagmi";
import Nav from "@/components/Nav";
import Amount from "@/components/Amount";
import StatusBadge from "@/components/StatusBadge";
import { getObligations, getHeldInvoices, signedMessage, postSigned, type Obligation, type Invoice, formatUnits } from "@/lib/api";

const STATUS_FILTERS = ["all", "pending", "scheduled", "executed", "held", "escalated"];

function dateLabel(iso: string) {
  const d = new Date(iso);
  const diff = Math.ceil((d.getTime() - Date.now()) / 86400000);
  const base = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (diff === 0) return `${base} (today)`;
  if (diff === 1) return `${base} (tomorrow)`;
  if (diff < 0) return `${base} (${Math.abs(diff)}d overdue)`;
  return `${base} (in ${diff}d)`;
}

export default function ObligationsPage() {
  const [tab, setTab] = useState<"payables" | "queue">("payables");
  const [obligations, setObligations] = useState<Obligation[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [filter, setFilter] = useState("all");
  const [selectedInv, setSelectedInv] = useState<Invoice | null>(null);
  const { isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [resolving, setResolving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadMsg, setUploadMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [uploading, setUploading] = useState(false);

  // The file goes to our own /api/upload route (which holds the admin key), then through intake → extraction → validation.
  async function upload(file: File) {
    setUploading(true); setUploadMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file, file.name);
      const r = await fetch("/api/upload", { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setUploadMsg({ ok: false, text: j?.error ?? `Upload failed (HTTP ${r.status})` });
      else setUploadMsg({ ok: true, text: j.duplicate ? "That document was already received — duplicate ignored." : "Received. Extraction and validation run in the next cycle; check the review queue shortly." });
      setTimeout(() => { getHeldInvoices().then(setInvoices); getObligations().then(setObligations); }, 8000);
    } catch { setUploadMsg({ ok: false, text: "Could not reach the server." }); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  }
  const [resolveMsg, setResolveMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // EIP-191 signed by an APPROVER wallet; the API checks the role on-chain, freshness and one-time nonce.
  async function resolve(verdict: "release" | "reject") {
    if (!selectedInv) return;
    setResolving(true); setResolveMsg(null);
    try {
      const msg = { action: "invoice.resolve", target: selectedInv.id, verdict, nonce: crypto.randomUUID(), issuedAt: new Date().toISOString() };
      const signature = await signMessageAsync({ message: signedMessage(msg) });
      const r = await postSigned(`/invoices/${selectedInv.id}/resolve`, { verdict, nonce: msg.nonce, issuedAt: msg.issuedAt, signature });
      setResolveMsg({ ok: r.ok, text: r.ok ? (verdict === "release" ? "Released — the worker will re-run matching." : "Rejected.") : r.message });
      if (r.ok) { setSelectedInv(null); getHeldInvoices().then(setInvoices); }
    } catch (e) {
      setResolveMsg({ ok: false, text: e instanceof Error ? e.message.split("\n")[0]!.slice(0, 160) : "Signing failed" });
    } finally { setResolving(false); }
  }

  useEffect(() => {
    getObligations().then(setObligations);
    getHeldInvoices().then(setInvoices);
  }, []);

  const filtered = filter === "all" ? obligations : obligations.filter((o) => o.status === filter);

  return (
    <div className="tpage">
      <Nav />
      <main>
        <section className="section">
          <div className="page-head">
            <div>
              <div className="eyebrow">Accounts Payable</div>
              <h1>Obligations</h1>
            </div>
            <div className="page-head-actions">
              <input ref={fileRef} type="file" accept=".pdf,.txt,.json,application/pdf,text/plain" style={{ display: "none" }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
              <button className="btn-ghost" disabled={uploading} onClick={() => fileRef.current?.click()}>
                <span>{uploading ? "Uploading…" : "Upload Invoice"}</span>
              </button>
            </div>
          </div>

          {uploadMsg && (
            <div style={{ padding: ".8rem 1rem", border: `1px solid ${uploadMsg.ok ? "#1e6a3a" : "var(--rust)"}`, color: uploadMsg.ok ? "#6bff9f" : "var(--rust-glow)", fontSize: ".78rem", marginBottom: "1.2rem" }}>
              {uploadMsg.text}
            </div>
          )}

          <div className="tabs">
            <button className={`tab${tab === "payables" ? " active" : ""}`} onClick={() => setTab("payables")}>
              Payables ({obligations.length})
            </button>
            <button className={`tab${tab === "queue" ? " active" : ""}`} onClick={() => setTab("queue")}>
              Review Queue ({invoices.length})
            </button>
          </div>

          {tab === "payables" && (
            <>
              {/* Filter bar */}
              <div style={{ display: "flex", gap: ".5rem", marginBottom: "1.4rem", flexWrap: "wrap" }}>
                {STATUS_FILTERS.map((s) => (
                  <button
                    key={s}
                    onClick={() => setFilter(s)}
                    style={{
                      padding: ".35rem .9rem", border: "1px solid", fontSize: ".62rem", letterSpacing: ".18em",
                      textTransform: "uppercase", cursor: "pointer", fontFamily: "inherit",
                      background: filter === s ? "var(--gold)" : "transparent",
                      color: filter === s ? "#0a0a12" : "var(--muted)",
                      borderColor: filter === s ? "var(--gold)" : "var(--line)",
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>

              {filtered.length === 0 ? (
                <div className="empty-state">No obligations match this filter</div>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Payee</th>
                      <th>Category</th>
                      <th className="right">Amount</th>
                      <th>Due Date</th>
                      <th>Status</th>
                      <th>Planned</th>
                      <th>Decision</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((o) => (
                      <tr key={o.id}>
                        <td className="dim mono">{o.invoiceRef ?? "—"}</td>
                        <td style={{ fontWeight: 500 }}>{o.payeeName}</td>
                        <td className="dim" style={{ fontSize: ".7rem", letterSpacing: ".1em" }}>{o.category}</td>
                        <td className="right"><Amount value={o.amount} token={o.token} /></td>
                        <td className="dim" style={{ fontSize: ".78rem" }}>{dateLabel(o.dueDate)}</td>
                        <td><StatusBadge status={o.status} /></td>
                        <td className="dim" style={{ fontSize: ".78rem" }}>{o.plannedDate ? dateLabel(o.plannedDate) : "—"}</td>
                        <td>
                          {o.latestDecisionId ? (
                            <Link href={`/decisions?id=${o.latestDecisionId}`} className="tx-link">
                              View →
                            </Link>
                          ) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}

          {tab === "queue" && (
            <div className="two-col" style={{ alignItems: "start" }}>
              <div>
                {invoices.length === 0 ? (
                  <div className="empty-state">No invoices in review queue</div>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Ref</th>
                        <th>Payee</th>
                        <th className="right">Amount</th>
                        <th>Hold Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.map((inv) => (
                        <tr key={inv.id} onClick={() => setSelectedInv(inv)}>
                          <td className="mono">{inv.ref}</td>
                          <td style={{ fontWeight: 500 }}>{inv.payeeName}</td>
                          <td className="right"><Amount value={inv.amount} token={inv.token} /></td>
                          <td className="dim" style={{ fontSize: ".75rem", maxWidth: "22rem" }}>{inv.holdReason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Detail panel */}
              {selectedInv && (
                <div className="detail-panel">
                  <div className="detail-head">
                    <div>
                      <div style={{ fontSize: ".62rem", letterSpacing: ".2em", color: "var(--gold-glow)" }}>HELD INVOICE</div>
                      <div style={{ fontWeight: 600, marginTop: ".3rem" }}>{selectedInv.ref}</div>
                    </div>
                    <button onClick={() => setSelectedInv(null)} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: "1.1rem" }}>✕</button>
                  </div>
                  <div className="detail-body">
                    <div style={{ padding: ".7rem 1rem", background: "rgba(138,74,61,.08)", border: "1px solid var(--rust)", marginBottom: "1.2rem", fontSize: ".78rem", color: "var(--rust-glow)" }}>
                      {selectedInv.holdReason}
                    </div>
                    {Object.entries(selectedInv.fields).map(([k, v]) => (
                      <div className="detail-row" key={k}>
                        <span className="detail-key">{k}</span>
                        <span className="detail-val">{v}</span>
                      </div>
                    ))}
                    <div style={{ marginTop: "1.4rem", display: "flex", gap: ".6rem", flexWrap: "wrap" }}>
                      <button className="btn-solid" style={{ padding: ".65rem 1.2rem", fontSize: ".68rem" }} disabled={!isConnected || resolving} onClick={() => resolve("release")}>
                        <span>{resolving ? "Signing…" : "Release"}</span>
                      </button>
                      <button className="btn-ghost" style={{ padding: ".65rem 1.2rem" }} disabled={!isConnected || resolving} onClick={() => resolve("reject")}>
                        <span>Reject</span>
                      </button>
                      {!isConnected && <span style={{ color: "var(--muted-2)", fontSize: ".68rem", alignSelf: "center" }}>Connect the approver wallet to act</span>}
                      {resolveMsg && <div style={{ width: "100%", color: resolveMsg.ok ? "#6bff9f" : "var(--rust-glow)", fontSize: ".74rem" }}>{resolveMsg.text}</div>}
                    </div>
                    <div style={{ marginTop: ".8rem", fontSize: ".65rem", color: "var(--muted-2)" }}>
                      Actions require approver wallet signature (EIP-191)
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
