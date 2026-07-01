# Athena — Backend A README
### Owner: Smart Contracts & Settlement
**You own:** `contracts/`, `shared/addresses.json`, `shared/abis/`
You are the source of truth for every address and ABI. The moment anything deploys or changes, update `shared/` and ping both teammates immediately.

---

## 0. Your setup checklist (Day 1)

- [ ] MetaMask wallet, Arc Testnet: chainId `5042002`, RPC from `arc-canteen rpc-url`
- [ ] Testnet USDC from `faucet.circle.com` (select Arc Testnet)
- [ ] Foundry: `curl -L https://foundry.paradigm.xyz | bash && foundryup`
- [ ] Node.js 22+ (for ERC-8004 registration scripts)
- [ ] Canteen CLI: `uv tool install git+https://github.com/the-canteen-dev/ARC-cli`
- [ ] `arc-canteen login` — gets your authenticated RPC URL, sets `$RPC`
- [ ] `arc-canteen shell-init >> ~/.zshrc` — auto-loads `$RPC` in every shell

---

## 0.1 Arc facts you must design around

**USDC dual-decimal — #1 bug source:**
- ERC-20 (`0x3600000000000000000000000000000000000000`): **6 decimals** — use for ALL contract amounts
- Native (msg.value/gas): **18 decimals** — gas only, never mix with payment math
- 1 USDC in your contract = `1_000_000` (not `1_000_000_000_000_000_000`)

**`anvil` ≠ Arc:** use `anvil` for pure-logic unit tests only. All integration tests hit real Arc Testnet RPC.

**Pull-payment is mandatory:** native value transfers can revert on Arc (blocklisted addresses, zero address). One bad recipient must never block others. Always use a `withdrawable` ledger + separate `withdraw()`.

**`block.timestamp` non-strict:** use block number for ordering, not timestamp deltas.

---

## PHASE 1 — Scaffold & compile

### Phase 1.1 — Repo scaffold
```bash
mkdir athena && cd athena && git init
mkdir -p contracts/src contracts/test contracts/script backend/stream backend/agents backend/mcp-monitor backend/cctp frontend shared/abis
cd contracts && forge init --no-git --force .
```

`foundry.toml`:
```toml
[rpc_endpoints]
arc_testnet = "${RPC}"

[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc_version = "0.8.28"
```

```bash
forge install OpenZeppelin/openzeppelin-contracts@v5.1.0 --no-commit
# Confirm latest 5.x tag on GitHub before running — don't assume v5.1.0 is current
```

