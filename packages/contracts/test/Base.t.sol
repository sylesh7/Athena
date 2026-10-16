// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {AthenaTreasury} from "../src/AthenaTreasury.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockTokenMessengerV2} from "./mocks/MockTokenMessengerV2.sol";

abstract contract Base is Test {
    AthenaTreasury internal t;
    MockERC20 internal usdc;
    MockERC20 internal eurc;
    MockTokenMessengerV2 internal tm;

    address internal admin = makeAddr("admin");
    address internal approver = makeAddr("approver");
    address internal operator = makeAddr("operator");
    address internal keeper = makeAddr("keeper");
    address internal vendor = makeAddr("vendor");
    address internal customer = makeAddr("customer");
    address internal stranger = makeAddr("stranger");

    bytes32 internal constant VENDOR = keccak256("VENDOR");
    bytes32 internal constant VENDOR_ID = keccak256("payee:vendor");
    uint256 internal constant ONE = 1e6;
    bytes internal constant PREIMAGE = bytes('{"decision":"test"}');
    // Precomputed: a precompile call (sha256) between vm.prank and the pranked call would consume the prank.
    bytes32 internal PH;

    function setUp() public virtual {
        PH = sha256(PREIMAGE);
        usdc = new MockERC20("USD Coin", "USDC", 6);
        eurc = new MockERC20("Euro Coin", "EURC", 6);
        tm = new MockTokenMessengerV2();
        t = new AthenaTreasury(admin, approver, operator, address(usdc), address(tm));

        vm.startPrank(admin);
        t.setBudget(VENDOR, address(usdc), 1_000 * ONE, 250 * ONE, 30 days, true);
        t.setMinOperating(address(usdc), 100 * ONE);
        vm.stopPrank();

        usdc.mint(address(t), 2_000 * ONE);
        _activatePayee(VENDOR_ID, vendor, VENDOR, address(usdc));
    }

    function _activatePayee(bytes32 id, address account, bytes32 category, address token) internal {
        AthenaTreasury.PayeeData memory d = AthenaTreasury.PayeeData({
            account: account, remoteRecipient: bytes32(0), domain: 26,
            category: category, token: token, perTxCap: 0
        });
        vm.prank(operator);
        t.proposePayee(id, d);
        vm.prank(approver);
        t.approvePayee(id);
    }

    function _pay(string memory obligation, uint256 amount) internal view returns (AthenaTreasury.Action memory) {
        return AthenaTreasury.Action({
            kind: 1,
            obligationId: keccak256(bytes(obligation)),
            payeeId: VENDOR_ID,
            token: address(usdc),
            amount: amount,
            maxFee: 0,
            evidenceHash: keccak256("evidence-bundle")
        });
    }

    function _commit(bytes32 id, AthenaTreasury.Action memory a) internal {
        vm.prank(operator);
        t.commit(id, PH, keccak256(abi.encode(a)));
        vm.roll(vm.getBlockNumber() + 1);
    }

    function _execute(bytes32 id, AthenaTreasury.Action memory a) internal {
        vm.prank(operator);
        t.execute(id, a);
    }

    function _state(bytes32 id) internal view returns (AthenaTreasury.DecisionState) {
        return t.getDecision(id).state;
    }
}
