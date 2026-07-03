# Athena — Backend A README
### Owner: Smart Contracts & Settlement
**You own:** `contracts/`, `shared/addresses.json`, `shared/abis/`
You are the source of truth for every address and ABI. The moment anything deploys or changes, update `shared/` and ping both teammates immediately.

---

## STATUS CHECKLIST — What's done / what's next

Use this as your live tracker. Update it as you complete each item.

### Phase 1 — Scaffold & contracts
- [x] `contracts/` folder created with `foundry.toml`
- [x] OpenZeppelin v5.1.0 installed (`contracts/lib/openzeppelin-contracts`)
- [x] `contracts/src/AthenaCommit.sol` — written, all functions `public`, ERC-8183 integration
- [x] `contracts/src/interfaces/IERC8183.sol` — full ERC-8183 interface with all 7 functions
- [x] `contracts/src/interfaces/IERC8004.sol` — IdentityRegistry, ReputationRegistry, ValidationRegistry interfaces
- [x] `contracts/test/AthenaCommit.t.sol` — 29 tests, 29 passing (`forge test -vvv`)
- [x] `contracts/script/Deploy.s.sol` — deploy script with post-deploy checklist output
- [x] `shared/addresses.json` — all known Arc Testnet addresses filled in
- [x] **Phase 1 sync with team** — shared contract address, ABI, taskId scheme with H1 + H2

### Phase 2 — Deploy & integrate
- [x] `forge script Deploy.s.sol --broadcast` → AthenaCommit deployed: `0x1cFC54256F28C76891891a266c03AD8ceA63D416`
- [x] `shared/addresses.json` `athenaCommit` field filled with deployed address
- [x] `forge inspect AthenaCommit abi > shared/abis/AthenaCommit.json` — ABI exported
- [x] **Ping Backend B + Frontend with address** (H4)
- [x] Integration test: `commit()` → `reveal()` → `withdraw()` on real Arc RPC — all passing
- [x] Provider wallet addresses received from Backend B (H2)
- [x] `contracts/scripts/register-agents.ts` run → all 4 agents registered on ERC-8004
- [x] `shared/addresses.json` `agents` section filled with tokenIds (broker: 845252, p1: 845255, p2: 845256, p3: 845257)
- [x] **Ping Frontend with tokenIds** (H5)
- [x] ERC-8183 manual flow tested — jobId 147246: createJob → setBudget → fund → submit → complete ✓ (1 USDC released to provider1)
- [ ] `contracts/scripts/post-reputation.ts` run → first reputation feedback posted
- [ ] **Full manual loop with team** — commit → stream → reveal → slash/release working live (H6)

### Phase 3 — Automation support
- [ ] Backend B's broker logic calling `commit()`/`reveal()` without failures
- [ ] `taskId` mismatch verified: `computeTaskId()` on-chain matches Backend B's encoding
- [ ] ABI re-exported and teammates pinged if any contract change

### Phase 4 — Stretch (CCTP cross-chain)
- [ ] Phase 3 fully working first
- [ ] `depositForBurn()` on TokenMessengerV2 for Provider 3 (Base Sepolia)
- [ ] Circle Iris attestation polled + `receiveMessage()` called on Base

### Handoffs owed to teammates
- [x] **H1** → Both: function signatures + taskId scheme (Phase 1 sync)
- [x] **H3** → Backend B: taskId exact encoding agreed
- [x] **H4** → Both: deployed address + ABI **actively pinged** (not just committed)
- [x] **H5** → Frontend: agent tokenIds in `shared/addresses.json` **actively pinged**
- [ ] **H6** → All: manual loop confirmed working live

---

---

## 0. Your setup checklist (Day 1)

- [ ] MetaMask wallet, Arc Testnet: chainId `5042002`, RPC `https://rpc.testnet.arc.network`
- [ ] Testnet USDC from `https://faucet.circle.com` (select Arc Testnet)
- [ ] Foundry: `curl -L https://foundry.paradigm.xyz | bash && foundryup`
- [ ] Node.js 22+ (for ERC-8004 registration scripts)
- [ ] Canteen CLI: `uv tool install git+https://github.com/the-canteen-dev/ARC-cli`
- [ ] `arc-canteen login` — authenticates and gives you a Canteen-hosted RPC URL
- [ ] `arc-canteen rpc-url --export` → sets `$RPC` in your shell
- [ ] `arc-canteen shell-init >> ~/.zshrc` — auto-loads `$RPC` in every shell

