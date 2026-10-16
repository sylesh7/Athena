// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Base} from "./Base.t.sol";
import {AthenaTreasury} from "../src/AthenaTreasury.sol";

contract ReceivablesTest is Base {
    function test_unknownAndDuplicate() public {
        vm.prank(customer);
        vm.expectRevert(abi.encodeWithSelector(AthenaTreasury.UnknownReceivable.selector, bytes32("x")));
        t.payReceivable("x", 1);

        vm.startPrank(operator);
        t.registerReceivable("r1", address(usdc), 50 * ONE, address(0));
        vm.expectRevert(abi.encodeWithSelector(AthenaTreasury.ReceivableExists.selector, bytes32("r1")));
        t.registerReceivable("r1", address(usdc), 50 * ONE, address(0));
        vm.stopPrank();
    }

    function test_customerRestricted() public {
        vm.prank(operator);
        t.registerReceivable("r1", address(usdc), 50 * ONE, customer);
        usdc.mint(stranger, 50 * ONE);
        vm.startPrank(stranger);
        usdc.approve(address(t), 50 * ONE);
        vm.expectRevert(AthenaTreasury.NotCustomer.selector);
        t.payReceivable("r1", 50 * ONE);
        vm.stopPrank();
    }

    function test_partialThenExact_thenOverpayment() public {
        vm.prank(operator);
        t.registerReceivable("r1", address(usdc), 50 * ONE, address(0));
        usdc.mint(customer, 100 * ONE);
        vm.startPrank(customer);
        usdc.approve(address(t), 100 * ONE);
        t.payReceivable("r1", 20 * ONE);
        t.payReceivable("r1", 30 * ONE);
        vm.expectRevert(abi.encodeWithSelector(AthenaTreasury.Overpayment.selector, 0, 1));
        t.payReceivable("r1", 1);
        vm.stopPrank();
        assertEq(t.getReceivable("r1").amountPaid, 50 * ONE);
    }

    function test_fund_emitsTag_unsupportedReverts() public {
        usdc.mint(customer, 5 * ONE);
        vm.startPrank(customer);
        usdc.approve(address(t), 5 * ONE);
        vm.expectEmit(true, true, true, true);
        emit AthenaTreasury.Funded(customer, address(usdc), 5 * ONE, keccak256("YIELD_REDEEM"));
        t.fund(address(usdc), 5 * ONE, keccak256("YIELD_REDEEM"));
        vm.expectRevert(abi.encodeWithSelector(AthenaTreasury.UnsupportedToken.selector, address(eurc)));
        t.fund(address(eurc), 1, bytes32(0));
        vm.stopPrank();
    }
}
