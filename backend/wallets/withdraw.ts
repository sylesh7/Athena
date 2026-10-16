/**
 * wallets/withdraw.ts — claims a wallet's `withdrawable` balance on
 * AthenaCommit (the pull-payment pattern the contract uses instead of
 * pushing funds automatically — see AthenaCommit.sol's own comment on why:
 * Arc can revert native/token transfers to blocklisted addresses, so both
 * `commit()`'s bond-release-on-settle and reveal()'s slash-to-client credit
 * a `withdrawable` mapping instead of transferring directly).
 *
 * Found live 2026-07-05: after enough real streams, the broker's wallet ran
 * out of USDC to post new bonds (`commit()` reverted with "ERC20: transfer
 * amount exceeds balance") even though every one of those streams had
 * *released* its bond back to the broker — because "released" only means
 * credited to `withdrawable`, not returned to the wallet. Nothing in this
 * codebase called `withdraw()` before now.
 *
 * Usage:
 *   PK=<broker or client private key> npm run wallets:withdraw
 */

import { parseAbi, formatUnits } from "viem";
import { addresses } from "../lib/config.js";
import { publicClient, requirePkEnv, walletClientFromPk } from "../lib/chain.js";

const abi = parseAbi([
  "function withdrawable(address) view returns (uint256)",
  "function withdraw() external",
]);

async function main() {
  const pk = requirePkEnv("PK");
  const wallet = walletClientFromPk(pk);
  const athenaCommit = addresses.contracts.athenaCommit as `0x${string}`;

  const before = await publicClient.readContract({
    address: athenaCommit,
    abi,
    functionName: "withdrawable",
    args: [wallet.account.address],
  });

  console.log(`${wallet.account.address} has ${formatUnits(before, 6)} USDC withdrawable on AthenaCommit`);

  if (before === 0n) {
    console.log("Nothing to withdraw.");
    return;
  }

  const txHash = await wallet.writeContract({ address: athenaCommit, abi, functionName: "withdraw" });
  console.log(`tx: ${txHash}`);
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  console.log(`✓ Withdrawn ${formatUnits(before, 6)} USDC to ${wallet.account.address}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
