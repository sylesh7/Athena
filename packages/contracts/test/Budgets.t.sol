// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Base} from "./Base.t.sol";
import {AthenaTreasury} from "../src/AthenaTreasury.sol";

contract BudgetsTest is Base {
    function test_setBudget_unsupportedToken_reverts() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(AthenaTreasury.UnsupportedToken.selector, address(eurc)));
        t.setBudget(VENDOR, address(eurc), 1, 1, 30 days, false);
    }

    function test_setBudget_zeroPeriod_reverts() public {
        vm.prank(admin);
        vm.expectRevert(AthenaTreasury.BadPeriod.selector);
        t.setBudget(VENDOR, address(usdc), 1, 1, 0, false);
    }

    function test_spendAccumulates_thenRollsAfterWindow() public {
        AthenaTreasury.Action memory a = _pay("o1", 100 * ONE);
        _commit("d1", a);
        _execute("d1", a);
        AthenaTreasury.Action memory b2 = _pay("o2", 100 * ONE);
        _commit("d2", b2);
        _execute("d2", b2);
        (AthenaTreasury.Budget memory b,) = t.getBudget(VENDOR, address(usdc));
        assertEq(b.spentInPeriod, 200 * ONE);

        vm.warp(vm.getBlockTimestamp() + 30 days);
        AthenaTreasury.Action memory c = _pay("o3", 50 * ONE);
        _commit("d3", c);
        _execute("d3", c);
        (b,) = t.getBudget(VENDOR, address(usdc));
        assertEq(b.spentInPeriod, 50 * ONE);
    }

    function test_periodStartStaysAligned_after75Days() public {
        (AthenaTreasury.Budget memory b0,) = t.getBudget(VENDOR, address(usdc));
        vm.warp(vm.getBlockTimestamp() + 75 days);
        AthenaTreasury.Action memory a = _pay("o1", 10 * ONE);
        _commit("d1", a);
        _execute("d1", a);
        (AthenaTreasury.Budget memory b,) = t.getBudget(VENDOR, address(usdc));
        assertEq(b.periodStart, b0.periodStart + 60 days);
    }

    function test_getBudget_doesNotWrite() public {
        AthenaTreasury.Action memory a = _pay("o1", 100 * ONE);
        _commit("d1", a);
        _execute("d1", a);
        vm.warp(vm.getBlockTimestamp() + 31 days);
        (AthenaTreasury.Budget memory b1, uint256 r1) = t.getBudget(VENDOR, address(usdc));
        (AthenaTreasury.Budget memory b2, uint256 r2) = t.getBudget(VENDOR, address(usdc));
        assertEq(b1.spentInPeriod, 0);
        assertEq(r1, 1_000 * ONE);
        assertEq(b1.periodStart, b2.periodStart);
        assertEq(r1, r2);
    }

    function test_freeOperating_excludesReserve_neverUnderflows() public {
        // reserving 1,900 would leave 100 free... balance 2,000, floor 100 -> exactly at floor, allowed
        AthenaTreasury.Action memory r = AthenaTreasury.Action(2, bytes32(0), bytes32(0), address(usdc), 1_900 * ONE, 0, bytes32(0));
        _commit("r1", r);
        _execute("r1", r);
        assertEq(t.reserved(address(usdc)), 1_900 * ONE);
        assertEq(t.freeOperating(address(usdc)), 100 * ONE);

        // balance falls below the reserve via admin emergency withdrawal -> free must clamp to 0
        vm.startPrank(admin);
        t.pause();
        t.adminWithdraw(address(usdc), admin, 1_950 * ONE);
        vm.stopPrank();
        assertEq(t.freeOperating(address(usdc)), 0);
    }
}
