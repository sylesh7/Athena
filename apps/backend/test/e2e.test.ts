// End-to-end: real contract on a local anvil (chain id 5042002), real Postgres (embedded), real worker code.
// Exercises: payee activation → cycle (default plan) → commit → execute → reveal → indexer projection → verify,
// plus the escalation path (human approval) and idempotence (a second cycle commits nothing new).
// Skipped when anvil/forge aren't on PATH. anvil is NOT Arc: this proves logic, not Arc-specific behavior.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync , readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPublicClient, createWalletClient, http, parseAbi, keccak256, stringToBytes, type Abi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import EmbeddedPostgres from "embedded-postgres";
import treasuryAbiJson from "@athena/shared/abis/AthenaTreasury.json" with { type: "json" };

const has = (c: string) => { try { execFileSync(c, ["--version"], { stdio: "ignore" }); return true; } catch { return false; } };
const runnable = has("anvil") && has("forge");

// anvil's public dev keys
const KEY = {
  deployer: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  admin: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  approver: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  operator: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
} as const satisfies Record<string, Hex>;
const USDC = "0x3600000000000000000000000000000000000000" as Address;
const EURC = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a" as Address;
const ONE = 1_000_000n;
const ANVIL_PORT = 18546;
const PG_PORT = 54343;
const RPC = `http://127.0.0.1:${ANVIL_PORT}`;
const abi = treasuryAbiJson as Abi;
const contractsDir = resolve(import.meta.dirname, "../../../packages/contracts");
const migrationsDir = resolve(import.meta.dirname, "../../../supabase/migrations");

