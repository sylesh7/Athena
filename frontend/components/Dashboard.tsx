import Link from "next/link";
import Reveal from "./Reveal";

type SessionStatus = "Committed" | "Streaming" | "Revealed" | "Settled" | "Slashed";

type StreamSession = {
  taskId: string;
  provider: string;
  status: SessionStatus;
  usdcStreamed: string;
};

type StatTile = {
  label: string;
  value: string;
};

const DASHBOARD_STATS: StatTile[] = [
  { label: "Total Streams", value: "42" },
  { label: "Total USDC Streamed", value: "1,204.55" },
  { label: "Slash Rate", value: "6.4%" },
  { label: "Avg. Prediction Accuracy", value: "91.2%" },
];

const SESSIONS: StreamSession[] = [
  { taskId: "0x4a7f0000000000000000000000000000000000000000000000000000009c21", provider: "Provider — Scout", status: "Committed", usdcStreamed: "0.000000" },
  { taskId: "0x9d210000000000000000000000000000000000000000000000000000004be4", provider: "Provider — Hive", status: "Streaming", usdcStreamed: "3.240000" },
  { taskId: "0x1b880000000000000000000000000000000000000000000000000000007a0f", provider: "Provider — Oath", status: "Streaming", usdcStreamed: "7.910000" },
  { taskId: "0xe63c0000000000000000000000000000000000000000000000000000012aa1", provider: "Provider — Scout", status: "Revealed", usdcStreamed: "11.500000" },
  { taskId: "0x77f00000000000000000000000000000000000000000000000000000ab340", provider: "Provider — Hive", status: "Settled", usdcStreamed: "14.980000" },
  { taskId: "0x2c9a0000000000000000000000000000000000000000000000000000ff0112", provider: "Provider — Oath", status: "Slashed", usdcStreamed: "5.020000" },
];

const BADGE_CLASS: Record<SessionStatus, string> = {
  Committed: "badge-committed",
  Streaming: "badge-streaming",
  Revealed: "badge-revealed",
  Settled: "badge-settled",
  Slashed: "badge-slashed",
};

function truncate(value: string) {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function StatusBadge({ status }: { status: SessionStatus }) {
  return <span className={`badge ${BADGE_CLASS[status]}`}>{status}</span>;
}

export function DashboardStats() {
  return (
    <Reveal className="div-grid dash-stats">
      {DASHBOARD_STATS.map((stat) => (
        <div className="div-cell" key={stat.label}>
          <div className="stat-label">{stat.label}</div>
          <div className="stat-value mono">{stat.value}</div>
        </div>
      ))}
    </Reveal>
  );
}

export function SessionList() {
  return (
    <>
      <div className="session-head">
        <span>Task ID</span>
        <span>Provider</span>
        <span>Status</span>
        <span>USDC Streamed</span>
        <span></span>
      </div>
      <Reveal className="session-list">
        {SESSIONS.map((session) => (
          <Link href={`/stream/${session.taskId}`} className="session-row" key={session.taskId}>
            <span className="mono">
              <span className="cell-label">Task ID</span>
              {truncate(session.taskId)}
            </span>
            <span>
              <span className="cell-label">Provider</span>
              {session.provider}
            </span>
            <span>
              <span className="cell-label">Status</span>
              <StatusBadge status={session.status} />
            </span>
            <span className="mono">
              <span className="cell-label">USDC Streamed</span>
              {session.usdcStreamed} USDC
            </span>
            <span className="row-view">View</span>
          </Link>
        ))}
      </Reveal>
    </>
  );
}
