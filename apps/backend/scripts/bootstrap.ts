// One-time bootstrap after deploy + configure. Idempotent. Reads the same env as the worker.
//   1. inserts the `entities` row the worker/API look up by treasury address
//   2. (as OPERATOR) proposes the internal payees: yield / spend / fx wallets, if their addresses are in env
//   3. prints the exact commands/links for the human APPROVER to activate them
// It never holds or asks for the admin/approver keys.
import { loadWorkerCfg, commonCfg } from "../src/config.js";
import { q, pool } from "../src/db.js";
import { operatorWallet } from "../src/chain/clients.js";
import { sendTreasury, Reverted } from "../src/chain/tx.js";
import { payeeId } from "@athena/shared/ids";
import { CATEGORY } from "@athena/shared/categories";
import { net } from "@athena/shared/addresses";
import { privateKeyToAccount } from "viem/accounts";
import { TREASURY, pub, treasuryAbi } from "../src/chain/readClient.js";
import { zeroHash } from "viem";

const w = loadWorkerCfg();
const name = process.env.ENTITY_NAME ?? "Athena Labs (house operations)";

const existing = await q<{ id: string }>("select id from entities where treasury_address ilike $1", [TREASURY]);
const entityId = existing[0]?.id ?? (await q<{ id: string }>(
  "insert into entities(name, network, treasury_address) values ($1,$2,$3) returning id", [name, commonCfg.NETWORK, TREASURY]))[0]!.id;
console.log(`entity: ${entityId} (${name})`);

// Sanity: the operator key must actually hold OPERATOR_ROLE on this treasury.
const role = (await pub.readContract({ address: TREASURY, abi: treasuryAbi, functionName: "OPERATOR_ROLE" })) as `0x${string}`;
const ok = (await pub.readContract({ address: TREASURY, abi: treasuryAbi, functionName: "hasRole", args: [role, operatorWallet.account!.address] })) as boolean;
if (!ok) throw new Error(`${operatorWallet.account!.address} does not hold OPERATOR_ROLE on ${TREASURY} — check OPERATOR_PK vs the deploy's OPERATOR_ADDRESS`);

const usdc = net(commonCfg.NETWORK).tokens.USDC as `0x${string}`;
const internal = [
  { slug: "internal:yield", name: "Yield wallet", category: "YIELD" as const, pk: w.YIELD_PK },
  { slug: "internal:spend", name: "Services spend wallet", category: "SERVICES" as const, pk: w.SPEND_PK },
] as const;
if (w.FX_WALLET_ADDRESS) {
  // FX wallet is a Circle DCW (address only, no key).
  await propose("internal:fx", "FX wallet", "FX", w.FX_WALLET_ADDRESS as `0x${string}`);
}
for (const p of internal) {
  if (!p.pk) { console.log(`skip ${p.slug}: no key in env`); continue; }
  await propose(p.slug, p.name, p.category, privateKeyToAccount(p.pk as `0x${string}`).address);
}

async function propose(slug: string, label: string, category: keyof typeof CATEGORY, account: `0x${string}`) {
  const id = payeeId(TREASURY, slug);
  await q(
    `insert into payees(entity_id, slug, payee_id, name, kind, category, token, domain, account, status)
     values ($1,$2,$3,$4,'internal',$5,'USDC',26,$6,'proposed') on conflict (entity_id, slug) do nothing`,
    [entityId, slug, id, label, category, account]);
  try {
    const { hash } = await sendTreasury(operatorWallet, "proposePayee", [
      id, { account, remoteRecipient: zeroHash, domain: 26, category: CATEGORY[category], token: usdc, perTxCap: 0n },
    ], `proposePayee ${slug}`);
    console.log(`proposed ${slug} (${account}) tx ${hash}`);
  } catch (e) {
    if (e instanceof Reverted) { console.log(`skip ${slug}: ${e.errorName} (budget for ${category}/USDC missing, or already proposed)`); return; }
    throw e;
  }
  console.log(`  approver: cast send ${TREASURY} "approvePayee(bytes32)" ${id} --rpc-url $RPC_URL --account athena-approver`);
}

await pool.end();
