// Registers Athena's OPERATOR as an ERC-8004 agent (Arc testnet). Idempotent in spirit: it refuses if ERC8004_AGENT_ID is already
// set. Run once, then put the printed id in .env.local as ERC8004_AGENT_ID (enables the daily reputation post).
import { operatorWallet } from "../src/chain/clients.js";
import { send } from "../src/chain/tx.js";
import { registerAgentMetadata } from "../src/reputation/erc8004.js";
import { TREASURY } from "../src/chain/readClient.js";
import { net } from "@athena/shared/addresses";
import { commonCfg } from "../src/config.js";

if ((process.env.ERC8004_AGENT_ID ?? "").trim()) {
  console.log(`ERC8004_AGENT_ID is already set (${process.env.ERC8004_AGENT_ID}) — not registering a second identity`);
  process.exit(0);
}
const r = await registerAgentMetadata({
  send, wallet: operatorWallet as never, name: "Athena Treasury Operator",
  description: "Autonomous treasury operator: commits every decision on-chain before it acts and reveals it afterwards.", treasury: TREASURY,
});
console.log(`registered. tokenId: ${r.tokenId}`);
console.log(`tx: ${net(commonCfg.NETWORK).explorer}/tx/${r.hash}`);
console.log(`\nAdd to apps/backend/.env.local:\nERC8004_AGENT_ID=${r.tokenId}`);
process.exit(0);