---

## 0.1 Arc facts — memorise once, never re-derive

**USDC dual-decimal — #1 bug source:**

| Interface | Decimals | Use for |
|---|---|---|
| ERC-20 at `0x3600000000000000000000000000000000000000` | **6** | ALL payment/bond amounts in contracts and scripts |
| Native (msg.value, gas, `nativeCurrency` in wagmi config) | **18** | Gas only — never display or compute payment amounts from this |

The same asset, two interfaces. `1 USDC = 1_000_000` in ERC-20. Mixing them by a factor of 1 trillion is the #1 bug on Arc.

**Arc EVM differences — design around these:**
- `PREVRANDAO` always returns `0` — do NOT use for randomness
- Native value transfers can **revert** even with sufficient balance: blocklisted addresses, zero address, precompile addresses all revert on receive
- **Use pull-payment pattern always** — credit `withdrawable` mapping, let recipients call `withdraw()` themselves. Never push funds directly.
- `block.timestamp` is non-decreasing but sub-second blocks can share the same value — **use `block.number` for ordering**, never timestamp deltas
- Finality is instant (deterministic on inclusion) — no waiting for confirmation windows
- Base fees go to block beneficiary, not burned

**`anvil` ≠ Arc:** `anvil` cannot simulate Arc's blocklist enforcement, native precompiles, or EIP-7708 Transfer logs. Use `anvil` for pure Solidity logic tests only. All integration tests must hit real Arc Testnet RPC.

---

## 0.2 All confirmed contract addresses (Arc Testnet, chainId 5042002)

These are already in `shared/addresses.json`. Never hardcode from memory — always read the file.

| Contract | Address |
|---|---|
| USDC ERC-20 | `0x3600000000000000000000000000000000000000` |
| EURC | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` |
| ERC-8004 IdentityRegistry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ERC-8004 ReputationRegistry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |
| ERC-8183 Job Escrow | `0x0747EEf0706327138c69792bF28Cd525089e4583` |
| Gateway Wallet | `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` |
| Gateway Minter | `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B` |
| CCTP V2 TokenMessengerV2 (domain 26) | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` |
| CCTP V2 MessageTransmitterV2 | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` |
| CCTP V2 TokenMinterV2 | `0xb43db544E2c27092c107639Ad201b3dEfAbcF192` |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| CREATE2 Factory | `0x4e59b44847b379578588920cA78FbF26c0B4956C` |

---

## PHASE 1 — Scaffold & compile

### Phase 1.1 — Repo scaffold

```bash
# From project root (already done — contracts/ and shared/ exist)
cd contracts
forge install OpenZeppelin/openzeppelin-contracts@v5.1.0
```

`foundry.toml` is already configured. Make sure `$RPC` is set before using `arc_testnet` profile:
```bash
arc-canteen rpc-url --export   # prints: export RPC=https://...
```

### Phase 1.2 — AthenaCommit.sol (already written)

Key design decisions — **do not change without team discussion:**

**Contract: `contracts/src/AthenaCommit.sol`**

```solidity
// Public state (all readable by frontend/backend)
mapping(bytes32 => Commitment) public commitments;  // taskId → Commitment
mapping(address => uint256) public withdrawable;    // pull-payment ledger
IERC20 public immutable USDC;
IERC8183 public immutable ERC8183;

// View helpers
function isCommitted(bytes32 taskId) public view returns (bool)
function isRevealed(bytes32 taskId) public view returns (bool)
function isSlashed(bytes32 taskId) public view returns (bool)
function computeTaskId(address client, string calldata taskDescription, uint256 blockNumber) public pure returns (bytes32)
```

**Function signatures (share these with Backend B and Frontend at Phase 1 sync — H1):**

```solidity
// Broker calls BEFORE stream starts
function commit(
    bytes32 taskId,        // keccak256(abi.encodePacked(clientAddress, taskDescription, blockNumber))
    bytes32 commitHash,    // SHA-256 of canonical decision JSON, cast to bytes32
    uint256 bondAmount,    // 6-decimal USDC (1 USDC = 1_000_000)
    address client,        // receives bond on slash
    bytes32 erc8183JobId   // ERC-8183 job ID; bytes32(0) to skip ERC-8183 integration
) public

