// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Base} from "../Base.t.sol";
import {AthenaTreasury} from "../../src/AthenaTreasury.sol";

/// Handler acts only as the operator: commits and executes random payments, never as approver.
contract Handler is Base {
    bytes32[] internal pool;
    uint256 public settledSum;
    mapping(bytes32 => bool) internal seen;
    uint256 internal nonce;

    constructor() {
        setUp();
        for (uint256 i; i < 20; i++) pool.push(keccak256(abi.encode("obl", i)));
    }

    function pay(uint256 seed, uint256 amount) external {
        amount = bound(amount, 1, 400 * ONE);
        bytes32 obl = pool[seed % pool.length];
        AthenaTreasury.Action memory a = _pay("x", amount);
        a.obligationId = obl;
        bytes32 id = keccak256(abi.encode(nonce++));
        vm.prank(operator);
        t.commit(id, PH, keccak256(abi.encode(a)));
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(operator);
        try t.execute(id, a) {
            if (t.getDecision(id).state == AthenaTreasury.DecisionState.Executed && !seen[obl]) {
                seen[obl] = true;
                settledSum += amount;
            }
        } catch {}
        try t.reveal(id, PREIMAGE) {} catch {}
    }

    function treasury() external view returns (AthenaTreasury) { return t; }
    function usdcToken() external view returns (address) { return address(usdc); }
    function vendorAddr() external view returns (address) { return vendor; }
}

contract TreasuryInvariantsTest is Base {
    Handler internal h;

    function setUp() public override {
        h = new Handler();
        bytes4[] memory sels = new bytes4[](1);
        sels[0] = Handler.pay.selector;
        targetSelector(FuzzSelector({addr: address(h), selectors: sels}));
        targetContract(address(h));
    }

    function invariant_budgetHoldsWithoutHuman() public view {
        (AthenaTreasury.Budget memory b,) = h.treasury().getBudget(VENDOR, h.usdcToken());
        assertLe(b.spentInPeriod, b.limitPerPeriod);
    }

    function invariant_noDoublePayment() public view {
        assertEq(MockBal(h.usdcToken()).balanceOf(h.vendorAddr()), h.settledSum());
    }

    function invariant_floorHolds() public view {
        assertGe(h.treasury().freeOperating(h.usdcToken()), h.treasury().minOperating(h.usdcToken()));
    }
}

interface MockBal {
    function balanceOf(address) external view returns (uint256);
}
