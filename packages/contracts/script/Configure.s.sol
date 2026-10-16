// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Script} from "forge-std/Script.sol";
import {AthenaTreasury} from "../src/AthenaTreasury.sol";

/// Run by the admin. Testnet starting budgets; scale to the funds actually available (README Phase 43).
/// Mainnet: use the hard limits in README "Mainnet scope" instead of these values.
contract Configure is Script {
    uint256 constant ONE = 1e6;

    /// BUDGET_SCALE_PERCENT scales every budget / approval limit / floor (default 100 = the values below). Testnet
    /// faucet funds are tiny, so e.g. BUDGET_SCALE_PERCENT=2 keeps the floors below a ~20 USDC treasury; at 100% every
    /// payment would escalate on the 100 USDC operating floor.
    function _s(uint256 amount) internal view returns (uint256) {
        return amount * vm.envOr("BUDGET_SCALE_PERCENT", uint256(100)) / 100;
    }

    function run() external {
        AthenaTreasury t = AthenaTreasury(vm.envAddress("TREASURY_ADDRESS"));
        address usdc = vm.envAddress("USDC_ADDRESS");
        address eurc = vm.envAddress("EURC_ADDRESS");
        vm.startBroadcast();
        t.setSupportedToken(eurc, true);

        t.setBudget(keccak256("VENDOR"),       usdc, _s(2_000 * ONE),   _s(250 * ONE), 30 days, true);
        t.setBudget(keccak256("VENDOR"),       eurc, _s(1_000 * ONE),   _s(200 * ONE), 30 days, true);
        t.setBudget(keccak256("CONTRACTOR"),   usdc, _s(1_500 * ONE),   _s(300 * ONE), 30 days, true);
        t.setBudget(keccak256("SUBSCRIPTION"), usdc,   _s(300 * ONE),   _s(100 * ONE), 30 days, false);
        t.setBudget(keccak256("SERVICES"),     usdc,    _s(50 * ONE),    _s(10 * ONE), 30 days, false);
        t.setBudget(keccak256("YIELD"),        usdc, _s(5_000 * ONE), _s(2_000 * ONE), 30 days, false);
        t.setBudget(keccak256("FX"),           usdc,   _s(500 * ONE),   _s(200 * ONE), 30 days, false);

        t.setMinOperating(usdc, _s(100 * ONE));
        t.setMinOperating(eurc,  _s(20 * ONE));

        // Bootstrap: zero cooldown so internal payees can be activated now. Raise to 600 (testnet)
        // or 86_400 (mainnet) afterwards with setConfig.
        t.setConfig(0, 3 days, 7_200, 1_000, 100);
        vm.stopBroadcast();
    }
}