// Broker calls AFTER stream ends
function reveal(
    bytes32 taskId,
    bool predictionMet,      // MCP monitor's final verdict
    bytes32 revealedHash,    // must equal commitHash (cryptographic proof)
    bytes32 deliverableHash  // ERC-8183 deliverable hash; bytes32(0) to skip
) public

// Anyone with withdrawable balance calls this
function withdraw() public
```

**`taskId` scheme — agree byte-for-byte with Backend B (H3):**
```solidity
taskId = keccak256(abi.encodePacked(clientAddress, taskDescription, blockNumber))
```

Backend B's TypeScript equivalent:
```typescript
import { keccak256, encodePacked } from "viem"
const taskId = keccak256(encodePacked(
  ["address", "string", "uint256"],
  [clientAddress, taskDescription, BigInt(blockNumber)]
))
```

**Bond amounts — 6-decimal USDC only:**
```
1 USDC    = 1_000_000
0.01 USDC = 10_000
```

**ERC-8183 integration — how it works:**
- If `erc8183JobId != bytes32(0)`, `reveal()` calls `ERC8183.complete()` or `ERC8183.reject()` atomically
- `AthenaCommit` must be registered as the `evaluator` when the ERC-8183 job is created
- If ERC-8183 call fails, bond settlement still completes (try/catch, emits `ERC8183Settled(settled=false)`)

### Phase 1.3 — Compile

```bash
cd contracts && forge build
# Expected: zero errors. One lint note about SCREAMING_SNAKE_CASE for immutables — ignore.
```

**Phase 1 sync (15 min, all 3 teammates):**
- Share `commit()`/`reveal()` signatures above with Backend B → they code against these
- Share function signatures with Frontend → they build contract reads
- Agree `taskId` scheme byte-for-byte with Backend B (H3)
- Backend B shares 3 provider wallet addresses → you need them for ERC-8004 registration

---

## PHASE 2 — Deploy, test, register agents

### Phase 2.1 — Deploy to Arc Testnet

```bash
export DEPLOYER_PK=0x<your private key>
forge script script/Deploy.s.sol:Deploy \
  --rpc-url arc_testnet \
  --private-key $DEPLOYER_PK \
  --broadcast \
  -vvvv
```

Script uses hardcoded Arc Testnet addresses for USDC and ERC-8183. No args needed.

**Immediately after deploy:**

1. Confirm on Arcscan: `https://testnet.arcscan.app`
2. Update `shared/addresses.json`:
   ```json
   { "contracts": { "athenaCommit": "0x<deployed>" } }
   ```
3. Export ABI:
   ```bash
   forge inspect AthenaCommit abi > ../shared/abis/AthenaCommit.json
   ```
4. **PING Backend B and Frontend immediately — this is their unblock (H4)**

### Phase 2.2 — Test suite

```bash
forge test -vvv   # uses anvil — 22 tests, all should pass
```

Tests cover:
- `commit()`: happy path, duplicate revert, zero bond, zero client, event emission
- `reveal()`: prediction met/not met, all revert cases, event emission
- `withdraw()`: broker after success, client after slash, nothing to withdraw
- ERC-8183 integration: complete called, reject called, revert doesn't block bond settlement
- End-to-end: full happy path, full slash path (with and without ERC-8183)
- Multiple independent streams

