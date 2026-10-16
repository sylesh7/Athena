// Crash-safe replacement for GatewayClient.withdraw(). Same protocol (verified by reading the SDK's implementation):
//   1. sign an EIP-712 BurnIntent, POST it to {gateway-api}/v1/transfer  → { attestation, signature }   (balance is burned NOW)
//   2. call GatewayMinter.gatewayMint(attestation, signature) on the destination chain                  (funds appear NOW)
// The SDK keeps the attestation only in memory, so a failure between 1 and 2 loses the funds. Here the attestation is saved
// to gateway_transfers before step 2, and retryPendingMints() finishes any transfer whose mint did not land.
import { CHAIN_CONFIGS } from "@circle-fin/x402-batching/client";
import { randomBytes } from "node:crypto";
import { createPublicClient, createWalletClient, fallback, http, maxUint256, pad, parseUnits, zeroAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { net } from "@athena/shared/addresses";
import { formatAmount } from "@athena/shared/money";
import { chain as arc } from "../chain/readClient.js";
import { commonCfg } from "../config.js";
import { q } from "../db.js";
import { log } from "../log.js";
import { installArcRpcRewrite } from "../chain/rpcRewrite.js";
import { gatewayAvailable } from "./gateway.js";

installArcRpcRewrite();

const MINTER_ABI = [{ name: "gatewayMint", type: "function", stateMutability: "nonpayable", inputs: [{ name: "attestationPayload", type: "bytes" }, { name: "signature", type: "bytes" }], outputs: [] }] as const;
const cfgFor = () => CHAIN_CONFIGS[commonCfg.NETWORK === "testnet" ? "arcTestnet" : "arc"];
const transport = () => fallback([http(commonCfg.RPC_URL, { timeout: 20_000, retryCount: 2 }), http(commonCfg.RPC_URL_FALLBACK, { timeout: 20_000, retryCount: 2 })]);
const b32 = (a: string) => pad(a.toLowerCase() as Hex, { size: 32 });

const TYPES = {
  EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }],
  TransferSpec: [
    { name: "version", type: "uint32" }, { name: "sourceDomain", type: "uint32" }, { name: "destinationDomain", type: "uint32" },
    { name: "sourceContract", type: "bytes32" }, { name: "destinationContract", type: "bytes32" }, { name: "sourceToken", type: "bytes32" },
    { name: "destinationToken", type: "bytes32" }, { name: "sourceDepositor", type: "bytes32" }, { name: "destinationRecipient", type: "bytes32" },
    { name: "sourceSigner", type: "bytes32" }, { name: "destinationCaller", type: "bytes32" }, { name: "value", type: "uint256" },
    { name: "salt", type: "bytes32" }, { name: "hookData", type: "bytes" },
  ],
  BurnIntent: [{ name: "maxBlockHeight", type: "uint256" }, { name: "maxFee", type: "uint256" }, { name: "spec", type: "TransferSpec" }],
} as const;

export type SafeWithdrawResult = { transferId: number; minted: boolean; mintTx?: string; error?: string };

/** Withdraw `amount` from `pk`'s Gateway balance to `recipient` on Arc. Never loses an attestation. */
export async function safeWithdraw(args: { pk: string; amount: bigint; recipient: `0x${string}`; purpose: string; maxFee?: bigint }): Promise<SafeWithdrawResult> {
  const account = privateKeyToAccount(args.pk as Hex);
  const c = cfgFor();
  const avail = await gatewayAvailable(args.pk);
  if (avail < args.amount) throw new Error(`Insufficient Gateway balance: have ${formatAmount(avail)}, need ${formatAmount(args.amount)}`);

  const burnIntent = {
    maxBlockHeight: maxUint256,
    maxFee: args.maxFee ?? parseUnits("2.01", 6),
    spec: {
      version: 1, sourceDomain: c.domain, destinationDomain: c.domain,
      sourceContract: b32(c.gatewayWallet), destinationContract: b32(c.gatewayMinter), sourceToken: b32(c.usdc), destinationToken: b32(c.usdc),
      sourceDepositor: b32(account.address), destinationRecipient: b32(args.recipient), sourceSigner: b32(account.address), destinationCaller: b32(zeroAddress),
      value: args.amount, salt: `0x${randomBytes(32).toString("hex")}` as Hex, hookData: "0x" as Hex,
    },
  };
  const signature = await account.signTypedData({ domain: { name: "GatewayWallet", version: "1" }, types: TYPES, primaryType: "BurnIntent", message: burnIntent });

  const apiUrl = `${net(commonCfg.NETWORK).gateway.api}/v1`;
  const res = await fetch(`${apiUrl}/transfer`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify([{ burnIntent, signature }], (_k, v) => (typeof v === "bigint" ? v.toString() : v)), signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json()) as { attestation?: string; signature?: string; success?: boolean; error?: string; message?: string };
  if (body.success === false || body.error || !body.attestation || !body.signature) throw new Error(`Gateway API error: ${body.message ?? body.error ?? JSON.stringify(body)}`);

  // The burn has happened. Persist the attestation FIRST — everything after this is retryable.
  const row = (await q<{ id: number }>(
    "insert into gateway_transfers(wallet, recipient, amount, purpose, attestation, signature) values ($1,$2,$3,$4,$5,$6) returning id",
    [account.address, args.recipient, args.amount.toString(), args.purpose, body.attestation, body.signature]))[0]!;
  return mintOne(row.id, args.pk);
}

async function mintOne(id: number, minterPk: string): Promise<SafeWithdrawResult> {
  const r = (await q<{ attestation: string; signature: string; status: string }>("select attestation, signature, status from gateway_transfers where id = $1", [id]))[0]!;
  if (r.status === "minted") return { transferId: id, minted: true };
  const account = privateKeyToAccount(minterPk as Hex);
  const c = cfgFor();
  try {
    const wallet = createWalletClient({ account, chain: arc, transport: transport() });
    const pub = createPublicClient({ chain: arc, transport: transport() });
    const hash = await wallet.writeContract({ address: c.gatewayMinter, abi: MINTER_ABI, functionName: "gatewayMint", args: [r.attestation as Hex, r.signature as Hex] });
    await pub.waitForTransactionReceipt({ hash, timeout: 90_000 });
    await q("update gateway_transfers set status = 'minted', mint_tx = $2, error = null, updated_at = now() where id = $1", [id, hash]);
    return { transferId: id, minted: true, mintTx: hash };
  } catch (err) {
    // The attestation is safe in the database; the next tick retries. gatewayMint is permissionless, so a human can finish it too.
    await q("update gateway_transfers set attempts = attempts + 1, error = $2, status = case when attempts + 1 >= 50 then 'failed' else status end, updated_at = now() where id = $1", [id, String(err).slice(0, 300)]);
    log.error({ transferId: id, err: String(err) }, "gatewayMint did not land — attestation saved, will retry");
    return { transferId: id, minted: false, error: String(err) };
  }
}

/** Finish any burned-but-unminted transfers. Run every cycle. */
export async function retryPendingMints(minterPk: string | undefined): Promise<number> {
  if (!minterPk) return 0;
  const rows = await q<{ id: number }>("select id from gateway_transfers where status = 'attested' order by id limit 5");
  let n = 0;
  for (const r of rows) if ((await mintOne(r.id, minterPk)).minted) n++;
  return n;
}
