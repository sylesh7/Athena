// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Base} from "./Base.t.sol";
import {AthenaTreasury} from "../src/AthenaTreasury.sol";

contract PayeesTest is Base {
    bytes32 internal constant NEW_ID = keccak256("payee:new");

    function _data(address acct) internal view returns (AthenaTreasury.PayeeData memory) {
        return AthenaTreasury.PayeeData(acct, bytes32(0), 26, VENDOR, address(usdc), 0);
    }

    function test_proposedPayee_notPayable_operatorCannotApprove() public {
        vm.prank(operator);
        t.proposePayee(NEW_ID, _data(stranger));
        AthenaTreasury.Action memory a = _pay("o1", 10 * ONE);
        a.payeeId = NEW_ID;
        _commit("d1", a);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(AthenaTreasury.PayeeNotActive.selector, NEW_ID));
        t.execute("d1", a);

        vm.prank(operator);
        vm.expectRevert();
        t.approvePayee(NEW_ID);
    }

    function test_reject_newPayee_returnsToNone() public {
        vm.prank(operator);
        t.proposePayee(NEW_ID, _data(stranger));
        vm.prank(approver);
        t.rejectPayee(NEW_ID);
        assertEq(uint8(t.getPayee(NEW_ID).status), uint8(AthenaTreasury.PayeeStatus.None));
    }

    function test_reject_change_keepsOldDataActive() public {
        vm.prank(operator);
        t.proposePayee(VENDOR_ID, _data(stranger));
        vm.prank(approver);
        t.rejectPayee(VENDOR_ID);
        assertEq(t.getPayee(VENDOR_ID).data.account, vendor);
        assertEq(uint8(t.getPayee(VENDOR_ID).status), uint8(AthenaTreasury.PayeeStatus.Active));
    }

    function test_cooldown_blocksThenPaysNewAddress() public {
        vm.prank(admin);
        t.setConfig(1 days, 3 days, 7_200, 1_000, 100);
        vm.prank(operator);
        t.proposePayee(VENDOR_ID, _data(stranger));
        assertEq(t.getPayee(VENDOR_ID).data.account, vendor);
        vm.prank(approver);
        t.approvePayee(VENDOR_ID);
        uint64 activeFrom = t.getPayee(VENDOR_ID).activeFrom;

        AthenaTreasury.Action memory a = _pay("o1", 10 * ONE);
        _commit("d1", a);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(AthenaTreasury.PayeeCoolingDown.selector, VENDOR_ID, activeFrom));
        t.execute("d1", a);

        vm.warp(vm.getBlockTimestamp() + 1 days);
        _execute("d1", a);
        assertEq(usdc.balanceOf(stranger), 10 * ONE);
        assertEq(usdc.balanceOf(vendor), 0);
    }

    function test_suspend_blocksPayment_reactivateStartsCooldown() public {
        vm.prank(admin);
        t.setConfig(1 days, 3 days, 7_200, 1_000, 100);
        vm.prank(approver);
        t.suspendPayee(VENDOR_ID);
        AthenaTreasury.Action memory a = _pay("o1", 10 * ONE);
        _commit("d1", a);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(AthenaTreasury.PayeeNotActive.selector, VENDOR_ID));
        t.execute("d1", a);

        vm.prank(approver);
        t.reactivatePayee(VENDOR_ID);
        assertFalse(t.isPayable(VENDOR_ID));
        vm.warp(vm.getBlockTimestamp() + 1 days);
        assertTrue(t.isPayable(VENDOR_ID));
    }

    function test_crossChainPayee_invalidData_reverts() public {
        vm.startPrank(admin);
        t.setSupportedToken(address(eurc), true);
        t.setBudget(VENDOR, address(eurc), 100 * ONE, 0, 30 days, true);
        vm.stopPrank();

        bytes32 rec = bytes32(uint256(uint160(vendor)));
        vm.startPrank(operator);
        vm.expectRevert(AthenaTreasury.InvalidPayeeData.selector); // EURC cross-chain
        t.proposePayee(NEW_ID, AthenaTreasury.PayeeData(address(0), rec, 6, VENDOR, address(eurc), 0));
        vm.expectRevert(AthenaTreasury.InvalidPayeeData.selector); // non-zero account on remote
        t.proposePayee(NEW_ID, AthenaTreasury.PayeeData(vendor, rec, 6, VENDOR, address(usdc), 0));
        vm.stopPrank();
    }

    function test_caps_tightenOnlyDown_adminCanRaise() public {
        vm.prank(admin);
        t.setPayeeCap(VENDOR_ID, 100 * ONE);
        vm.startPrank(operator);
        vm.expectRevert(abi.encodeWithSelector(AthenaTreasury.NotTightening.selector, 100 * ONE, 0));
        t.tightenPayeeCap(VENDOR_ID, 0);
        vm.expectRevert(abi.encodeWithSelector(AthenaTreasury.NotTightening.selector, 100 * ONE, 200 * ONE));
        t.tightenPayeeCap(VENDOR_ID, 200 * ONE);
        t.tightenPayeeCap(VENDOR_ID, 50 * ONE);
        vm.stopPrank();
        vm.prank(admin);
        t.setPayeeCap(VENDOR_ID, 500 * ONE);
        assertEq(t.getPayee(VENDOR_ID).data.perTxCap, 500 * ONE);
    }
}
