// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {AthenaCommit} from "../src/AthenaCommit.sol";

/// @notice Deploys AthenaCommit to Arc Testnet and prints the post-deploy checklist.
///
/// Usage:
///   export DEPLOYER_PK=<your private key>
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url arc_testnet \
///     --private-key $DEPLOYER_PK \
///     --broadcast \
///     -vvvv
///
/// After running:
///   1. Copy deployed address → shared/addresses.json "athenaCommit"
///   2. Export ABI: forge inspect AthenaCommit abi > ../shared/abis/AthenaCommit.json
///   3. Verify on Arcscan: https://testnet.arcscan.app
///   4. Ping Backend B and Frontend with address (Handoff H4)
contract Deploy is Script {
    // Arc Testnet — confirmed addresses
    address constant USDC_ERC20  = 0x3600000000000000000000000000000000000000; // 6 decimals
    address constant ERC8183     = 0x0747EEf0706327138c69792bF28Cd525089e4583;

    function run() external {
        uint256 deployerPk = vm.envUint("DEPLOYER_PK");
        address deployer   = vm.addr(deployerPk);

        console.log("=== Athena Deploy ===");
        console.log("Deployer:  ", deployer);
        console.log("Chain ID:  ", block.chainid);
        console.log("USDC:      ", USDC_ERC20);
        console.log("ERC-8183:  ", ERC8183);
        console.log("");

        vm.startBroadcast(deployerPk);

        AthenaCommit athena = new AthenaCommit(USDC_ERC20, ERC8183);

        vm.stopBroadcast();

        console.log("=== DEPLOYED ===");
        console.log("AthenaCommit:", address(athena));
        console.log("");
        console.log("=== POST-DEPLOY CHECKLIST ===");
        console.log("1. Update shared/addresses.json:");
        console.log("     \"athenaCommit\": \"%s\"", address(athena));
        console.log("2. Export ABI:");
        console.log("     forge inspect AthenaCommit abi > ../shared/abis/AthenaCommit.json");
        console.log("3. Verify on Arcscan:");
        console.log("     https://testnet.arcscan.app/address/%s", address(athena));
        console.log("4. PING Backend B and Frontend NOW (Handoff H4)");
        console.log("5. Run agent registration script:");
        console.log("     cd contracts/scripts && npm run register");
    }
}
