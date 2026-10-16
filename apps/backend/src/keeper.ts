// Phase 38 — the keeper: an independent watchdog process. Own key (KEEPER_PK), own view of the chain; it does NOT read
// Athena's database, because a broken operator might have a broken database. flagOverdue is permissionless, so
// anyone else (a judge, an auditor) can run the same check. Run it on a different host from the worker.
import { createPublicClient, createWalletClient, fallback, http, type Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { pino } from "pino";
import { z } from "zod";
import { chainFor, type Network } from "@athena/shared/chains";
import treasuryAbiJson from "@athena/shared/abis/AthenaTreasury.json" with { type: "json" };
import { flagOverdueOnce } from "./keeper/check.js";

const log = pino({ level: "info" });
const env = z.object({
  NETWORK: z.enum(["testnet", "mainnet"]),
  RPC_URL: z.string().url(),
  RPC_URL_FALLBACK: z.string().url(),
  TREASURY_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  TREASURY_DEPLOY_BLOCK: z.coerce.bigint(),
  KEEPER_PK: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
}).parse(process.env);

const chain = chainFor(env.NETWORK as Network);
const transport = fallback([http(env.RPC_URL, { timeout: 10_000 }), http(env.RPC_URL_FALLBACK, { timeout: 10_000 })]);
const deps = {
  pub: createPublicClient({ chain, transport }) as never,
  wallet: createWalletClient({ chain, transport, account: privateKeyToAccount(env.KEEPER_PK as `0x${string}`) }) as never,
  treasury: env.TREASURY_ADDRESS as `0x${string}`,
  abi: treasuryAbiJson as Abi,
  deployBlock: env.TREASURY_DEPLOY_BLOCK,
  onFlag: (decisionId: string, hash: string) => log.error({ decisionId, hash }, "operator in audit arrears — flagged overdue"),
  onError: (decisionId: string, err: unknown) => log.warn({ decisionId, err: String(err) }, "flagOverdue failed"),
};

const tick = () => flagOverdueOnce(deps).catch((e) => log.error({ err: String(e) }, "keeper tick failed"));
log.info({ treasury: env.TREASURY_ADDRESS, network: env.NETWORK }, "Athena keeper running");
setInterval(tick, 60_000);
void tick();
