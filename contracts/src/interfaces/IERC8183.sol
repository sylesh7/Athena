// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IERC8183 - AI Job Escrow Interface
/// @notice Interface for the ERC-8183 reference implementation deployed on Arc Testnet
/// @dev Deployed at: 0x0747EEf0706327138c69792bF28Cd525089e4583
///
/// Job lifecycle: Open → Funded → Submitted → Completed | Rejected | Expired
///
/// Roles:
///   client    — creates the job, funds escrow
///   provider  — delivers work, sets budget, submits deliverable
///   evaluator — approves or rejects the deliverable (Athena broker in our flow)
interface IERC8183 {
    // ── Events ───────────────────────────────────────────────────────────────

    event JobCreated(
        bytes32 indexed jobId,
        address indexed client,
        address indexed provider,
        address evaluator,
        uint256 expiredAt,
        string description
    );
    event BudgetSet(bytes32 indexed jobId, uint256 amount);
    event JobFunded(bytes32 indexed jobId, uint256 amount);
    event DeliverableSubmitted(bytes32 indexed jobId, bytes32 deliverableHash);
    event JobCompleted(bytes32 indexed jobId, bytes32 deliverableHash);
    event JobRejected(bytes32 indexed jobId, bytes32 reason);
    event JobExpired(bytes32 indexed jobId);

    // ── Job status enum (matches reference implementation) ────────────────

    // 0 = Open, 1 = Funded, 2 = Submitted, 3 = Completed, 4 = Rejected, 5 = Expired

    // ── Write functions ───────────────────────────────────────────────────

    /// @notice Client creates a job. Athena broker is the evaluator.
    /// @param provider  Agent that will perform the work
    /// @param evaluator Agent that approves/rejects (AthenaCommit contract or broker wallet)
    /// @param expiredAt Unix timestamp after which the job can be swept as expired
    ///        (confirmed against the live deployed contract 2026-07-05 — a
    ///        block-number-scale value reverts with its `ExpiryTooShort()` error)
    /// @param description Human-readable task description
    /// @param hook      Optional callback contract address; pass address(0) to skip
    /// @return jobId   Unique job identifier
    function createJob(
        address provider,
        address evaluator,
        uint256 expiredAt,
        string calldata description,
        address hook
    ) external returns (bytes32 jobId);

    /// @notice Provider sets the required budget for the job
    /// @param jobId      Job identifier
    /// @param amount     Payment in 6-decimal USDC units
    /// @param optParams  ABI-encoded optional parameters (pass "" if unused)
    function setBudget(
        bytes32 jobId,
        uint256 amount,
        bytes calldata optParams
    ) external;

    /// @notice Client approves USDC then calls this to lock funds in escrow
    /// @param jobId     Job identifier
    /// @param optParams ABI-encoded optional parameters (pass "" if unused)
    function fund(
        bytes32 jobId,
        bytes calldata optParams
    ) external;

    /// @notice Provider submits work deliverable
    /// @param jobId          Job identifier
    /// @param deliverableHash SHA-256 or keccak256 hash of the deliverable
    /// @param optParams      ABI-encoded optional parameters (pass "" if unused)
    function submit(
        bytes32 jobId,
        bytes32 deliverableHash,
        bytes calldata optParams
    ) external;

    /// @notice Evaluator (Athena broker) confirms delivery → releases escrowed USDC to provider
    /// @param jobId          Job identifier
    /// @param deliverableHash Must match the submitted deliverable hash
    /// @param optParams      ABI-encoded optional parameters (pass "" if unused)
    function complete(
        bytes32 jobId,
        bytes32 deliverableHash,
        bytes calldata optParams
    ) external;

    /// @notice Evaluator (Athena broker) rejects delivery → refunds escrowed USDC to client
    /// @param jobId     Job identifier
    /// @param reason    Bytes32-encoded reason code or hash
    /// @param optParams ABI-encoded optional parameters (pass "" if unused)
    function reject(
        bytes32 jobId,
        bytes32 reason,
        bytes calldata optParams
    ) external;

    // ── Read functions ────────────────────────────────────────────────────

    /// @notice Returns all fields of a job
    function getJob(bytes32 jobId) external view returns (
        address client,
        address provider,
        address evaluator,
        uint256 amount,
        uint256 expiredAt,
        uint8 status,
        string memory description
    );
}
