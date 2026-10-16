// API surface over data produced by a REAL cycle: decisions list/detail, the browser-verifiable /verify endpoint, cycles,
// metrics, and the Server-Sent Events stream receiving live events while a cycle runs.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { keccak256 } from "viem";
import { randomUUID } from "node:crypto";
import { rnd32, randAddr, runnable, startHarness, ONE, type Harness } from "./helpers/harness.js";

const API_PORT = 18132;
const API = `http://127.0.0.1:${API_PORT}`;
let h: Harness;
let run: () => Promise<any>;

beforeAll(async () => {
  if (!runnable) return;
  h = await startHarness({ anvil: 18553, pg: 54336 });
  Object.assign(process.env, { API_PORT: String(API_PORT), ADMIN_API_KEY: "test-admin-key-0123456789abcdef0123", CORS_ORIGIN: "http://localhost:3000", PUBLIC_BASE_URL: API, FRONTEND_URL: "http://localhost:3000" });
  const payeeId = rnd32();
  const acct = randAddr();
  await h.activatePayee(payeeId, acct);
  await h.q(
    `insert into payees(entity_id, slug, payee_id, name, kind, category, token, domain, account, status, active_from)
     values ($1,'vendor:hosting',$2,'Hosting Co','vendor','VENDOR','USDC',26,$3,'active',now())`, [h.entityId, payeeId, acct]);
  const { runCycle } = await import("../src/cycle/cycle.js");
  const { loadWorkerCfg } = await import("../src/config.js");
  run = () => runCycle(loadWorkerCfg(), "scenario-api");
  await import("../src/api.js");
  for (let i = 0; i < 50; i++) { try { await fetch(`${API}/health`); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }
}, 300_000);

afterAll(async () => { await h?.stop(); });

const get = async (path: string) => { const r = await fetch(`${API}${path}`); return { status: r.status, body: await r.json().catch(() => null) as any }; };

describe.skipIf(!runnable)("SSE live events (Phase 40.5)", () => {
  it("streams decision.committed → executed → revealed as a cycle runs, and survives a client disconnect", async () => {
    const ctrl = new AbortController();
    const res = await fetch(`${API}/events/stream`, { signal: ctrl.signal, headers: { accept: "text/event-stream" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const seen: string[] = [];
    const reader = res.body!.getReader();
    const pump = (async () => {
      const dec = new TextDecoder();
      let buf = "";
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          buf += dec.decode(value, { stream: true });
          for (const m of buf.matchAll(/^event: (.+)$/gm)) seen.push(m[1]!);
        }
      } catch { /* aborted */ }
    })();

    await new Promise((r) => setTimeout(r, 400)); // let LISTEN settle
    const obl = rnd32();
    await h.q(
      `insert into obligations(entity_id, obligation_id, payee_id, source, category, token, amount, due_date, criticality, evidence_hash, status)
       select $1,$2,p.id,'manual','VENDOR','USDC',$3,current_date,2,$4,'open' from payees p where p.slug = 'vendor:hosting'`,
      [h.entityId, obl, (40n * ONE).toString(), rnd32()]);
    expect((await run()).status).toBe("done");
    await new Promise((r) => setTimeout(r, 1_500));

    ctrl.abort(); await pump;
    expect(seen).toEqual(expect.arrayContaining(["cycle.step", "decision.committed", "decision.executed", "decision.revealed"]));
    // order within one decision's life: committed before executed before revealed
    expect(seen.indexOf("decision.committed")).toBeLessThan(seen.indexOf("decision.executed"));
    expect(seen.indexOf("decision.executed")).toBeLessThan(seen.indexOf("decision.revealed"));

    // the API is still healthy after a client dropped mid-stream (no leaked listener crash)
    expect((await get("/health")).status).toBe(200);
  }, 240_000);
});

describe.skipIf(!runnable)("decisions API and browser-side verification (Phase 40.2)", () => {
  it("lists decisions newest first with explorer links, and returns the full record", async () => {
    const list = await get("/decisions?limit=10");
    expect(list.status).toBe(200);
    const d = list.body.items.find((x: any) => x.kind === "PAY_NOW");
    expect(d).toBeTruthy();
    expect(d.explorer.commit).toContain("/tx/0x");

    const one = await get(`/decisions/${d.decision_id}`);
    expect(one.body.record.schema).toBe("athena.decision.v1");
    expect(one.body.record.action.amount).toBe((40n * ONE).toString());
    expect(one.body.revealed).toBe(true);
    expect((await get("/decisions?state=executed")).body.items.length).toBeGreaterThan(0);
    expect((await get("/decisions?kind=NOPE")).body.items).toHaveLength(0);
  });

  it("/verify returns everything a browser needs: stored bytes → SHA-256 → equals the on-chain hash and the revealed bytes", async () => {
    const d = (await get("/decisions?limit=10")).body.items.find((x: any) => x.kind === "PAY_NOW");
    const v = (await get(`/decisions/${d.decision_id}/verify`)).body;
    expect(v.match).toBe(true);
    expect(v.revealed).toBe(true);
    expect(v.revealedBytesEqual).toBe(true);
    expect(v.onchainDecisionHash).toBe(v.recomputedSha256);
    // independent recomputation in THIS process, exactly as a browser would do it
    const { createHash } = await import("node:crypto");
    expect(`0x${createHash("sha256").update(Buffer.from(v.recordBytes.slice(2), "hex")).digest("hex")}`).toBe(v.onchainDecisionHash);
  });

  it("detects tampering: if the stored bytes are altered in the database, verify reports a mismatch", async () => {
    const d = (await get("/decisions?limit=10")).body.items.find((x: any) => x.kind === "PAY_NOW");
    const orig = (await h.q<any>("select record_bytes from decisions where decision_id = $1", [d.decision_id]))[0].record_bytes as string;
    await h.q("update decisions set record_bytes = $2 where decision_id = $1", [d.decision_id, orig.slice(0, -2) + (orig.endsWith("00") ? "01" : "00")]);
    const v = (await get(`/decisions/${d.decision_id}/verify`)).body;
    expect(v.match).toBe(false);
    expect(v.revealedBytesEqual).toBe(false);
    await h.q("update decisions set record_bytes = $2 where decision_id = $1", [d.decision_id, orig]); // restore
    expect((await get(`/decisions/${d.decision_id}/verify`)).body.match).toBe(true);
  });

  it("cycles expose per-step timings and the plan; metrics reflect the settled payment", async () => {
    const cycles = await get("/cycles");
    const c = cycles.body.items[0];
    expect(c.status).toBe("done");
    const names = (c.validation.steps as any[]).map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(["recover", "sync", "snapshot", "forecast_inputs", "policy", "commit", "execute", "reveal", "metrics"]));
    const detail = await get(`/cycles/${c.id}`);
    expect(detail.body.decisions.length).toBeGreaterThan(0);
    expect(detail.body.plan.mode).toBe("default_policy");

    const m = (await get("/metrics")).body;
    expect(m.latest.data.network).toBe("testnet");
    expect(m.latest.data.decisionsRevealedOnChain).toBeGreaterThan(0);
  });

  it("treasury overview and forecast come from the latest cycle's pinned snapshot", async () => {
    const o = (await get("/treasury/overview")).body;
    expect(o.chainId).toBe(5042002);
    expect(o.snapshotHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(o.budgets.find((b: any) => b.category === "VENDOR").token).toBe("USDC");
    expect((await get("/treasury/forecast")).body.horizonDays).toBe(30);
  });
});
void keccak256; void randomUUID;
