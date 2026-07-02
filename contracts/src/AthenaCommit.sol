// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC8183} from "./interfaces/IERC8183.sol";

/// @title AthenaCommit
/// @notice Commit-reveal prediction bond contract for Athena's routing decisions.
///
/// FLOW:
///   1. Broker calls commit() BEFORE the stream starts:
///      - Deposits USDC bond into this contract
///      - Records a sealed SHA-256 hash of { provider, predictedQuality,
///        predictedLatency, confidenceScore, nonce }
///      - Optionally links an ERC-8183 job where this contract is the evaluator
///
///   2. Stream runs; MCP monitor scores each call via Backend B
///
///   3. Broker calls reveal() AFTER the stream ends:
///      - Supplies the pre-image JSON's SHA-256 hash (must match committed hash)
///      - Supplies MCP monitor's final boolean: did quality+latency meet prediction?
///      - If predictionMet == true:  bond credited to broker's withdrawable balance
///        AND linked ERC-8183 job (if any) is completed → provider paid
///      - If predictionMet == false: bond credited to client's withdrawable balance
///        AND linked ERC-8183 job (if any) is rejected → client refunded
///
///   4. Broker/client calls withdraw() to pull their credited balance
///
/// USDC NOTE: All amounts use the 6-decimal ERC-20 interface at
///   0x3600000000000000000000000000000000000000
///   1 USDC = 1_000_000 units. Never use 18-decimal native interface for amounts.
///
/// ARC NOTE: Native value transfers can revert on Arc (blocklisted addresses, etc).
///   This contract uses a pull-payment ledger (withdrawable mapping) — never push funds.
///
/// ARC NOTE: block.timestamp is non-decreasing but sub-second blocks may share values.
///   We use block.number for ordering, not timestamp deltas.
contract AthenaCommit is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── Immutables (all public for frontend/backend reads) ────────────────

    /// @notice Arc Testnet USDC ERC-20 (6 decimals). Set at construction time.
    IERC20 public immutable USDC;

    /// @notice ERC-8183 job escrow contract on Arc Testnet.
    ///         AthenaCommit can call complete()/reject() as evaluator.
    ///         Set to address(0) to disable ERC-8183 integration entirely.
    IERC8183 public immutable ERC8183;

    // ── State (all public so frontend/backend can read without getters) ───

    /// @notice taskId → Commitment. taskId = keccak256(abi.encodePacked(client, taskDescription, blockNumber))
    ///         Backend B MUST use this exact encoding — byte-for-byte identical — or commit/reveal will not match.
    mapping(bytes32 => Commitment) public commitments;

    /// @notice Pull-payment ledger. Broker/client calls withdraw() to claim their balance.
    ///         Never transfer funds directly — Arc can revert native transfers on blocklisted addresses.
    mapping(address => uint256) public withdrawable;

    // ── Structs ───────────────────────────────────────────────────────────

    struct Commitment {
        /// SHA-256 of the canonical decision JSON, encoded as bytes32.
        /// Computed off-chain by Backend B before the stream starts.
        bytes32 commitHash;
        /// Broker agent wallet address (must match msg.sender on reveal)
        address broker;
        /// Client who paid for the stream — receives bond on slash
        address client;
        /// Bond amount in 6-decimal USDC (e.g. 1 USDC = 1_000_000)
        uint256 bondAmount;
        /// Block number when commit was recorded (use block.number, not timestamp)
        uint256 committedAt;
        /// Optional: ERC-8183 job ID. If non-zero, reveal() will call complete/reject on ERC-8183.
        /// The ERC-8183 job MUST have been created with address(this) as the evaluator.
        bytes32 erc8183JobId;
        bool revealed;
        bool slashed;
    }

    // ── Events ────────────────────────────────────────────────────────────

    event Committed(
        bytes32 indexed taskId,
        address indexed broker,
        address indexed client,
        bytes32 commitHash,
        uint256 bondAmount,
        bytes32 erc8183JobId,
        uint256 blockNumber
    );

    event Revealed(
        bytes32 indexed taskId,
        address indexed broker,
        bool predictionMet,
        bool slashed,
        bytes32 revealedHash
    );

    event Withdrawn(address indexed recipient, uint256 amount);

    event ERC8183Settled(bytes32 indexed taskId, bytes32 indexed erc8183JobId, bool completed);

    // ── Errors ────────────────────────────────────────────────────────────

    error AlreadyCommitted();
    error NotCommitted();
    error AlreadyRevealed();
    error HashMismatch();
    error NotBroker();
    error NothingToWithdraw();
    error ZeroBond();
    error ZeroClient();

    // ── Constructor ───────────────────────────────────────────────────────

    /// @param _usdc    Arc Testnet USDC ERC-20: 0x3600000000000000000000000000000000000000
    /// @param _erc8183 ERC-8183 escrow: 0x0747EEf0706327138c69792bF28Cd525089e4583
    ///                 Pass address(0) to disable ERC-8183 integration
    constructor(address _usdc, address _erc8183) {
        USDC = IERC20(_usdc);
        ERC8183 = IERC8183(_erc8183);
    }

    // ── Core functions (all public) ───────────────────────────────────────

    /// @notice Broker calls this BEFORE starting the stream.
    ///         Bond is locked until reveal() is called.
    ///
    /// @param taskId        keccak256(abi.encodePacked(clientAddress, taskDescription, blockNumber))
    ///                      Backend B MUST use this exact scheme — coordinate in Phase 1 sync
    /// @param commitHash    SHA-256(canonical decision JSON) cast to bytes32
    ///                      JSON fields: { taskId, selectedProvider, predictedQualityScore,
    ///                      predictedLatencyMs, confidenceScore, nonce }
    /// @param bondAmount    Bond in 6-decimal USDC (minimum recommended: 1_000_000 = 1 USDC)
    /// @param client        Address that paid for the stream — receives bond if prediction fails
    /// @param erc8183JobId  ERC-8183 job ID if Athena is evaluator; bytes32(0) to skip
    function commit(
        bytes32 taskId,
        bytes32 commitHash,
        uint256 bondAmount,
        address client,
        bytes32 erc8183JobId
    ) public nonReentrant {
        if (bondAmount == 0) revert ZeroBond();
        if (client == address(0)) revert ZeroClient();
        if (commitments[taskId].broker != address(0)) revert AlreadyCommitted();

        USDC.safeTransferFrom(msg.sender, address(this), bondAmount);

        commitments[taskId] = Commitment({
            commitHash: commitHash,
            broker: msg.sender,
            client: client,
            bondAmount: bondAmount,
            committedAt: block.number,
            erc8183JobId: erc8183JobId,
            revealed: false,
            slashed: false
        });

        emit Committed(taskId, msg.sender, client, commitHash, bondAmount, erc8183JobId, block.number);
    }

    /// @notice Broker calls this AFTER the stream ends.
    ///         Hash check proves broker could not have changed its prediction after seeing results.
    ///         If an ERC-8183 job was linked, its outcome is settled atomically here.
    ///
    /// @param taskId        Must match the taskId from commit()
    /// @param predictionMet True if quality AND latency met the committed prediction.
    ///                      Backend B's MCP monitor computes this from per-call scores.
    /// @param revealedHash  SHA-256 of the same canonical JSON recomputed off-chain.
    ///                      MUST equal commitHash — this is the cryptographic proof.
    /// @param deliverableHash For ERC-8183: hash of the provider's submitted deliverable.
    ///                      Pass bytes32(0) if no ERC-8183 job is linked.
    function reveal(
        bytes32 taskId,
        bool predictionMet,
        bytes32 revealedHash,
        bytes32 deliverableHash
    ) public nonReentrant {
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

        emit Revealed(taskId, c.broker, predictionMet, !predictionMet, revealedHash);

        // Atomically settle ERC-8183 job if one is linked and ERC-8183 is configured
        if (c.erc8183JobId != bytes32(0) && address(ERC8183) != address(0)) {
            _settleERC8183(taskId, c.erc8183JobId, predictionMet, deliverableHash);
        }
    }

    /// @notice Pull-payment: broker or client calls this to claim credited balance.
    function withdraw() public nonReentrant {
        uint256 amt = withdrawable[msg.sender];
        if (amt == 0) revert NothingToWithdraw();
        withdrawable[msg.sender] = 0;
        USDC.safeTransfer(msg.sender, amt);
        emit Withdrawn(msg.sender, amt);
    }

    // ── View helpers (frontend convenience) ──────────────────────────────

    /// @notice Returns the full Commitment struct for a taskId
    function getCommitment(bytes32 taskId) public view returns (Commitment memory) {
        return commitments[taskId];
    }

    /// @notice Returns whether a taskId has been committed
    function isCommitted(bytes32 taskId) public view returns (bool) {
        return commitments[taskId].broker != address(0);
    }

    /// @notice Returns whether a commitment has been revealed (settled)
    function isRevealed(bytes32 taskId) public view returns (bool) {
        return commitments[taskId].revealed;
    }

    /// @notice Returns whether a commitment was slashed
    function isSlashed(bytes32 taskId) public view returns (bool) {
        return commitments[taskId].slashed;
    }

    /// @notice Computes the taskId from its components — useful for frontend/backend to
    ///         verify they are generating the same ID as will be used on-chain
    function computeTaskId(
        address client,
        string calldata taskDescription,
        uint256 blockNumber
    ) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(client, taskDescription, blockNumber));
    }

    // ── Internal ──────────────────────────────────────────────────────────

    /// @dev Calls ERC-8183 complete or reject. Failures are caught and emitted as events
    ///      so a failed ERC-8183 call does not revert the bond settlement.
    function _settleERC8183(
        bytes32 taskId,
        bytes32 jobId,
        bool predictionMet,
        bytes32 deliverableHash
    ) internal {
        bool settled = false;
        if (predictionMet) {
            try ERC8183.complete(jobId, deliverableHash, "") {
                settled = true;
            } catch {}
        } else {
            bytes32 reason = bytes32("prediction-failed");
            try ERC8183.reject(jobId, reason, "") {
                settled = true;
            } catch {}
        }
        emit ERC8183Settled(taskId, jobId, settled);
    }
}
