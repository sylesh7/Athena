"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Nav from "@/components/Nav";
import Amount from "@/components/Amount";
import StatusBadge from "@/components/StatusBadge";
import { getReceivables, type Receivable } from "@/lib/api";

const DUNNING_LABEL = ["On track", "1st reminder", "2nd reminder", "Final notice", "Collections"];

function dateLabel(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function daysDiff(iso: string) {
  const diff = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
  if (diff < 0) return `${Math.abs(diff)}d overdue`;
  if (diff === 0) return "due today";
  return `in ${diff}d`;
}

export default function ReceivablesPage() {
  const [receivables, setReceivables] = useState<Receivable[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState<Receivable | null>(null);

  useEffect(() => { getReceivables().then(setReceivables); }, []);

  const pending = receivables.filter((r) => r.status !== "paid");
  const paid = receivables.filter((r) => r.status === "paid");

  return (
    <div className="tpage">
      <Nav />
      <main>
        <section className="section">
          <div className="page-head">
            <div>
              <div className="eyebrow">Accounts Receivable</div>
              <h1>Receivables</h1>
            </div>
            <button className="btn-solid" onClick={() => setShowForm(!showForm)}>
              <span>{showForm ? "Cancel" : "Issue Invoice"}</span>
            </button>
          </div>

          {showForm && (
            <div style={{ border: "1px solid var(--line)", padding: "1.6rem", marginBottom: "2rem", maxWidth: "540px" }}>
              <div className="panel-head">New Receivable</div>
              {[
                { label: "Customer Name", type: "text", placeholder: "Acme Corp" },
                { label: "Customer Address (optional)", type: "text", placeholder: "0x…" },
                { label: "Amount (USDC atomic units)", type: "text", placeholder: "1000000000" },
                { label: "Due Date", type: "date", placeholder: "" },
                { label: "Description", type: "text", placeholder: "Invoice for services rendered" },
              ].map(({ label, type, placeholder }) => (
                <div className="form-group" key={label} style={{ marginBottom: "1rem" }}>
                  <label style={{ display: "block", fontSize: ".62rem", letterSpacing: ".2em", color: "var(--muted)", textTransform: "uppercase", marginBottom: ".4rem" }}>{label}</label>
                  <input
                    type={type}
                    placeholder={placeholder}
                    style={{ width: "100%", background: "transparent", border: "1px solid var(--line)", color: "var(--ink)", padding: ".65rem .9rem", fontSize: ".82rem", fontFamily: "inherit", outline: "none" }}
                  />
                </div>
              ))}
              <div style={{ display: "flex", gap: ".6rem" }}>
                <button className="btn-solid" style={{ padding: ".65rem 1.4rem", fontSize: ".7rem" }}><span>Issue</span></button>
                <button className="btn-ghost" style={{ padding: ".65rem 1.4rem" }} onClick={() => setShowForm(false)}><span>Cancel</span></button>
              </div>
              <div style={{ marginTop: ".7rem", fontSize: ".62rem", color: "var(--muted-2)" }}>
                Calls POST /receivables · registers on-chain via AthenaTreasury.registerReceivable()
              </div>
            </div>
          )}

          {/* Outstanding */}
          <div className="section-label">Outstanding ({pending.length})</div>
          {pending.length === 0 ? (
            <div className="empty-state" style={{ marginBottom: "2rem" }}>No outstanding receivables</div>
          ) : (
            <table className="data-table" style={{ marginBottom: "2rem" }}>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th className="right">Amount</th>
                  <th>Due</th>
                  <th>Status</th>
                  <th>Dunning</th>
                  <th>Pay Link</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((r) => (
                  <tr key={r.id} onClick={() => setSelected(selected?.id === r.id ? null : r)}>
                    <td style={{ fontWeight: 500 }}>{r.customerName}</td>
                    <td className="right"><Amount value={r.amount} token={r.token} /></td>
                    <td>
                      <span style={{ fontSize: ".78rem" }}>{dateLabel(r.dueDate)}</span>
                      <span className="dim" style={{ fontSize: ".68rem", marginLeft: ".4rem" }}>({daysDiff(r.dueDate)})</span>
                    </td>
                    <td><StatusBadge status={r.status} /></td>
                    <td>
                      <span style={{
                        fontSize: ".68rem", letterSpacing: ".1em",
                        color: r.dunningStage >= 3 ? "var(--rust-glow)" : r.dunningStage > 0 ? "var(--gold-glow)" : "var(--muted)",
                      }}>
                        {DUNNING_LABEL[r.dunningStage]}
                      </span>
                    </td>
                    <td>
                      <Link href={r.payLink} className="tx-link">Pay page →</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Selected detail */}
          {selected && (
            <div className="detail-panel" style={{ maxWidth: "540px", marginBottom: "2rem" }}>
              <div className="detail-head">
                <div>
                  <div style={{ fontSize: ".6rem", letterSpacing: ".2em", color: "var(--gold-glow)" }}>RECEIVABLE</div>
                  <div style={{ fontWeight: 600, marginTop: ".3rem" }}>{selected.customerName}</div>
                </div>
                <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: "1.1rem" }}>✕</button>
              </div>
              <div className="detail-body">
                {[
                  ["ID", selected.id],
                  ["Amount", `${selected.amount} (${selected.token})`],
                  ["Due date", dateLabel(selected.dueDate)],
                  ["Issued", dateLabel(selected.issuedAt)],
                  ["Customer address", selected.customerAddress ?? "Any wallet"],
                  ["Dunning stage", `${selected.dunningStage} — ${DUNNING_LABEL[selected.dunningStage]}`],
                  ["x402 pay link", selected.x402Link],
                ].map(([k, v]) => (
                  <div className="detail-row" key={k as string}>
                    <span className="detail-key">{k}</span>
                    <span className="detail-val mono" style={{ fontSize: ".7rem" }}>{v}</span>
                  </div>
                ))}
                <div style={{ marginTop: "1.2rem", display: "flex", gap: ".6rem", flexWrap: "wrap" }}>
                  <Link href={selected.payLink} className="btn-solid" style={{ padding: ".65rem 1.2rem", fontSize: ".68rem", textDecoration: "none" }}>
                    Open Pay Page
                  </Link>
                  <button className="btn-ghost" style={{ padding: ".65rem 1.2rem" }}><span>Send Reminder</span></button>
                </div>
              </div>
            </div>
          )}

          {/* Paid */}
          {paid.length > 0 && (
            <>
              <div className="section-label">Paid ({paid.length})</div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th className="right">Amount</th>
                    <th>Due</th>
                    <th>Paid</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {paid.map((r) => (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 500 }}>{r.customerName}</td>
                      <td className="right"><Amount value={r.amount} token={r.token} /></td>
                      <td className="dim" style={{ fontSize: ".78rem" }}>{dateLabel(r.dueDate)}</td>
                      <td className="dim" style={{ fontSize: ".78rem" }}>{r.paidAt ? dateLabel(r.paidAt) : "—"}</td>
                      <td><StatusBadge status="paid" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
