// Server-side proxy for the admin "run cycle" trigger. The admin key lives only in this server's env (never NEXT_PUBLIC_*),
// so the browser can request a cycle without ever holding the key. A short cooldown stops accidental hammering (each
// cycle can call the LLM planner).
import { NextResponse } from "next/server";

const API = process.env.ATHENA_API_URL ?? process.env.NEXT_PUBLIC_ATHENA_API ?? "http://localhost:3100";
let last = 0;

export async function POST(req: Request) {
  const key = process.env.ATHENA_ADMIN_API_KEY;
  if (!key) return NextResponse.json({ error: "ATHENA_ADMIN_API_KEY is not configured on the frontend server" }, { status: 503 });
  if (Date.now() - last < 30_000) return NextResponse.json({ error: "A cycle was just requested; wait 30 seconds" }, { status: 429 });
  const { dryRun } = (await req.json().catch(() => ({}))) as { dryRun?: boolean };
  last = Date.now();
  const r = await fetch(`${API}/admin/cycle/${dryRun ? "dry-run" : "run"}`, { method: "POST", headers: { "x-admin-key": key } }).catch(() => null);
  if (!r) return NextResponse.json({ error: "Athena API unreachable" }, { status: 502 });
  return NextResponse.json(await r.json().catch(() => ({})), { status: r.status });
}
