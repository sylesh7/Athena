"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Nav from "@/components/Nav";
import Amount from "@/components/Amount";
import StatusBadge from "@/components/StatusBadge";
import { getObligations, getHeldInvoices, type Obligation, type Invoice, formatUnits } from "@/lib/api";

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
              <button className="btn-ghost">
                <span>Upload Invoice</span>
              </button>
            </div>
          </div>

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
                      <button className="btn-solid" style={{ padding: ".65rem 1.2rem", fontSize: ".68rem" }}>
                        <span>Release</span>
                      </button>
                      <button className="btn-ghost" style={{ padding: ".65rem 1.2rem" }}>
                        <span>Reject</span>
                      </button>
                      <button className="btn-ghost" style={{ padding: ".65rem 1.2rem" }}>
                        <span>Link PO</span>
                      </button>
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
