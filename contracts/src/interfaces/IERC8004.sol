// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IERC8004IdentityRegistry
/// @notice ERC-8004 onchain agent identity — ERC-721 NFT per registered agent
/// @dev Deployed at: 0x8004A818BFB912233c491871b3d84c89A494BD9e (Arc Testnet)
interface IERC8004IdentityRegistry {
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);

    /// @notice Register a new agent identity, mints a soulbound NFT
    /// @param metadataURI  URI pointing to JSON metadata:
    ///   { "name": "...", "description": "...", "agent_type": "...",
    ///     "capabilities": [...], "version": "1.0.0" }
    ///   Host on IPFS or encode as data:application/json,...
    /// @return tokenId The assigned ERC-721 token ID
    function register(string calldata metadataURI) external returns (uint256 tokenId);

    /// @notice Returns the wallet that owns this agent identity NFT
    function ownerOf(uint256 tokenId) external view returns (address);

    /// @notice Returns the metadata URI for an agent
    function tokenURI(uint256 tokenId) external view returns (string memory);
}

/// @title IERC8004ReputationRegistry
/// @notice ERC-8004 onchain reputation — feedback attached to agent tokenIds
/// @dev Deployed at: 0x8004B663056A597Dffe9eCcC1965A193B7388713 (Arc Testnet)
///
/// IMPORTANT: Owner cannot give feedback for their own agent (anti-self-dealing).
/// Feedback must come from a separate validator wallet.
interface IERC8004ReputationRegistry {
    /// @notice Record reputation feedback for an agent after a stream resolves
    /// @param agentId      ERC-8004 tokenId of the agent being evaluated
    /// @param score        Quality score; use range 0–100 mapped to int128 (e.g. 85 = 0.85 accuracy)
    /// @param feedbackType 1 = quality review (standard), use other values per spec
    /// @param tag          Short label e.g. "routing", "quality", "latency"
    /// @param metadataURI  URI to extended feedback JSON (IPFS or data: URI)
    /// @param evidenceURI  URI to evidence (Arcscan TX link, log hash, etc.)
    /// @param comment      Human-readable summary of outcome
    /// @param feedbackHash keccak256 of the canonical feedback object (for integrity)
    function giveFeedback(
        uint256 agentId,
        int128 score,
        uint8 feedbackType,
        string calldata tag,
        string calldata metadataURI,
        string calldata evidenceURI,
        string calldata comment,
        bytes32 feedbackHash
    ) external;

    /// @notice Returns all feedback entries for an agent
    function readAllFeedback(uint256 agentId) external view returns (bytes memory);
}

/// @title IERC8004ValidationRegistry
/// @notice ERC-8004 validation — owner requests, validator responds
/// @dev Deployed at: 0x8004Cb1BF31DAf7788923b405b754f57acEB4272 (Arc Testnet)
/// @dev NOTE: Flagged as unstable upstream — do NOT build against this in Athena
interface IERC8004ValidationRegistry {
    function validationRequest(
        address validator,
        uint256 agentId,
        string calldata requestURI,
        bytes32 requestHash
    ) external;

    function validationResponse(
        bytes32 requestHash,
        uint8 response,         // 100 = passed, 0 = failed
        string calldata responseURI,
        bytes32 responseHash,
        string calldata tag
    ) external;

    function getValidationStatus(bytes32 requestHash) external view returns (uint8);
}
