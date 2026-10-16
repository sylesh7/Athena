// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Base} from "./Base.t.sol";
import {AthenaTreasury} from "../src/AthenaTreasury.sol";

contract EscalationsTest is Base {
    function _run(bytes32 id, string memory obl, uint256 amount) internal returns (AthenaTreasury.Action memory a) {
        a = _pay(obl, amount);
        _commit(id, a);
        _execute(id, a);
    }

    function test_txLimit_escalates_vendorUnpaid() public {
        _run("d1", "o1", 300 * ONE);
        assertEq(uint8(_state("d1")), uint8(AthenaTreasury.DecisionState.Escalated));
        assertEq(usdc.balanceOf(vendor), 0);
        assertEq(t.getEscalation("d1").reason, t.ESC_TX_LIMIT());
    }

    function test_payeeCap_escalates() public {
        vm.prank(admin);
        t.setPayeeCap(VENDOR_ID, 50 * ONE);
        _run("d1", "o1", 60 * ONE);
        assertEq(t.getEscalation("d1").reason, t.ESC_PAYEE_CAP());
    }

    function test_budget_escalates() public {
        for (uint256 i; i < 4; i++) {
            _run(keccak256(abi.encode("ok", i)), string.concat("ok", vm.toString(i)), 250 * ONE);
        }
        _run("d9", "over", 10 * ONE);
        assertEq(t.getEscalation("d9").reason, t.ESC_BUDGET());
    }

    function test_floor_escalates() public {
        vm.prank(admin);
        t.setMinOperating(address(usdc), 1_900 * ONE);
        _run("d1", "o1", 200 * ONE);
        assertEq(t.getEscalation("d1").reason, t.ESC_LIQUIDITY_FLOOR());
    }

    function test_operatorCannotApprove_approverPays_chargesBudget() public {
        _run("d1", "o1", 300 * ONE);
        vm.prank(operator);
        vm.expectRevert();
        t.approveEscalation("d1");
        vm.prank(approver);
        t.approveEscalation("d1");
        assertEq(usdc.balanceOf(vendor), 300 * ONE);
        (AthenaTreasury.Budget memory b,) = t.getBudget(VENDOR, address(usdc));
        assertEq(b.spentInPeriod, 300 * ONE);
    }

    function test_expired_reverts() public {
        _run("d1", "o1", 300 * ONE);
        vm.warp(vm.getBlockTimestamp() + 3 days + 1);
        vm.prank(approver);
        vm.expectRevert(AthenaTreasury.EscalationExpired.selector);
        t.approveEscalation("d1");
    }

    function test_approveAfterSuspend_reverts() public {
        _run("d1", "o1", 300 * ONE);
        vm.prank(approver);
        t.suspendPayee(VENDOR_ID);
        vm.prank(approver);
        vm.expectRevert(abi.encodeWithSelector(AthenaTreasury.PayeeNotActive.selector, VENDOR_ID));
        t.approveEscalation("d1");
    }

    function test_approveAfterObligationPaidElsewhere_reverts() public {
        _run("d1", "same", 300 * ONE);
        AthenaTreasury.Action memory small = _run("d2", "same", 100 * ONE);
        vm.prank(approver);
        vm.expectRevert(abi.encodeWithSelector(AthenaTreasury.AlreadySettled.selector, small.obligationId));
        t.approveEscalation("d1");
    }

    function test_reject_isRevealable_cancel_works() public {
        _run("d1", "o1", 300 * ONE);
        vm.prank(approver);
        t.rejectEscalation("d1");
        assertEq(uint8(_state("d1")), uint8(AthenaTreasury.DecisionState.Rejected));
        t.reveal("d1", PREIMAGE);

        _run("d2", "o2", 300 * ONE);
        vm.prank(operator);
        t.cancel("d2");
        assertEq(uint8(_state("d2")), uint8(AthenaTreasury.DecisionState.Cancelled));
    }
}
