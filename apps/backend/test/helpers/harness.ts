// Shared integration harness: local anvil (chain id 5042002) + real contract + embedded Postgres + env wiring.
// Backend modules read env at import time, so tests must import them via `harness.be` AFTER start().
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { createPublicClient, createWalletClient, http, keccak256, parseAbi, stringToBytes, type Abi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import EmbeddedPostgres from "embedded-postgres";
import treasuryAbiJson from "@athena/shared/abis/AthenaTreasury.json" with { type: "json" };

export const has = (c: string) => { try { execFileSync(c, ["--version"], { stdio: "ignore" }); return true; } catch { return false; } };
export const runnable = has("anvil") && has("forge");

// anvil's public dev keys
export const KEY = {
  deployer: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  admin: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  approver: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  operator: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  stranger: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
} as const satisfies Record<string, Hex>;
export const USDC = "0x3600000000000000000000000000000000000000" as Address;
export const EURC = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a" as Address;
export const ONE = 1_000_000n;
export const abi = treasuryAbiJson as Abi;
export const rnd32 = () => ("0x" + randomBytes(32).toString("hex")) as Hex;
export const randAddr = () => privateKeyToAccount(rnd32()).address;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const VENDOR_CAT = keccak256(stringToBytes("VENDOR"));

const contractsDir = resolve(import.meta.dirname, "../../../../packages/contracts");
const migrationsDir = resolve(import.meta.dirname, "../../../../supabase/migrations");

export interface Harness {
  rpc: string;
  treasury: Address;
  deployBlock: bigint;
  entityId: string;
  pub: ReturnType<typeof createPublicClient>;
  send: (key: Hex, address: Address, abi_: Abi, functionName: string, args: unknown[]) => Promise<Hex>;
  balance: (a: Address) => Promise<bigint>;
  /** Propose (operator) + approve (approver) a payee on-chain with cooldown 0. */
  activatePayee: (payeeId: Hex, account: Address, category?: Hex) => Promise<void>;
  q: typeof import("../../src/db.js").q;
  pool: typeof import("../../src/db.js").pool;
  stop: () => Promise<void>;
}

export async function startHarness(ports: { anvil: number; pg: number }): Promise<Harness> {
  const rpc = `http://127.0.0.1:${ports.anvil}`;
  const chain = { id: 5042002, name: "anvil-arc", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } } as const;
  const pub = createPublicClient({ chain, transport: http(rpc) });
  const send: Harness["send"] = async (k, address, abi_, functionName, args) => {
    const { request } = await pub.simulateContract({ account: privateKeyToAccount(k), address, abi: abi_, functionName, args } as never);
    const hash = await createWalletClient({ chain, transport: http(rpc), account: privateKeyToAccount(k) }).writeContract(request as never);
    await pub.waitForTransactionReceipt({ hash });
    return hash;
  };
  const forgeCreate = (target: string, args: string[]): Address => {
    const out = execFileSync("forge", ["create", target, "--rpc-url", rpc, "--private-key", KEY.deployer, "--broadcast", "--json", "--constructor-args", ...args], { cwd: contractsDir, encoding: "utf8" });
    return JSON.parse(out.slice(out.indexOf("{"))).deployedTo as Address;
  };

  const anvil: ChildProcess = spawn("anvil", ["--port", String(ports.anvil), "--chain-id", "5042002", "--block-time", "1", "--silent"], { stdio: "ignore" });
  for (let i = 0; i < 50; i++) { try { await pub.getBlockNumber(); break; } catch { await sleep(200); } }

  // USDC/EURC at their real Arc addresses: deploy a mock ERC-20, copy its runtime code over the pinned address.
  for (const [addr, name, sym] of [[USDC, "USD Coin", "USDC"], [EURC, "Euro Coin", "EURC"]] as const) {
    const mock = forgeCreate("test/mocks/MockERC20.sol:MockERC20", [name, sym, "6"]);
    await pub.request({ method: "anvil_setCode" as never, params: [addr, await pub.getCode({ address: mock })] as never });
  }
  const adminAddr = privateKeyToAccount(KEY.admin).address;
  const approverAddr = privateKeyToAccount(KEY.approver).address;
  const operatorAddr = privateKeyToAccount(KEY.operator).address;
  const treasury = forgeCreate("src/AthenaTreasury.sol:AthenaTreasury", [adminAddr, approverAddr, operatorAddr, USDC, "0x00000000000000000000000000000000000000AA"]);
  const deployBlock = await pub.getBlockNumber();

  const mintAbi = parseAbi(["function mint(address,uint256)"]) as unknown as Abi;
  await send(KEY.deployer, USDC, mintAbi, "mint", [treasury, 2_000n * ONE]);
  await send(KEY.admin, treasury, abi, "setBudget", [VENDOR_CAT, USDC, 2_000n * ONE, 250n * ONE, 30n * 86_400n, true]);
  await send(KEY.admin, treasury, abi, "setMinOperating", [USDC, 100n * ONE]);

  const pgDir = mkdtempSync(join(tmpdir(), "athena-pg-"));
  const pg = new EmbeddedPostgres({ databaseDir: pgDir, user: "postgres", password: "pw", port: ports.pg, persistent: false, initdbFlags: ["--encoding=UTF8", "--locale=C"] });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("athena");

  Object.assign(process.env, {
    NETWORK: "testnet", RPC_URL: rpc, RPC_URL_FALLBACK: rpc, TREASURY_ADDRESS: treasury, TREASURY_DEPLOY_BLOCK: deployBlock.toString(),
    ADMIN_ADDRESS: adminAddr, APPROVER_ADDRESS: approverAddr, SUPABASE_URL: "http://127.0.0.1:1", SUPABASE_SERVICE_ROLE_KEY: "x",
    DATABASE_URL: `postgres://postgres:pw@127.0.0.1:${ports.pg}/athena`, REVEAL_DEADLINE_BLOCKS: "7200",
    OPERATOR_PK: KEY.operator, ANTHROPIC_API_KEY: "unused", PLANNER_MODEL: "none", EXTRACTOR_MODEL: "unused",
  });
  const db = await import("../../src/db.js");
  const sql = ["0001_init.sql", "0002_security.sql"].map((f) => readFileSync(join(migrationsDir, f), "utf8")).join("\n")
    .replace(/insert into storage\.buckets[^;]*;/i, ""); // Supabase-only
  await db.pool.query(sql);
  const entityId = (await db.q<{ id: string }>("insert into entities(name, network, treasury_address) values ('house','testnet',$1) returning id", [treasury]))[0]!.id;

  const balanceAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
  return {
    rpc, treasury, deployBlock, entityId, pub, send, q: db.q, pool: db.pool,
    balance: (a) => pub.readContract({ address: USDC, abi: balanceAbi, functionName: "balanceOf", args: [a] }) as Promise<bigint>,
    activatePayee: async (payeeId, account, category = VENDOR_CAT) => {
      await send(KEY.operator, treasury, abi, "proposePayee", [payeeId, { account, remoteRecipient: "0x" + "0".repeat(64), domain: 26, category, token: USDC, perTxCap: 0n }]);
      await send(KEY.approver, treasury, abi, "approvePayee", [payeeId]);
    },
    stop: async () => {
      anvil.kill();
      try { await db.pool.end(); } catch { /* ignore */ }
      try { await pg.stop(); } catch { /* ignore */ }
      rmSync(pgDir, { recursive: true, force: true });
    },
  };
}
