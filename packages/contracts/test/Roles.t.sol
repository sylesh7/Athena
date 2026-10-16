// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Base} from "./Base.t.sol";
import {AthenaTreasury} from "../src/AthenaTreasury.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

contract RolesTest is Base {
    function test_constructor_operatorEqualsAdmin_reverts() public {
        vm.expectRevert(AthenaTreasury.RoleCollision.selector);
        new AthenaTreasury(admin, approver, admin, address(usdc), address(tm));
    }

    function test_constructor_operatorEqualsApprover_reverts() public {
        vm.expectRevert(AthenaTreasury.RoleCollision.selector);
        new AthenaTreasury(admin, approver, approver, address(usdc), address(tm));
    }

    function test_grantApproverToOperator_reverts() public {
        bytes32 role = t.APPROVER_ROLE();
        vm.prank(admin);
        vm.expectRevert(AthenaTreasury.RoleCollision.selector);
        t.grantRole(role, operator);
    }

    function test_grantOperatorToApprover_reverts() public {
        bytes32 role = t.OPERATOR_ROLE();
        vm.prank(admin);
        vm.expectRevert(AthenaTreasury.RoleCollision.selector);
        t.grantRole(role, approver);
    }

    function test_pause_permissions() public {
        vm.prank(operator);
        vm.expectRevert(AthenaTreasury.Unauthorized.selector);
        t.pause();
        vm.prank(approver);
        t.pause();
        vm.prank(approver);
        vm.expectRevert();
        t.unpause();
        vm.prank(admin);
        t.unpause();
        assertFalse(t.paused());
    }

    function test_adminWithdraw_onlyWhilePaused() public {
        vm.prank(admin);
        vm.expectRevert(Pausable.ExpectedPause.selector);
        t.adminWithdraw(address(usdc), admin, 10 * ONE);
        vm.prank(admin);
        t.pause();
        vm.prank(admin);
        t.adminWithdraw(address(usdc), admin, 10 * ONE);
        assertEq(usdc.balanceOf(admin), 10 * ONE);
    }

    function test_commitWhilePaused_reverts_butRevealFundPayReceivableWork() public {
        vm.prank(operator);
        t.commit("n1", PH, bytes32(0));
        vm.prank(operator);
        t.registerReceivable("rcv", address(usdc), 10 * ONE, address(0));
        vm.prank(admin);
        t.pause();

        vm.prank(operator);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        t.commit("n2", PH, bytes32(0));

        t.reveal("n1", PREIMAGE);
        usdc.mint(customer, 20 * ONE);
        vm.startPrank(customer);
        usdc.approve(address(t), 20 * ONE);
        t.fund(address(usdc), 10 * ONE, keccak256("OWNER_DEPOSIT"));
        t.payReceivable("rcv", 10 * ONE);
        vm.stopPrank();
    }
}