**Integration test on real Arc RPC (after deploy):**
```bash
# Set these from shared/addresses.json after deploy
export ATHENA_COMMIT=0x<deployed>
export CLIENT_ADDR=0x<client wallet>
export TASK_ID=$(cast keccak "test-task-1")
export COMMIT_HASH=$(cast keccak "decision-json-preview")

# Approve bond
cast send $USDC "approve(address,uint256)" $ATHENA_COMMIT 1000000 \
  --rpc-url arc_testnet --private-key $DEPLOYER_PK

# Commit
cast send $ATHENA_COMMIT "commit(bytes32,bytes32,uint256,address,bytes32)" \
  $TASK_ID $COMMIT_HASH 1000000 $CLIENT_ADDR 0x$(printf '%064d' 0) \
  --rpc-url arc_testnet --private-key $DEPLOYER_PK

# Reveal (prediction met)
cast send $ATHENA_COMMIT "reveal(bytes32,bool,bytes32,bytes32)" \
  $TASK_ID true $COMMIT_HASH 0x$(printf '%064d' 0) \
  --rpc-url arc_testnet --private-key $DEPLOYER_PK

# Read withdrawable balance
cast call $ATHENA_COMMIT "withdrawable(address)(uint256)" $DEPLOYER_ADDR \
  --rpc-url arc_testnet
```

### Phase 2.3 — Register all agents on ERC-8004

Wait for Backend B to give you their 3 provider wallet addresses (H2).

```bash
cd contracts/scripts
npm install

# Set private keys for each agent wallet
export DEPLOYER_PK=0x...     # broker agent wallet
export PROVIDER1_PK=0x...    # provider 1
export PROVIDER2_PK=0x...    # provider 2
export PROVIDER3_PK=0x...    # provider 3

npm run register
```

Script automatically:
- Registers all 4 agents on `IdentityRegistry` at `0x8004A818BFB912233c491871b3d84c89A494BD9e`
- Parses `tokenId` from Transfer events
- Writes to `shared/addresses.json` agents section

Expected output in `shared/addresses.json`:
```json
"agents": {
  "broker":    { "address": "0x...", "tokenId": "1", "role": "broker" },
  "provider1": { "address": "0x...", "tokenId": "2", "role": "provider" },
  "provider2": { "address": "0x...", "tokenId": "3", "role": "provider" },
  "provider3": { "address": "0x...", "tokenId": "4", "role": "provider" }
}
```

**PING Frontend with tokenIds (H5). Do not push to git and assume they'll notice — ping actively.**

**⚠ Do NOT build against ERC-8004 ValidationRegistry (`0x8004Cb1BF31DAf7788923b405b754f57acEB4272`) — flagged unstable upstream. Use ReputationRegistry only.**

### Phase 2.4 — ERC-8183 job escrow integration

Athena is the **evaluator** in ERC-8183. Job lifecycle for each stream:

```
1. Client creates job (Backend B's broker logic or manually):
   createJob(provider, evaluator=address(AthenaCommit), expiredAt, description, hook=0x0)
   → returns bytes32 jobId

2. Provider sets price:
   setBudget(jobId, amount_in_6_decimal_usdc, "")

3. Client approves USDC and funds escrow:
   USDC.approve(erc8183Address, amount)
   fund(jobId, "")

4. Stream runs... Provider submits deliverable:
   submit(jobId, deliverableHash, "")

5. Broker calls AthenaCommit.reveal() with erc8183JobId:
   → If predictionMet: AthenaCommit calls ERC8183.complete() → provider paid
   → If !predictionMet: AthenaCommit calls ERC8183.reject() → client refunded
```

⚠ **ERC-8183 is a Draft EIP.** Always verify the live ABI on Arcscan before integrating. Trust Arcscan over any spec text or README. Contract is at `0x0747EEf0706327138c69792bF28Cd525089e4583`.

### Phase 2.5 — ERC-8004 reputation after each stream

After every stream, call `giveFeedback` from a **separate validator wallet** (owner cannot rate their own agent):

```bash
export VALIDATOR_PK=0x...          # different from broker wallet
export AGENT_ID=2                  # provider's tokenId
export SCORE=85                    # 0–100 integer
export TAG=routing
export COMMENT="Stream matched prediction within 5% — latency 320ms vs predicted 350ms"
export EVIDENCE_TX=0x...           # Arcscan tx hash of reveal transaction

cd contracts/scripts && npm run reputation
```

Full `giveFeedback` signature (note `int128` not `uint8` for score):
```solidity
function giveFeedback(
    uint256 agentId,
    int128 score,          // 0–100 mapped to int128
    uint8 feedbackType,    // 1 = quality review
    string tag,
    string metadataURI,
    string evidenceURI,
    string comment,
    bytes32 feedbackHash   // keccak256 of canonical feedback JSON
) external
```

