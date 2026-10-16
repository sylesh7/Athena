// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Base} from "./Base.t.sol";
import {AthenaTreasury} from "../src/AthenaTreasury.sol";

contract CommitExecuteRevealTest is Base {
    function test_happyPath_paysVendor_settles_chargesBudget() public {
        AthenaTreasury.Action memory a = _pay("obl-1", 100 * ONE);
        _commit("d1", a);
        _execute("d1", a);
        assertEq(usdc.balanceOf(vendor), 100 * ONE);
        assertTrue(t.obligationSettled(a.obligationId));
        (AthenaTreasury.Budget memory b, uint256 remaining) = t.getBudget(VENDOR, address(usdc));
        assertEq(b.spentInPeriod, 100 * ONE);
        assertEq(remaining, 900 * ONE);
        assertEq(uint8(_state("d1")), uint8(AthenaTreasury.DecisionState.Executed));
    }

    function test_executeInCommitBlock_reverts() public {
        AthenaTreasury.Action memory a = _pay("obl-1", 100 * ONE);
        vm.prank(operator);
        t.commit("d1", PH, keccak256(abi.encode(a)));
        vm.prank(operator);
        vm.expectRevert(AthenaTreasury.CommitNotSettled.selector);
        t.execute("d1", a);
    }

    function test_changedAction_reverts() public {
        AthenaTreasury.Action memory a = _pay("obl-1", 100 * ONE);
        _commit("d1", a);
        a.amount = 101 * ONE;
        vm.prank(operator);
        vm.expectRevert(AthenaTreasury.ActionMismatch.selector);
        t.execute("d1", a);
    }

    function test_sameObligationTwice_reverts() public {
        AthenaTreasury.Action memory a = _pay("obl-1", 100 * ONE);
        _commit("d1", a);
        _execute("d1", a);
        _commit("d2", a);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(AthenaTreasury.AlreadySettled.selector, a.obligationId));
        t.execute("d2", a);
    }

    function test_reveal_verifiesHashOnChain() public {
        AthenaTreasury.Action memory a = _pay("obl-1", 100 * ONE);
        _commit("d1", a);
        _execute("d1", a);
        vm.prank(stranger);
        vm.expectRevert(AthenaTreasury.HashMismatch.selector);
        t.reveal("d1", bytes("not the record"));
        vm.prank(stranger);
        t.reveal("d1", PREIMAGE);
        assertTrue(t.getDecision("d1").revealed);
        vm.expectRevert(AthenaTreasury.AlreadyRevealed.selector);
        t.reveal("d1", PREIMAGE);
    }

    function test_revealBeforeResolution_reverts() public {
        _commit("d1", _pay("obl-1", 100 * ONE));
        vm.expectRevert(AthenaTreasury.NotRevealable.selector);
        t.reveal("d1", PREIMAGE);
    }

    function test_noOpDecision_isRevealableImmediately() public {
        vm.prank(operator);
        t.commit("hold-1", PH, bytes32(0));
        assertEq(uint8(_state("hold-1")), uint8(AthenaTreasury.DecisionState.NoOp));
        t.reveal("hold-1", PREIMAGE);
        assertTrue(t.getDecision("hold-1").revealed);
    }

    function test_duplicateDecisionId_reverts() public {
        vm.startPrank(operator);
        t.commit("d1", PH, bytes32(0));
        vm.expectRevert(abi.encodeWithSelector(AthenaTreasury.DecisionExists.selector, bytes32("d1")));
        t.commit("d1", PH, bytes32(0));
        vm.stopPrank();
    }

    function test_missingEvidence_reverts() public {
        AthenaTreasury.Action memory a = _pay("obl-1", 100 * ONE);
        a.evidenceHash = bytes32(0);
        _commit("d1", a);
        vm.prank(operator);
        vm.expectRevert(AthenaTreasury.EvidenceRequired.selector);
        t.execute("d1", a);
    }

    function test_reserveAndRelease() public {
        AthenaTreasury.Action memory r = AthenaTreasury.Action(2, bytes32(0), bytes32(0), address(usdc), 300 * ONE, 0, bytes32(0));
        _commit("r1", r);
        _execute("r1", r);
        assertEq(t.reserved(address(usdc)), 300 * ONE);
        assertEq(t.freeOperating(address(usdc)), 1_700 * ONE);
        r.kind = 3;
        _commit("r2", r);
        _execute("r2", r);
        assertEq(t.reserved(address(usdc)), 0);
    }
}
