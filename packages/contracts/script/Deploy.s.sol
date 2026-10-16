// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Script, console2} from "forge-std/Script.sol";
import {AthenaTreasury} from "../src/AthenaTreasury.sol";

contract Deploy is Script {
    function run() external returns (AthenaTreasury t) {
        address admin = vm.envAddress("ADMIN_ADDRESS");
        address approver = vm.envAddress("APPROVER_ADDRESS");
        address operator = vm.envAddress("OPERATOR_ADDRESS");
        address usdc = vm.envAddress("USDC_ADDRESS");
        address messenger = vm.envAddress("TOKEN_MESSENGER_V2");
        vm.startBroadcast();
        t = new AthenaTreasury(admin, approver, operator, usdc, messenger);
        vm.stopBroadcast();
        console2.log("AthenaTreasury:", address(t));
        console2.log("Deploy block:", block.number);
    }
}
