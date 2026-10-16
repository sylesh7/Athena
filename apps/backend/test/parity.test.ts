// Phase 15.8 — the backend's hashing must provably match the contract's. If this fails, nothing else works.
// Runs against a throwaway local anvil (unit-level parity only: anvil is NOT Arc, see README). Skipped when
// foundry's anvil/forge aren't on PATH. To run against the live deployment instead, set PARITY_RPC_URL +
// PARITY_TREASURY and the test reads hashAction/hashRecord from that contract.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPublicClient, createWalletClient, http, type Abi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import treasuryAbiJson from "@athena/shared/abis/AthenaTreasury.json" with { type: "json" };
import { actionHash } from "@athena/shared/action";
import { canonicalRecord } from "@athena/shared/canonical";

const abi = treasuryAbiJson as Abi;
const has = (cmd: string) => { try { execFileSync(cmd, ["--version"], { stdio: "ignore" }); return true; } catch { return false; } };
const live = process.env.PARITY_RPC_URL && process.env.PARITY_TREASURY;
const runnable = Boolean(live) || (has("anvil") && has("forge"));

const ANVIL_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex; // anvil account 0 (public test key)
const PORT = 18545;
let proc: ChildProcess | undefined;
let rpc = `http://127.0.0.1:${PORT}`;
let treasury: Address;

const rnd32 = () => ("0x" + randomBytes(32).toString("hex")) as Hex;
const rndAddr = () => ("0x" + randomBytes(20).toString("hex")) as Address;
const rndBig = () => BigInt("0x" + randomBytes(12).toString("hex"));

beforeAll(async () => {
  if (!runnable) return;
  if (live) { rpc = process.env.PARITY_RPC_URL!; treasury = process.env.PARITY_TREASURY as Address; return; }
  proc = spawn("anvil", ["--port", String(PORT), "--silent"], { stdio: "ignore" });
  const pub = createPublicClient({ transport: http(rpc) });
  for (let i = 0; i < 50; i++) { try { await pub.getBlockNumber(); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }

  const contracts = resolve(import.meta.dirname, "../../../packages/contracts");
  const acct = privateKeyToAccount(ANVIL_PK);
  const out = execFileSync(
    "forge",
    ["create", "src/AthenaTreasury.sol:AthenaTreasury", "--rpc-url", rpc, "--private-key", ANVIL_PK, "--broadcast", "--json", "--constructor-args",
      rndAddr(), rndAddr(), rndAddr(), rndAddr(), rndAddr()],
    { cwd: contracts, encoding: "utf8" },
  );
  treasury = JSON.parse(out.slice(out.indexOf("{"))).deployedTo as Address;
  void acct; void createWalletClient;
}, 120_000);

afterAll(() => { proc?.kill(); });

describe.skipIf(!runnable)("TS ↔ Solidity hash parity", () => {
  const pub = () => createPublicClient({ transport: http(rpc) });

  it("actionHash matches AthenaTreasury.hashAction for 200 random actions", async () => {
    for (let i = 0; i < 200; i++) {
      const a = { kind: 1 + (i % 3), obligationId: rnd32(), payeeId: rnd32(), token: rndAddr(), amount: rndBig(), maxFee: rndBig(), evidenceHash: rnd32() };
      const onchain = await pub().readContract({ address: treasury, abi, functionName: "hashAction", args: [a] });
      expect(onchain).toBe(actionHash(a));
    }
  }, 120_000);

  it("canonical record sha256 matches AthenaTreasury.hashRecord for 50 random records", async () => {
    for (let i = 0; i < 50; i++) {
      const rec = canonicalRecord({ schema: "athena.decision.v1", i, amount: rndBig().toString(), nested: { z: rnd32(), a: [i, "x"] }, note: "héllo ✓" });
      const onchain = await pub().readContract({ address: treasury, abi, functionName: "hashRecord", args: [rec.bytes] });
      expect(onchain).toBe(rec.sha256);
    }
  }, 120_000);
});
