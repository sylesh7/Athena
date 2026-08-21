/**
 * lib/logBuffer.ts — real, structured, in-memory log of what the backend
 * actually did, exposed via GET /logs for the frontend's Evidence page.
 *
 * Deliberately in-memory, not persisted to disk — this is a live activity
 * feed for the current process, not a historical audit trail. The
 * historical, tamper-proof record of what actually happened is the chain
 * itself (see GET /onchain-events in entrypoint.ts, which reads real
 * Committed/Revealed events directly from AthenaCommit) — that's real
 * evidence regardless of whether this process has restarted since. This
 * buffer just makes the backend's own reasoning visible in real time,
 * the same way you'd `tail -f` its console output, but over HTTP so the
 * frontend can show it.
 */

export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
  id: number;
  timestamp: number;
  level: LogLevel;
  source: string;
  message: string;
}

const MAX_ENTRIES = 500;
const entries: LogEntry[] = [];
let nextId = 1;

export function pushLog(source: string, level: LogLevel, message: string): void {
  const entry: LogEntry = { id: nextId++, timestamp: Date.now(), level, source, message };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.shift();

  // Mirror to the real console too — this buffer supplements the existing
  // console.log/console.error calls throughout the codebase, it doesn't
  // replace them.
  const line = `[${source}] ${message}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/** Returns entries with id > sinceId (or the most recent `limit` if omitted), oldest first. */
export function getLogs(opts: { sinceId?: number; limit?: number } = {}): LogEntry[] {
  const { sinceId, limit = 200 } = opts;
  const filtered = sinceId !== undefined ? entries.filter((e) => e.id > sinceId) : entries;
  return filtered.slice(-limit);
}
