// The only way to send a transaction: simulate → send → wait → decode custom errors.
import { BaseError, ContractFunctionRevertedError, type Abi, type Address, type Hash, type WalletClient } from "viem";
import { pub, treasuryAbi, TREASURY } from "./readClient.js";
import { log } from "../log.js";

export class Reverted extends Error {
  constructor(public errorName: string, public args: readonly unknown[]) {
    super(`${errorName}(${args.join(",")})`);
  }
}

/** A receipt timeout is NOT a failure: the tx may still land. Callers must re-read chain state before retrying. */
export class ReceiptTimeout extends Error {
  constructor(public hash: Hash) {
    super(`timed out waiting for ${hash}`);
  }
}

export async function send(opts: {
  wallet: WalletClient;
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  label: string;
}): Promise<{ hash: Hash; blockNumber: bigint; logs: readonly unknown[] }> {
  let hash: Hash | undefined;
  try {
    // 1. simulate — surfaces custom errors before spending gas
    const { request } = await pub.simulateContract({
      account: opts.wallet.account!, address: opts.address, abi: opts.abi,
      functionName: opts.functionName, args: opts.args,
    } as never);
    // 2. send
    hash = await opts.wallet.writeContract(request as never);
    // 3. wait — Arc finality is immediate, one confirmation is final
    let rcpt;
    try {
      rcpt = await pub.waitForTransactionReceipt({ hash, timeout: 60_000 });
    } catch {
      throw new ReceiptTimeout(hash);
    }
    if (rcpt.status !== "success") throw new Error(`${opts.label}: reverted on-chain in ${hash}`);
    log.info({ label: opts.label, hash, block: rcpt.blockNumber.toString() }, "tx ok");
    return { hash, blockNumber: rcpt.blockNumber, logs: rcpt.logs };
  } catch (err) {
    if (err instanceof ReceiptTimeout) throw err;
    if (err instanceof BaseError) {
      const rev = err.walk((e) => e instanceof ContractFunctionRevertedError);
      if (rev instanceof ContractFunctionRevertedError) {
        throw new Reverted(rev.data?.errorName ?? "unknown", rev.data?.args ?? []);
      }
    }
    throw err;
  }
}

/** Convenience for treasury calls. */
export const sendTreasury = (wallet: WalletClient, functionName: string, args: readonly unknown[], label: string) =>
  send({ wallet, address: TREASURY, abi: treasuryAbi, functionName, args, label });