let anvil: ChildProcess | undefined;
let pg: EmbeddedPostgres | undefined;
let pgDir = "";
let treasury: Address;
let vendor: Address;
const rnd32 = () => ("0x" + randomBytes(32).toString("hex")) as Hex;
const chain = { id: 5042002, name: "anvil-arc", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } } as const;
const pub = createPublicClient({ chain, transport: http(RPC) });
const wallet = (k: Hex) => createWalletClient({ chain, transport: http(RPC), account: privateKeyToAccount(k) });
const send = async (k: Hex, address: Address, abi_: Abi, functionName: string, args: unknown[]) => {
  const { request } = await pub.simulateContract({ account: privateKeyToAccount(k), address, abi: abi_, functionName, args } as never);
  const hash = await wallet(k).writeContract(request as never);
  await pub.waitForTransactionReceipt({ hash });
  return hash;
};
const forgeCreate = (target: string, args: string[], key: Hex): Address => {
  const out = execFileSync("forge", ["create", target, "--rpc-url", RPC, "--private-key", key, "--broadcast", "--json", "--constructor-args", ...args], { cwd: contractsDir, encoding: "utf8" });
  return JSON.parse(out.slice(out.indexOf("{"))).deployedTo as Address;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Backend modules are imported AFTER env is set (config parses env at import time).
let be: {
  q: typeof import("../src/db.js").q;
  pool: typeof import("../src/db.js").pool;
  runCycle: typeof import("../src/cycle/cycle.js").runCycle;
  indexOnce: typeof import("../src/indexer/indexer.js").indexOnce;
  loadWorkerCfg: typeof import("../src/config.js").loadWorkerCfg;
};
let entityId = "";
let payeeIdHex: Hex;

beforeAll(async () => {
  if (!runnable) return;

  // 1. chain
  anvil = spawn("anvil", ["--port", String(ANVIL_PORT), "--chain-id", "5042002", "--block-time", "1", "--silent"], { stdio: "ignore" });
  for (let i = 0; i < 50; i++) { try { await pub.getBlockNumber(); break; } catch { await sleep(200); } }

  // USDC/EURC at their real Arc addresses: deploy a mock ERC-20, copy its runtime code over the pinned address.
  for (const [addr, name, sym] of [[USDC, "USD Coin", "USDC"], [EURC, "Euro Coin", "EURC"]] as const) {
    const mock = forgeCreate("test/mocks/MockERC20.sol:MockERC20", [name, sym, "6"], KEY.deployer);
    const code = await pub.getCode({ address: mock });
    await pub.request({ method: "anvil_setCode" as never, params: [addr, code] as never });
  }
  const operatorAddr = privateKeyToAccount(KEY.operator).address;
  const adminAddr = privateKeyToAccount(KEY.admin).address;
  const approverAddr = privateKeyToAccount(KEY.approver).address;
  treasury = forgeCreate("src/AthenaTreasury.sol:AthenaTreasury", [adminAddr, approverAddr, operatorAddr, USDC, "0x00000000000000000000000000000000000000AA"], KEY.deployer);
  const deployBlock = await pub.getBlockNumber();

  const mockAbi = parseAbi(["function mint(address,uint256)"]);
  await send(KEY.deployer, USDC, mockAbi as unknown as Abi, "mint", [treasury, 2_000n * ONE]);
  await send(KEY.admin, treasury, abi, "setBudget", [keccak256(stringToBytes("VENDOR")), USDC, 2_000n * ONE, 250n * ONE, 30n * 86_400n, true]);
  await send(KEY.admin, treasury, abi, "setMinOperating", [USDC, 100n * ONE]);

  // vendor: proposed by the operator, activated by the approver (cooldown 0)
  vendor = privateKeyToAccount(("0x" + randomBytes(32).toString("hex")) as Hex).address;
  payeeIdHex = rnd32();
  await send(KEY.operator, treasury, abi, "proposePayee", [payeeIdHex, { account: vendor, remoteRecipient: "0x" + "0".repeat(64), domain: 26, category: keccak256(stringToBytes("VENDOR")), token: USDC, perTxCap: 0n }]);
  await send(KEY.approver, treasury, abi, "approvePayee", [payeeIdHex]);

  // 2. database
  pgDir = mkdtempSync(join(tmpdir(), "athena-pg-"));
  pg = new EmbeddedPostgres({ databaseDir: pgDir, user: "postgres", password: "pw", port: PG_PORT, persistent: false, initdbFlags: ["--encoding=UTF8", "--locale=C"] });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("athena");

  // 3. env, THEN import backend
  Object.assign(process.env, {
    NETWORK: "testnet", RPC_URL: RPC, RPC_URL_FALLBACK: RPC, TREASURY_ADDRESS: treasury, TREASURY_DEPLOY_BLOCK: deployBlock.toString(),
    ADMIN_ADDRESS: adminAddr, APPROVER_ADDRESS: approverAddr, SUPABASE_URL: "http://127.0.0.1:1", SUPABASE_SERVICE_ROLE_KEY: "x",
    DATABASE_URL: `postgres://postgres:pw@127.0.0.1:${PG_PORT}/athena`, REVEAL_DEADLINE_BLOCKS: "7200",
    OPERATOR_PK: KEY.operator, ANTHROPIC_API_KEY: "unused", PLANNER_MODEL: "none", EXTRACTOR_MODEL: "unused",
  });
  const db = await import("../src/db.js");
  const migrationSql = readdirSync(migrationsDir).filter((n) => n.endsWith(".sql")).sort()
    .map((f) => readFileSync(join(migrationsDir, f), "utf8"))
    .join("\n")
    .replace(/insert into storage\.buckets[^;]*;/i, ""); // Supabase-only
  await db.pool.query(migrationSql);
  be = {
    q: db.q, pool: db.pool,
    runCycle: (await import("../src/cycle/cycle.js")).runCycle,
    indexOnce: (await import("../src/indexer/indexer.js")).indexOnce,
    loadWorkerCfg: (await import("../src/config.js")).loadWorkerCfg,
  };

  entityId = (await be.q<{ id: string }>("insert into entities(name, network, treasury_address) values ('house','testnet',$1) returning id", [treasury]))[0]!.id;
  await be.q(
    `insert into payees(entity_id, slug, payee_id, name, kind, category, token, domain, account, status, active_from)
     values ($1,'vendor:hosting',$2,'Hosting Co','vendor','VENDOR','USDC',26,$3,'active', now())`,
    [entityId, payeeIdHex, vendor]);
}, 300_000);

afterAll(async () => {
  anvil?.kill();
  try { await be?.pool.end(); } catch { /* ignore */ }
  try { await pg?.stop(); } catch { /* ignore */ }
  if (pgDir) rmSync(pgDir, { recursive: true, force: true });
});

const insertObligation = async (amountUsdc: bigint, dueInDays = 0) => {
  const id = rnd32();
  await be.q(
    `insert into obligations(entity_id, obligation_id, payee_id, source, category, token, amount, due_date, criticality, evidence_hash, status)
     select $1,$2,p.id,'manual','VENDOR','USDC',$3,(current_date + $4::int),2,$5,'open' from payees p where p.slug = 'vendor:hosting'`,
    [entityId, id, (amountUsdc * ONE).toString(), dueInDays, rnd32()]);
  return id;
};
const balance = (a: Address) => pub.readContract({ address: USDC, abi: parseAbi(["function balanceOf(address) view returns (uint256)"]), functionName: "balanceOf", args: [a] });

describe.skipIf(!runnable)("end to end: cycle → commit → execute → reveal → index", () => {
  it("pays a due obligation, reveals it, and the stored record verifies against the chain", async () => {
    const obl = await insertObligation(100n);
    const res = await be.runCycle(be.loadWorkerCfg(), "scenario-e2e");
    expect(res.status).toBe("done");

    expect(await balance(vendor)).toBe(100n * ONE);
    await be.indexOnce();

    const d = (await be.q<any>("select * from decisions where obligation_id = $1", [obl]))[0];
    expect(d.kind).toBe("PAY_NOW");
    expect(d.state).toBe("executed");
    expect(d.revealed).toBe(true);
    expect(d.commit_tx && d.execute_tx && d.reveal_tx).toBeTruthy();
    expect((await be.q<any>("select status from obligations where obligation_id = $1", [obl]))[0].status).toBe("paid");

    // /decisions/:id/verify logic: stored bytes → sha256 → equals the on-chain decisionHash.
    const onchain = (await pub.readContract({ address: treasury, abi, functionName: "getDecision", args: [d.decision_id] })) as { decisionHash: Hex; revealed: boolean };
    const recomputed = "0x" + createHash("sha256").update(Buffer.from(d.record_bytes.slice(2), "hex")).digest("hex");
    expect(recomputed).toBe(onchain.decisionHash);
    expect(onchain.revealed).toBe(true);

    // the record is self-describing: what it saw, forecast, rule checks, action
    const rec = JSON.parse(d.record_json);
    expect(rec.schema).toBe("athena.decision.v1");
    expect(rec.action.amount).toBe((100n * ONE).toString());
    expect(rec.rule.checks.length).toBeGreaterThan(0);
    expect(rec.saw.snapshotHash).toMatch(/^0x[0-9a-f]{64}$/);

    // chain_events mirrors the on-chain trail
    const names = (await be.q<{ event_name: string }>("select event_name from chain_events")).map((r) => r.event_name);
    expect(names).toEqual(expect.arrayContaining(["DecisionCommitted", "DecisionExecuted", "DecisionRevealed"]));
  }, 120_000);

  it("a second cycle with nothing changed commits nothing new", async () => {
    const before = Number((await be.q<any>("select count(*)::int as n from decisions"))[0].n);
    const res = await be.runCycle(be.loadWorkerCfg(), "scenario-e2e");
    expect(res.status).toBe("done");
    expect(Number((await be.q<any>("select count(*)::int as n from decisions"))[0].n)).toBe(before);
  }, 120_000);

  it("a future obligation is SCHEDULED once, not re-committed every cycle", async () => {
    const obl = await insertObligation(50n, 20);
    await be.runCycle(be.loadWorkerCfg(), "scenario-e2e");
    const n1 = Number((await be.q<any>("select count(*)::int as n from decisions where obligation_id = $1", [obl]))[0].n);
    await be.runCycle(be.loadWorkerCfg(), "scenario-e2e");
    const n2 = Number((await be.q<any>("select count(*)::int as n from decisions where obligation_id = $1", [obl]))[0].n);
    expect(n1).toBe(1);
    expect(n2).toBe(1);
    const d = (await be.q<any>("select kind, state, revealed from decisions where obligation_id = $1", [obl]))[0];
    expect(d.kind).toBe("SCHEDULE");
    expect(d.state).toBe("noop");
    expect(d.revealed).toBe(true);
  }, 180_000);

  it("an over-limit payment escalates, a human approves it, and the indexer marks it paid", async () => {
    const before = await balance(vendor);
    const obl = await insertObligation(300n); // approval limit is 250
    await be.runCycle(be.loadWorkerCfg(), "scenario-e2e");
    expect(await balance(vendor)).toBe(before); // not paid yet
    await be.indexOnce();

    const d = (await be.q<any>("select decision_id, state, revealed from decisions where obligation_id = $1", [obl]))[0];
    expect(d.state).toBe("escalated");
    expect(d.revealed).toBe(true); // escalated decisions are still revealed immediately
    expect((await be.q<any>("select status, reason from escalations where decision_id = $1", [d.decision_id]))[0]).toMatchObject({ status: "pending", reason: 2 });

    await send(KEY.approver, treasury, abi, "approveEscalation", [d.decision_id]);
    await be.indexOnce();
    expect(await balance(vendor)).toBe(before + 300n * ONE);
    expect((await be.q<any>("select status from obligations where obligation_id = $1", [obl]))[0].status).toBe("paid");
    expect((await be.q<any>("select status from escalations where decision_id = $1", [d.decision_id]))[0].status).toBe("approved");
  }, 180_000);

  it("metrics are computed from the mirror, and scenario runs are excluded from operating totals", async () => {
    const { computeMetrics } = await import("../src/metrics/metrics.js");
    // every decision in this suite is tagged scenario-* ⇒ operating totals stay at zero
    const m = await computeMetrics("testnet", null);
    expect(m.usdcPaidOut).toBe("0");
    expect(m.decisionsMade).toBe(0);
    expect(m.decisionsRevealedOnChain).toBe(3);
    // …and the same data counted as operating (flip the flag) matches what actually moved on-chain: 100 + 300 USDC
    await be.q("update decisions set scenario = false");
    const op = await computeMetrics("testnet", null);
    expect(op.usdcPaidOut).toBe((400n * ONE).toString());
    expect(op.decisionsEscalated).toBe(1);
    expect(op.businessesOperated).toBe(1);
    expect(op.obligationsSettledOnTimeNoHuman).toBe(1); // the 300 one needed a human
    expect(op.escalationAgreementBps).toBe(10_000);
  }, 60_000);

  it("a send of unexpected funds lands in unattributed_inflows", async () => {
    const mockAbi = parseAbi(["function mint(address,uint256)", "function transfer(address,uint256) returns (bool)"]) as unknown as Abi;
    await send(KEY.deployer, USDC, mockAbi, "mint", [privateKeyToAccount(KEY.deployer).address, 5n * ONE]);
    await send(KEY.deployer, USDC, mockAbi, "transfer", [treasury, 1n * ONE]);
    await be.indexOnce();
    const rows = await be.q<any>("select amount::text from unattributed_inflows");
    expect(rows.map((r) => r.amount)).toContain((1n * ONE).toString());
  }, 60_000);
});
