// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Base} from "./Base.t.sol";
import {AthenaTreasury} from "../src/AthenaTreasury.sol";

/// One test per bookkeeping error in the README's "six mistakes" table.
contract FailureModesTest is Base {
    function test_omission_unregisteredReceivableIsRefused() public {
        usdc.mint(customer, 10 * ONE);
        vm.startPrank(customer);
        usdc.approve(address(t), 10 * ONE);
        vm.expectRevert(abi.encodeWithSelector(AthenaTreasury.UnknownReceivable.selector, keccak256("invented")));
        t.payReceivable(keccak256("invented"), 10 * ONE);
        vm.stopPrank();
    }

    function test_commission_unapprovedPayeeCannotBePaid() public {
        AthenaTreasury.Action memory a = _pay("obl-x", 10 * ONE);
        a.payeeId = keccak256("payee:attacker");
        _commit("d1", a);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(AthenaTreasury.PayeeNotActive.selector, a.payeeId));
        t.execute("d1", a);
    }

    function test_commission_addressChangeNeedsHumanAndCooldown() public {
        vm.prank(admin);
        t.setConfig(1 days, 3 days, 7_200, 1_000, 100);
        AthenaTreasury.PayeeData memory changed = AthenaTreasury.PayeeData(stranger, bytes32(0), 26, VENDOR, address(usdc), 0);
        vm.prank(operator);
        t.proposePayee(VENDOR_ID, changed);
        assertEq(t.getPayee(VENDOR_ID).data.account, vendor);
        vm.prank(approver);
        t.approvePayee(VENDOR_ID);
        AthenaTreasury.Action memory a = _pay("obl-1", 10 * ONE);
        _commit("d1", a);
        vm.prank(operator);
        vm.expectRevert();
        t.execute("d1", a);
    }

    function test_principle_budgetChargedToPayeeCategory() public {
        AthenaTreasury.Action memory a = _pay("obl-1", 50 * ONE);
        _commit("d1", a);
        _execute("d1", a);
        (AthenaTreasury.Budget memory b,) = t.getBudget(VENDOR, address(usdc));
        assertEq(b.spentInPeriod, 50 * ONE);
    }

    function test_originalEntry_retryCannotPayTwice() public {
        AthenaTreasury.Action memory a = _pay("invoice-0042", 120 * ONE);
        _commit("d1", a);
        _execute("d1", a);
        _commit("d1-retry", a);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(AthenaTreasury.AlreadySettled.selector, a.obligationId));
        t.execute("d1-retry", a);
        assertEq(usdc.balanceOf(vendor), 120 * ONE);
    }

    function test_compensating_overpaymentIsRefused() public {
        vm.prank(operator);
        t.registerReceivable("rcv-1", address(usdc), 50 * ONE, address(0));
        usdc.mint(customer, 60 * ONE);
        vm.startPrank(customer);
        usdc.approve(address(t), 60 * ONE);
        vm.expectRevert(abi.encodeWithSelector(AthenaTreasury.Overpayment.selector, 50 * ONE, 60 * ONE));
        t.payReceivable("rcv-1", 60 * ONE);
        vm.stopPrank();
    }

    function test_reversal_customerCannotReceiveTreasuryFunds() public {
        AthenaTreasury.Action memory a = _pay("obl-r", 10 * ONE);
        a.payeeId = keccak256(abi.encode(customer));
        _commit("d1", a);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(AthenaTreasury.PayeeNotActive.selector, a.payeeId));
        t.execute("d1", a);
    }
}
