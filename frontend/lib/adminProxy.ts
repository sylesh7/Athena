// Server-only helper: forwards a request to the Athena API with the admin key, which lives only in this server's env
// (ATHENA_ADMIN_API_KEY — never NEXT_PUBLIC_*). Everything it forwards creates DRAFT rows; money still needs the
// on-chain approver, so a stranger hitting these routes can at worst add drafts (rate-limited below).
import { NextResponse } from "next/server";

const API = process.env.ATHENA_API_URL ?? process.env.NEXT_PUBLIC_ATHENA_API ?? "http://localhost:3100";
const hits: number[] = [];

export async function forwardAdmin(path: string, init: { body: BodyInit; headers?: Record<string, string> }) {
  const key = process.env.ATHENA_ADMIN_API_KEY;
  if (!key) return NextResponse.json({ error: "ATHENA_ADMIN_API_KEY is not configured on the frontend server" }, { status: 503 });
  const now = Date.now();
  while (hits.length && now - hits[0]! > 60_000) hits.shift();
  if (hits.length >= 20) return NextResponse.json({ error: "Too many requests; try again in a minute" }, { status: 429 });
  hits.push(now);
  const r = await fetch(`${API}${path}`, { method: "POST", headers: { "x-admin-key": key, ...(init.headers ?? {}) }, body: init.body }).catch(() => null);
  if (!r) return NextResponse.json({ error: "Athena API unreachable" }, { status: 502 });
  const j = await r.json().catch(() => ({}));
  return NextResponse.json(r.ok ? j : { error: j?.error?.message ?? `HTTP ${r.status}` }, { status: r.status });
}