### Phase 1.2 — Write AthenaCommit.sol

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract AthenaCommit is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;

    struct Commitment {
        bytes32 commitHash;   // SHA-256 of structured decision JSON
        address broker;
        address client;
        uint256 bondAmount;   // 6-decimal USDC
        uint256 committedAt;  // block number
        bool revealed;
        bool slashed;
    }

    mapping(bytes32 => Commitment) public commitments; // taskId → Commitment
    mapping(address => uint256) public withdrawable;   // pull-payment ledger

    event Committed(bytes32 indexed taskId, address indexed broker, bytes32 commitHash, uint256 bondAmount);
    event Revealed(bytes32 indexed taskId, bool predictionMet, bool slashed);
    event Withdrawn(address indexed recipient, uint256 amount);

    error AlreadyCommitted();
    error NotCommitted();
    error AlreadyRevealed();
    error HashMismatch();
    error NotBroker();
    error NothingToWithdraw();

    constructor(address _usdc) {
        usdc = IERC20(_usdc);
    }

    /// @notice Broker calls BEFORE starting the stream
    /// @param taskId keccak256(abi.encodePacked(clientAddress, taskDescription, blockNumber))
    /// @param commitHash SHA-256(canonical JSON of structured decision) — computed off-chain
    /// @param bondAmount 6-decimal USDC units
    /// @param client who paid for the stream — receives bond on slash
    function commit(bytes32 taskId, bytes32 commitHash, uint256 bondAmount, address client)
        external nonReentrant
    {
        if (commitments[taskId].broker != address(0)) revert AlreadyCommitted();
        usdc.safeTransferFrom(msg.sender, address(this), bondAmount);
        commitments[taskId] = Commitment({
            commitHash: commitHash,
            broker: msg.sender,
            client: client,
            bondAmount: bondAmount,
            committedAt: block.number,
            revealed: false,
            slashed: false
        });
        emit Committed(taskId, msg.sender, commitHash, bondAmount);
    }

    /// @notice Broker calls AFTER stream ends
    /// @param predictionMet MCP monitor's final verdict — did quality+latency meet prediction?
    /// @param revealedHash SHA-256 of same JSON recomputed off-chain — must match commitHash
    function reveal(bytes32 taskId, bool predictionMet, bytes32 revealedHash)
        external nonReentrant
    {
        Commitment storage c = commitments[taskId];
        if (c.broker == address(0)) revert NotCommitted();
        if (c.revealed) revert AlreadyRevealed();
        if (msg.sender != c.broker) revert NotBroker();
        if (revealedHash != c.commitHash) revert HashMismatch();

        c.revealed = true;
        if (predictionMet) {
            withdrawable[c.broker] += c.bondAmount;
        } else {
            c.slashed = true;
            withdrawable[c.client] += c.bondAmount;
        }
        emit Revealed(taskId, predictionMet, !predictionMet);
    }

    function withdraw() external nonReentrant {
        uint256 amt = withdrawable[msg.sender];
        if (amt == 0) revert NothingToWithdraw();
        withdrawable[msg.sender] = 0;
        usdc.safeTransfer(msg.sender, amt);
        emit Withdrawn(msg.sender, amt);
    }
}
```

**Critical design decisions — don't change without team discussion:**
- `reveal()` takes `predictionMet` bool from the broker. Backend B's Mastra workflow computes this from MCP monitor's final verdict. Hash check proves broker didn't change its prediction after seeing the outcome.
- `taskId` scheme: `keccak256(abi.encodePacked(clientAddress, taskDescription, blockNumber))`. Agree this **exactly** with Backend B in Phase 1 sync — byte-for-byte identical on both sides or `commit()`/`reveal()` calls won't match.
- Bond amount in 6-decimal USDC. Never 18.
- `PaymentSplitter` is removed in OZ 5.x — don't import it.

### Phase 1.3 — Compile and sync
```bash
cd contracts && forge build
```
Exit criteria: zero errors.

**Phase 1 sync (15 min, all 3):** share `commit()`/`reveal()` signatures + agreed `taskId` scheme with Backend B. Share function signatures with Frontend. Don't leave this sync without the `taskId` scheme agreed.

---

## PHASE 2 — Deploy, test, register agents

### Phase 2.1 — Deploy
```bash
forge create contracts/src/AthenaCommit.sol:AthenaCommit \
  --rpc-url arc_testnet \
  --private-key $DEPLOYER_PK \
  --constructor-args 0x3600000000000000000000000000000000000000
```

Confirm on `https://testnet.arcscan.app`. Then immediately export ABI:
```bash
forge inspect AthenaCommit abi > ../shared/abis/AthenaCommit.json
```

Update `shared/addresses.json`:
```json
{
  "chainId": 5042002,
  "contracts": {
    "athenaCommit": "0x<deployed>",
    "erc8183": "0x0747EEf0706327138c69792bF28Cd525089e4583",
    "usdc": "0x3600000000000000000000000000000000000000",
    "erc8004Identity": "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    "erc8004Reputation": "0x8004B663056A597Dffe9eCcC1965A193B7388713",
    "cctpTokenMessengerV2": "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
    "cctpMessageTransmitterV2": "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275"
  },
  "agents": {}
}
```
**Ping Backend B and Frontend immediately. This is their unblock (H4).**

### Phase 2.2 — Test suite
`contracts/test/AthenaCommit.t.sol` must cover:
- `commit()` happy path — funds escrowed
- `commit()` duplicate taskId — reverts `AlreadyCommitted`
- `reveal()` hash mismatch — reverts `HashMismatch`
- `reveal()` wrong caller — reverts `NotBroker`
- `reveal()` prediction met — bond to broker's `withdrawable`
- `reveal()` prediction not met — bond to client's `withdrawable`
- `withdraw()` zero balance — reverts `NothingToWithdraw`
- Full happy path end to end
- Full slash path end to end

```bash
forge test -vvv                          # anvil — pure logic
cast send $ATHENA_COMMIT "commit(bytes32,bytes32,uint256,address)" \
  $TASK_ID $COMMIT_HASH 1000000 $CLIENT_ADDR \
  --rpc-url arc_testnet --private-key $BROKER_PK
# manual integration test on real Arc RPC
```

### Phase 2.3 — Register all agents on ERC-8004
Get provider wallet addresses from Backend B (their Phase 1). Register each on the **pre-deployed** IdentityRegistry:

