// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Minimal CCTP V2 TokenMessenger interface used by AthenaTreasury.
/// Verify the signature against the verified implementation on the Arc explorer before deploying.
interface ITokenMessengerV2 {
    function depositForBurn(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold
    ) external;
}
