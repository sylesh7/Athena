"use client";

import { use, useEffect, useState } from "react";
import Nav from "@/components/Nav";
import Amount from "@/components/Amount";
import TxLink from "@/components/TxLink";
import { getReceivables, type Receivable } from "@/lib/api";
import { useAccount } from "wagmi";

type Step = "idle" | "approving" | "paying" | "done" | "error";

export default function PayPage({ params }: { params: Promise<{ receivableId: string }> }) {
  const { receivableId } = use(params);
  const [receivable, setReceivable] = useState<Receivable | null>(null);
  const [step, setStep] = useState<Step>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { address, isConnected } = useAccount();

  useEffect(() => {
    getReceivables().then((list) => {
      const found = list.find((r) => r.id === receivableId);
      setReceivable(found ?? null);
    });
  }, [receivableId]);

  async function handlePay() {
    if (!isConnected) return;
    setError(null);

    try {
      // Step 1: approve
      setStep("approving");
      await new Promise((r) => setTimeout(r, 1200)); // simulate wallet prompt

      // Step 2: payReceivable
      setStep("paying");
      await new Promise((r) => setTimeout(r, 1800)); // simulate tx

      setTxHash("0xsim_pay_tx_" + receivableId.slice(-6));
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Transaction failed");
      setStep("error");
    }
  }

  if (!receivable) {
    return (
      <div className="tpage">
        <Nav />
        <main>
          <section className="section">
            <div className="pay-card">
              <div style={{ color: "var(--muted)", fontSize: ".85rem" }}>Loading receivable…</div>
            </div>
          </section>
        </main>
      </div>
    );
  }

  const isPaid = receivable.status === "paid" || step === "done";
  const dueDate = new Date(receivable.dueDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  return (
    <div className="tpage">
      <Nav />
      <main>
        <section className="section">
          <div className="pay-card">
            <div className="eyebrow" style={{ marginBottom: ".8rem" }}>Invoice Payment</div>

            <div className="pay-amount">
              <Amount value={receivable.amount} token={receivable.token} />
            </div>

            <div style={{ color: "var(--muted)", fontSize: ".8rem", marginBottom: "1.6rem", lineHeight: 1.6 }}>
              Due: {dueDate}<br />
              From: {receivable.customerName}
              {receivable.customerAddress && (
                <><br />Restricted to: <span className="mono" style={{ fontSize: ".72rem" }}>{receivable.customerAddress}</span></>
              )}
            </div>

            {isPaid ? (
              <div style={{ padding: "1rem 1.2rem", border: "1px solid #1e6a3a", background: "rgba(107,255,159,.06)", color: "#6bff9f", fontSize: ".82rem", marginBottom: "1.2rem" }}>
                Payment received — receivable settled on-chain.
                {txHash && <div style={{ marginTop: ".4rem" }}><TxLink hash={txHash} label="View transaction →" /></div>}
              </div>
            ) : (
              <>
                <div className="pay-steps">
                  <div className={`pay-step ${step === "approving" ? "active" : (step === "paying" || step === "error") ? "done" : ""}`}>
                    <span className="pay-step-num">1</span>
                    Approve USDC transfer
                  </div>
                  <div className={`pay-step ${step === "paying" ? "active" : step === "error" ? "done" : ""}`}>
                    <span className="pay-step-num">2</span>
                    Call payReceivable()
                  </div>
                  <div className="pay-step">
                    <span className="pay-step-num">3</span>
                    Settlement confirmed on Arc
                  </div>
                </div>

                {error && (
                  <div style={{ padding: ".8rem 1rem", border: "1px solid var(--rust)", color: "var(--rust-glow)", fontSize: ".78rem", marginBottom: "1rem" }}>
                    {error}
                  </div>
                )}

                {!isConnected ? (
                  <div style={{ color: "var(--muted)", fontSize: ".8rem", padding: "1rem 0" }}>
                    Connect your wallet using the button in the nav to pay this invoice.
                  </div>
                ) : (
                  <button
                    className="btn-solid"
                    style={{ width: "100%", justifyContent: "center" }}
                    onClick={handlePay}
                    disabled={step === "approving" || step === "paying"}
                  >
                    <span>
                      {step === "approving" ? "Approving…" :
                       step === "paying" ? "Sending payment…" :
                       `Pay ${receivable.token}`}
                    </span>
                  </button>
                )}

                <div style={{ marginTop: "1rem", fontSize: ".62rem", color: "var(--muted-2)", lineHeight: 1.6 }}>
                  This calls <span className="mono">ERC20.approve(treasury, amount)</span> then{" "}
                  <span className="mono">AthenaTreasury.payReceivable({receivableId})</span> on Arc Testnet.
                  The transaction is simulated before your wallet is prompted.
                </div>

                <div style={{ marginTop: "1.4rem", borderTop: "1px solid var(--line)", paddingTop: "1rem" }}>
                  <div style={{ fontSize: ".62rem", letterSpacing: ".18em", color: "var(--muted)", marginBottom: ".5rem", textTransform: "uppercase" }}>Agent pay link (x402)</div>
                  <div className="mono" style={{ fontSize: ".65rem", color: "var(--muted-2)", wordBreak: "break-all", lineHeight: 1.6 }}>
                    {receivable.x402Link}
                  </div>
                </div>
              </>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
