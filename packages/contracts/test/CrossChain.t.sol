// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Base} from "./Base.t.sol";
import {AthenaTreasury} from "../src/AthenaTreasury.sol";

contract CrossChainTest is Base {
    bytes32 internal constant REMOTE_ID = keccak256("payee:remote");

    function setUp() public override {
        super.setUp();
        bytes32 rec = bytes32(uint256(uint160(vendor)));
        AthenaTreasury.PayeeData memory d = AthenaTreasury.PayeeData(address(0), rec, 6, VENDOR, address(usdc), 0);
        vm.prank(operator);
        t.proposePayee(REMOTE_ID, d);
        vm.prank(approver);
        t.approvePayee(REMOTE_ID);
    }

    function _remote(string memory obl, uint256 amount, uint256 fee) internal view returns (AthenaTreasury.Action memory a) {
        a = _pay(obl, amount);
        a.payeeId = REMOTE_ID;
        a.maxFee = fee;
    }

    function test_burnsThroughMessenger() public {
        AthenaTreasury.Action memory a = _remote("o1", 100 * ONE, ONE / 2);
        _commit("d1", a);
        _execute("d1", a);
        (uint256 amount, uint32 domain, bytes32 recipient, address token, bytes32 caller, uint256 maxFee, uint32 finality) = tm.last();
        assertEq(tm.calls(), 1);
        assertEq(amount, 100 * ONE);
        assertEq(domain, 6);
        assertEq(recipient, bytes32(uint256(uint160(vendor))));
        assertEq(token, address(usdc));
        assertEq(caller, bytes32(0));
        assertEq(maxFee, ONE / 2);
        assertEq(finality, 1_000);
        assertEq(usdc.allowance(address(t), address(tm)), 0);
    }

    function test_feeTooHigh_reverts() public {
        AthenaTreasury.Action memory a = _remote("o1", 100 * ONE, 2 * ONE); // 2% > 1% cap
        _commit("d1", a);
        vm.prank(operator);
        vm.expectRevert(AthenaTreasury.FeeTooHigh.selector);
        t.execute("d1", a);

        AthenaTreasury.Action memory eq = _remote("o2", 100 * ONE, 100 * ONE);
        _commit("d2", eq);
        vm.prank(operator);
        vm.expectRevert(AthenaTreasury.FeeTooHigh.selector);
        t.execute("d2", eq);
    }

    function test_localPayee_withFee_reverts() public {
        AthenaTreasury.Action memory a = _pay("o1", 10 * ONE);
        a.maxFee = 1;
        _commit("d1", a);
        vm.prank(operator);
        vm.expectRevert(AthenaTreasury.FeeNotAllowed.selector);
        t.execute("d1", a);
    }

    function test_eurcAction_onCrossChainPayee_reverts() public {
        vm.prank(admin);
        t.setSupportedToken(address(eurc), true);
        AthenaTreasury.Action memory a = _remote("o1", 10 * ONE, 0);
        a.token = address(eurc);
        _commit("d1", a);
        vm.prank(operator);
        vm.expectRevert(AthenaTreasury.TokenMismatch.selector);
        t.execute("d1", a);
    }
}
