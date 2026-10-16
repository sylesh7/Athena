// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ITokenMessengerV2} from "../../src/interfaces/ITokenMessengerV2.sol";

contract MockTokenMessengerV2 is ITokenMessengerV2 {
    struct Call { uint256 amount; uint32 domain; bytes32 recipient; address token; bytes32 caller; uint256 maxFee; uint32 finality; }
    Call public last;
    uint256 public calls;

    function depositForBurn(
        uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken,
        bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold
    ) external {
        IERC20(burnToken).transferFrom(msg.sender, address(this), amount);
        last = Call(amount, destinationDomain, mintRecipient, burnToken, destinationCaller, maxFee, minFinalityThreshold);
        calls++;
    }
}
