// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Base} from "./Base.t.sol";
import {AthenaTreasury} from "../src/AthenaTreasury.sol";

contract AuditArrearsTest is Base {
    function _executed(bytes32 id, string memory obl) internal returns (AthenaTreasury.Action memory a) {
        a = _pay(obl, 10 * ONE);
        _commit(id, a);
        _execute(id, a);
    }

    function test_flagBeforeDeadline_reverts() public {
        _executed("d1", "o1");
        vm.expectRevert(AthenaTreasury.NotOverdue.selector);
        t.flagOverdue("d1");
    }

    function test_flag_freezesOperator_revealClears() public {
        _executed("d1", "o1");
        vm.roll(vm.getBlockNumber() + 7_201);
        vm.prank(stranger);
        t.flagOverdue("d1");
        assertEq(t.overdueCount(), 1);

        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(AthenaTreasury.AuditInArrears.selector, 1));
        t.commit("d2", PH, bytes32(0));

        t.reveal("d1", PREIMAGE);
        assertEq(t.overdueCount(), 0);
        vm.prank(operator);
        t.commit("d2", PH, bytes32(0));
    }

    function test_staleCommitted_cancelThenReveal_clears() public {
        AthenaTreasury.Action memory a = _pay("o1", 10 * ONE);
        _commit("d1", a);
        vm.roll(vm.getBlockNumber() + 7_201);
        t.flagOverdue("d1");
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(AthenaTreasury.AuditInArrears.selector, 1));
        t.execute("d1", a);

        vm.prank(operator);
        t.cancel("d1"); // cancel has no noArrears guard
        t.reveal("d1", PREIMAGE);
        assertEq(t.overdueCount(), 0);
    }

    function test_approverStillWorksInArrears() public {
        AthenaTreasury.Action memory a = _pay("o1", 300 * ONE);
        _commit("d1", a);
        _execute("d1", a); // escalated
        vm.roll(vm.getBlockNumber() + 7_201);
        t.flagOverdue("d1");
        vm.prank(approver);
        t.approveEscalation("d1");
        assertEq(usdc.balanceOf(vendor), 300 * ONE);
    }

    function test_doubleFlag_and_revealedFlag_revert() public {
        _executed("d1", "o1");
        vm.roll(vm.getBlockNumber() + 7_201);
        t.flagOverdue("d1");
        vm.expectRevert(AthenaTreasury.NotOverdue.selector);
        t.flagOverdue("d1");

        t.reveal("d1", PREIMAGE);
        _executed("d2", "o2");
        t.reveal("d2", PREIMAGE);
        vm.roll(vm.getBlockNumber() + 7_201);
        vm.expectRevert(AthenaTreasury.NotOverdue.selector);
        t.flagOverdue("d2");
    }
}
