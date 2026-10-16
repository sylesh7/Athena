// Indexer catch-up across many chunks (regression: a rewrite once forgot to advance the cursor and re-indexed the same range
// forever). Events are placed on BOTH sides of several chunk boundaries; catch-up must finish, find all of them exactly once,
// and be a cheap no-op afterwards.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { abi, KEY, rnd32, randAddr, runnable, startHarness, type Harness } from "./helpers/harness.js";

let h: Harness;
let indexOnce: typeof import("../src/indexer/indexer.js").indexOnce;

beforeAll(async () => {
  if (!runnable) return;
  process.env.INDEXER_CHUNK = "2000"; // small chunks so a modest backlog crosses several boundaries
  h = await startHarness({ anvil: 18554, pg: 54337 });
  ({ indexOnce } = await import("../src/indexer/indexer.js"));
}, 300_000);
afterAll(async () => { await h?.stop(); });

const mine = async (n: number) => { // anvil_mine of thousands of blocks exceeds the client timeout in one call: batch it
  for (let left = n; left > 0; left -= 500) await h.pub.request({ method: "anvil_mine" as never, params: [`0x${Math.min(500, left).toString(16)}`] as never });
};

describe.skipIf(!runnable)("indexer catch-up (Phase 17)", () => {
  it("walks an 11,000-block backlog (5+ chunks of 2,000), finds events on both sides of every boundary exactly once, and stops", async () => {
    // early events (right after deploy)
    const a = rnd32(), b = rnd32();
    await h.activatePayee(a, randAddr());
    await mine(5_000);
    await h.activatePayee(b, randAddr());
    await mine(6_000);
    await h.send(KEY.operator, h.treasury, abi, "commit", [rnd32(), rnd32(), "0x" + "0".repeat(64)]); // a no-op decision at the far end

    const t0 = Date.now();
    const r = await indexOnce();
    expect(Date.now() - t0).toBeLessThan(60_000);
    const head = await h.pub.getBlockNumber({ cacheTime: 0 });
    expect(r.to <= head && head - r.to < 60n).toBe(true); // the chain keeps producing 1-s blocks while we index

    const rows = await h.q<any>("select event_name, count(*)::int n from chain_events group by 1");
    const count = (name: string) => rows.find((x: any) => x.event_name === name)?.n ?? 0;
    expect(count("PayeeProposed")).toBe(2);
    expect(count("PayeeApproved")).toBe(2);
    expect(count("DecisionCommitted")).toBe(1);
    expect((await h.q<any>("select last_block::text from indexer_state"))[0].last_block).toBe(r.to.toString());

    // idempotent and cheap once caught up
    const t1 = Date.now();
    const r2 = await indexOnce();
    expect(r2.events).toBe(0);
    expect(Date.now() - t1).toBeLessThan(5_000);
    expect((await h.q<any>("select count(*)::int n from chain_events"))[0].n).toBe(rows.reduce((s: number, x: any) => s + x.n, 0));
  }, 240_000);
});
