// Signing wallets. ONLY the worker (and keeper/scripts) import this file; the API imports readClient.ts only.
import { createWalletClient } from "viem";
import { privateKeyToAccount, nonceManager } from "viem/accounts";
import { chain, transport } from "./readClient.js";
import { loadWorkerCfg } from "../config.js";

const w = loadWorkerCfg();

const wallet = (pk: `0x${string}`) =>
  createWalletClient({ chain, transport, account: privateKeyToAccount(pk, { nonceManager }) });

const opt = (pk: string | undefined) => (pk ? wallet(pk as `0x${string}`) : undefined);

export const operatorWallet = wallet(w.OPERATOR_PK as `0x${string}`);
export const keeperWallet = opt(w.KEEPER_PK);
export const yieldWallet = opt(w.YIELD_PK);
export const spendWallet = opt(w.SPEND_PK);
export const collectionsWallet = opt(w.COLLECTIONS_PK);
export const validatorWallet = opt(w.VALIDATOR_PK);
