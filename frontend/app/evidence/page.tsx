"use client";

import { useEffect, useRef, useState } from "react";
import Cursor from "@/components/Cursor";
import Nav from "@/components/Nav";
import Reveal from "@/components/Reveal";
import { Footer } from "@/components/sections";
import {
  getLogs,
  getOnchainEvents,
  getSystemHealth,
  screenAddress,
  txLink,
  type LogEntry,
  type OnchainEvent,
  type SystemHealth,
  type ScreeningDecision,
} from "@/lib/api";

function short(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function ServiceRow({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="ev-health-row">
      <span className={`ev-dot ${ok ? "ev-dot-up" : "ev-dot-down"}`} />
      <span className="ev-health-label">{label}</span>
      <span className="ev-health-detail mono">{detail}</span>
    </div>
  );
}

function LogLine({ log }: { log: LogEntry }) {
  return (
    <div className={`ev-log-line ev-log-${log.level}`}>
      <span className="ev-log-time mono">{new Date(log.timestamp).toLocaleTimeString()}</span>
      <span className="ev-log-source mono">[{log.source}]</span>
      <span className="ev-log-msg">{log.message}</span>
    </div>
  );
}

function EventRow({ ev, explorerBase }: { ev: OnchainEvent; explorerBase: string }) {
  const link = ev.txHash ? `${explorerBase}${ev.txHash}` : txLink(ev.txHash);
  return (
    <div className="ev-event-row">
      <span className={`ev-event-badge ${ev.type === "Revealed" ? (ev.slashed ? "ev-badge-slash" : "ev-badge-ok") : "ev-badge-commit"}`}>
        {ev.type}
      </span>
      <span className="mono ev-event-task">{short(ev.taskId)}</span>
      <span className="ev-event-detail">
        {ev.type === "Committed"
          ? `client ${ev.client ? short(ev.client) : "—"} · bond ${ev.bondAmount ? (Number(ev.bondAmount) / 1e6).toFixed(2) : "—"} USDC`
          : `predictionMet=${String(ev.predictionMet)} · slashed=${String(ev.slashed)}`}
      </span>
      {link && (
        <a className="sd-link mono ev-event-link" href={link} target="_blank" rel="noreferrer">
          block {ev.blockNumber ?? "—"} ↗
        </a>
      )}
    </div>
  );
}

export default function EvidencePage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [events, setEvents] = useState<{ events: OnchainEvent[]; explorerBase: string } | null>(null);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [logsError, setLogsError] = useState(false);

  const [screenInput, setScreenInput] = useState("");
  const [screenResult, setScreenResult] = useState<ScreeningDecision | null>(null);
  const [screenError, setScreenError] = useState<string | null>(null);
  const [screening, setScreening] = useState(false);

  const lastLogId = useRef<number | undefined>(undefined);
  const logFeedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    async function tickLogs() {
      try {
        const fresh = await getLogs(lastLogId.current, controller.signal);
        if (!active || fresh.length === 0) return;
        lastLogId.current = fresh[fresh.length - 1].id;
        setLogs((prev) => [...prev, ...fresh].slice(-300));
        setLogsError(false);
      } catch {
        if (active) setLogsError(true);
      }
    }
    async function tickEvents() {
      try {
        const data = await getOnchainEvents(controller.signal);
        if (active) setEvents(data);
      } catch {
        /* keep last */
      }
    }
    async function tickHealth() {
      try {
        const data = await getSystemHealth(controller.signal);
        if (active) setHealth(data);
      } catch {
        /* keep last */
      }
    }

    tickLogs();
    tickEvents();
    tickHealth();
    const logsTimer = setInterval(tickLogs, 3000);
    const eventsTimer = setInterval(tickEvents, 10000);
    const healthTimer = setInterval(tickHealth, 8000);
    return () => {
      active = false;
      controller.abort();
      clearInterval(logsTimer);
      clearInterval(eventsTimer);
      clearInterval(healthTimer);
    };
  }, []);

  useEffect(() => {
    if (logFeedRef.current) {
      logFeedRef.current.scrollTop = logFeedRef.current.scrollHeight;
    }
  }, [logs]);

  async function onScreen() {
    setScreenError(null);
    setScreenResult(null);
    if (!screenInput.trim()) return;
    setScreening(true);
    try {
      const result = await screenAddress(screenInput.trim());
      setScreenResult(result);
    } catch (err) {
      setScreenError(err instanceof Error ? err.message : "screening failed");
    } finally {
      setScreening(false);
    }
  }

  const svc = health?.services;

  return (
    <>
      <Cursor />
      <Nav />
      <main className="dashboard-page">
        <section className="section">
          <div className="eyebrow">Evidence</div>
          <h1>System Health &amp; On-Chain Evidence</h1>
          <p className="sd-muted ns-intro">
            Live proof of the real system running behind Athena — not a static screenshot. Every value below is
            fetched from the backend right now: structured logs from the actual running process, Committed/Revealed
            events read directly off Arc Testnet, and live reachability checks against every service Athena depends on.
          </p>

          {/* ── System Health ── */}
          <h2 className="ev-subhead">System Health</h2>
          {!health && <div className="session-empty">Checking service health…</div>}
          {svc && (
            <Reveal className="ev-health-grid">
              <ServiceRow label="Entrypoint" ok={svc.entrypoint.ok} detail={`:${svc.entrypoint.port}`} />
              <ServiceRow
                label="Provider 1 — Crypto Price"
                ok={svc.provider1.ok}
                detail={svc.provider1.ok ? `:${svc.provider1.port} · ${svc.provider1.status}` : svc.provider1.error ?? "unreachable"}
              />
              <ServiceRow
                label="Provider 2 — Market Analytics"
                ok={svc.provider2.ok}
                detail={svc.provider2.ok ? `:${svc.provider2.port} · ${svc.provider2.status}` : svc.provider2.error ?? "unreachable"}
              />
              <ServiceRow
                label="Provider 3 — Price Feed"
                ok={svc.provider3.ok}
                detail={svc.provider3.ok ? `:${svc.provider3.port} · ${svc.provider3.status}` : svc.provider3.error ?? "unreachable"}
              />
              <ServiceRow
                label="MCP Quality Monitor"
                ok={svc.mcpMonitor.ok}
                detail={svc.mcpMonitor.ok ? "reachable" : svc.mcpMonitor.error ?? "unreachable"}
              />
              <ServiceRow
                label="Arc Testnet RPC"
                ok={svc.arcTestnetRpc.ok}
                detail={svc.arcTestnetRpc.ok ? `block ${svc.arcTestnetRpc.blockNumber}` : svc.arcTestnetRpc.error ?? "unreachable"}
              />
            </Reveal>
          )}
          {health && <div className="ev-checked-at mono">last checked {new Date(health.checkedAt).toLocaleTimeString()}</div>}

          {/* ── Compliance screening demo ── */}
          <h2 className="ev-subhead">Compliance Screening — Circle Compliance Engine</h2>
          <p className="sd-muted">
            Every client address is screened live through Circle&apos;s Compliance Engine before a stream is allowed
            to start (see the gate in <span className="mono">POST /stream-task</span>). Try it here directly against
            any address.
          </p>
          <div className="ev-screen-box">
            <input
              className="ev-screen-input mono"
              placeholder="0x… address to screen"
              value={screenInput}
              onChange={(e) => setScreenInput(e.target.value)}
            />
            <button type="button" className="btn-solid" disabled={screening} onClick={onScreen}>
              <span>{screening ? "Screening…" : "Screen Address"}</span>
            </button>
          </div>
          {screenError && <div className="ns-error-box">Error — {screenError}</div>}
          {screenResult && (
            <div className={`ev-screen-result ${screenResult.result === "APPROVED" ? "ev-screen-ok" : "ev-screen-denied"}`}>
              <div className="ev-screen-verdict">{screenResult.result}</div>
              <div className="sd-muted">
                {screenResult.address} · screened {new Date(screenResult.screeningDate).toLocaleString()}
                {screenResult.ruleName ? ` · rule: ${screenResult.ruleName}` : ""}
              </div>
            </div>
          )}

          {/* ── On-chain events ── */}
          <h2 className="ev-subhead">On-Chain Events — AthenaCommit</h2>
          {!events && <div className="session-empty">Loading on-chain events…</div>}
          {events && events.events.length === 0 && (
            <div className="session-empty">No Committed/Revealed events in the recent block window yet.</div>
          )}
          {events && events.events.length > 0 && (
            <div className="ev-events-list">
              {[...events.events].reverse().map((ev, i) => (
                <EventRow ev={ev} explorerBase={events.explorerBase} key={`${ev.taskId}-${ev.type}-${i}`} />
              ))}
            </div>
          )}

          {/* ── Live logs ── */}
          <h2 className="ev-subhead">Live Backend Logs</h2>
          {logsError && logs.length === 0 && (
            <div className="session-empty">
              Can&apos;t reach the backend. Start it with <span className="mono">npm run dev</span> in backend/.
            </div>
          )}
          <div className="ev-log-feed" ref={logFeedRef}>
            {logs.length === 0 && !logsError && <div className="ev-log-empty">Waiting for backend activity…</div>}
            {logs.map((log) => (
              <LogLine log={log} key={log.id} />
            ))}
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