### Phase 2.6 — Manual loop with team (H6)

Run together as a team before declaring Phase 2 done:

1. Frontend submits New Stream form → approves USDC → calls `commit()` on AthenaCommit
2. Backend B manually triggers one provider call
3. Backend B manually calls `reveal(taskId, true, commitHash, bytes32(0))`
4. You confirm on Arcscan: `commitments(taskId)` shows `revealed=true`, `slashed=false`
5. You call `withdraw()` → broker gets bond back
6. Repeat with `reveal(taskId, false, ...)` → confirm slash to client
7. Frontend shows both states correctly on Stream Detail page

**This is your minimum viable demo. If Phase 3 runs out of time, this alone is submittable.**

---

## PHASE 3 — Support role

Backend B owns Phase 3 automation. Your job:

- Keep ABI current — re-export + ping both teammates if anything changes
- Debug `commit()`/`reveal()` call failures from Backend B's broker logic

**Most common Phase 3 failures:**

1. **`taskId` mismatch** between Backend B's TypeScript encoding and your Foundry scheme
   - Double-check byte-for-byte: `keccak256(abi.encodePacked(clientAddress, taskDescription, blockNumber))`
   - Use `AthenaCommit.computeTaskId(client, desc, blockNum)` as the on-chain reference

2. **Bond in wrong decimal scale**
   - Backend B must use 6-decimal amounts: `1 USDC = 1_000_000`, not `1_000_000_000_000_000_000`

3. **Approval missing**
   - Backend B must call `USDC.approve(athenaCommitAddress, bondAmount)` before `commit()`

4. **`NotBroker` revert on reveal**
   - The wallet calling `reveal()` must be the same wallet that called `commit()`

---

## PHASE 4 — CCTP V2 cross-chain payout (stretch only)

**Only after Phase 3 works live end-to-end.**

Provider 3 operates on Base Sepolia. Pay them natively on Base:

```solidity
// On Arc Testnet — burn USDC for Base (domain 6)
ITokenMessengerV2(0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA).depositForBurn(
    amount,          // 6-decimal USDC amount
    6,               // Base destination domain (verify current list before building)
    recipient,       // provider's Base address, left-padded to bytes32
    usdcAddress,     // 0x3600000000000000000000000000000000000000
    address(0),      // destinationCaller: 0 = anyone can relay on destination
    0,               // maxFee
    1000             // minFinalityThreshold: 1000 = Standard finality
);
```

After `depositForBurn`:
1. Poll Circle Iris attestation API for the signed attestation
2. Call `receiveMessage` on Base's `MessageTransmitterV2` with the attestation bytes
3. Timebox at 3 hours — if destination mint doesn't complete live, show the burn tx on Arcscan as proof of mechanism

---

## Your handoff checklist

| When | What | To whom |
|---|---|---|
| Phase 1 sync | `commit()`/`reveal()`/`withdraw()` signatures + `taskId` scheme + `computeTaskId` helper | Both teammates |
| Phase 2.1 | Deployed AthenaCommit address + ABI in `shared/` + **active ping** | Both teammates (H4) |
| Phase 2.3 | Agent tokenIds written to `shared/addresses.json` + **active ping** | Frontend (H5) |
| Phase 2.5 | Confirm manual loop works end-to-end | Both |
| Phase 3 | Responsive to debugging, re-export ABI if changed | Backend B |
| Ongoing | Any address/ABI change → update `shared/` → ping | Both |

---

## Things to re-verify if something feels off

- Numbers look wrong by a trillion → ERC-20 vs native decimal mismatch (6 vs 18)
- `HashMismatch` revert → pre-image JSON changed between commit and reveal — check canonical JSON encoding
- `taskId` not matching → check byte-for-byte encoding. Use `computeTaskId()` on-chain as reference
- `AlreadyCommitted` when you think it shouldn't be → some other tx committed with same inputs
- ERC-8183 call failing silently → check Arcscan for `ERC8183Settled(settled=false)` event
- Balance reads returning zero → confirm you're calling `balanceOf` on the ERC-20 address (6 decimal), not reading native balance (18 decimal)
- `shared/addresses.json` looks stale → don't guess, re-export from Foundry and update