```js
// viem against 0x8004A818BFB912233c491871b3d84c89A494BD9e
// register(string metadataURI) → tokenId from Transfer event

const tx = await walletClient.writeContract({
  address: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  abi: identityRegistryAbi,
  functionName: "register",
  args: ["data:application/json,{\"name\":\"Athena Crypto Provider\",\"capabilities\":[\"crypto-prices\"]}"],
});
// parse Transfer event from receipt for tokenId
```

Register: broker agent + all 3 provider agents. Update `shared/addresses.json`:
```json
"agents": {
  "broker": { "address": "0x...", "tokenId": 1 },
  "provider1": { "address": "0x...", "tokenId": 2, "role": "crypto-data" },
  "provider2": { "address": "0x...", "tokenId": 3, "role": "market-analytics" },
  "provider3": { "address": "0x...", "tokenId": 4, "role": "price-feed" }
}
```
Push + ping Frontend (H5). They need tokenIds for Agent Roster page.

**Do NOT build against ERC-8004 ValidationRegistry** — flagged unstable upstream. Use ReputationRegistry for trust signals.

### Phase 2.4 — ERC-8183 integration
Athena sits in the **evaluator** role in ERC-8183. Lifecycle:

```js
// createJob(provider, evaluator=brokerWallet, expiredAt, description, hook=0x0)
abiFunctionSignature: "createJob(address,address,uint256,string,address)"
abiParameters: [providerWallet, brokerWallet, expiredAt, "Athena stream task", "0x0000..."]

// After stream resolves:
// If prediction met → complete(jobId)   → escrow released to provider
// If prediction not met → reject(jobId) → escrow refunded to client
```

⚠️ ERC-8183 is a Draft EIP. Verify live ABI on Arcscan before integrating. Trust Arcscan over any spec text.

### Phase 2.5 — Manual loop with team (H6)
Run together: Backend B manually calls `commit()` → you confirm on Arcscan → Backend B runs one provider call → Backend B calls `reveal(predictionMet=true)` → you confirm bond in `withdrawable` → broker calls `withdraw()`. Repeat with `predictionMet=false` — confirm bond slashes to client. Frontend shows both states correctly.

**This is your minimum viable demo. If Phase 3 runs out of time, this alone is submittable.**

### Phase 2.6 — ERC-8004 reputation update
After every stream resolution, call `giveFeedback` on ReputationRegistry:
```js
// giveFeedback(agentId, score, feedbackType, tag, metadataURI, evidenceURI, comment, feedbackHash)
// score: 0-100 based on prediction accuracy
// feedbackType: 1 = quality review
// Note: self-feedback is blocked — feedback must come from a separate validator wallet, not the agent's own
```

---

## PHASE 3 — Support role

Backend B owns Phase 3 automation. Your job:
- Keep ABI current — re-export + ping if anything changes
- Debug `commit()`/`reveal()` call failures from Mastra workflow
- Most common failure: `taskId` mismatch between Backend B's encoding and yours. Byte-for-byte must match.
- Second most common: bond in wrong decimal scale.

---

## PHASE 4 — CCTP V2 cross-chain payout (stretch only)
**Only after Phase 3 works live end-to-end.**

Provider 3 lives on Base Sepolia. Pay them natively there:
```solidity
// TokenMessengerV2 on Arc: 0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA
// Base CCTP V2 domain: 6 (verify current list before building)

ITokenMessengerV2(0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA).depositForBurn(
    amount,       // 6-decimal USDC
    6,            // Base destination domain
    recipient,    // provider Base address as bytes32
    usdcAddress,  // 0x3600...0000
    address(0),   // destinationCaller — 0x0 = anyone can relay
    0,            // maxFee
    1000          // minFinalityThreshold = Standard
);
```
After `depositForBurn`: poll Circle Iris attestation API → call `receiveMessage` on Base MessageTransmitterV2 with attestation. Timebox at 3 hours — if destination mint doesn't complete live, show the burn tx on Arcscan as proof of mechanism.

---

## Your handoff checklist

| When | What | To whom |
|---|---|---|
| Phase 1 sync | `commit()`/`reveal()` signatures + `taskId` scheme | Both |
| Phase 2.1 | Deployed address + ABI in `shared/` + active ping | Both |
| Phase 2.3 | Agent tokenIds in `shared/addresses.json` | Frontend |
| Phase 2.5 | Confirm manual loop works live | Both |
| Phase 3 | Responsive to debugging | Backend B |
| Ongoing | Any ABI/address change → re-export + ping | Both |
