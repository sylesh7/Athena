// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {AthenaCommit} from "../src/AthenaCommit.sol";
import {IERC8183} from "../src/interfaces/IERC8183.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ── Mock contracts ────────────────────────────────────────────────────────────

/// @dev 6-decimal ERC-20 matching Arc USDC ERC-20 interface
contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Minimal ERC-8183 mock that records calls for assertion
contract MockERC8183 is IERC8183 {
    struct Call {
        bytes32 jobId;
        bool isComplete;
        bytes32 hashArg;
    }

    Call[] public calls;
    bool public shouldRevert;

    function setShouldRevert(bool v) external {
        shouldRevert = v;
    }

    function createJob(address, address, uint256, string calldata, address)
        external pure returns (bytes32) { return bytes32(0); }

    function setBudget(bytes32, uint256, bytes calldata) external {}

    function fund(bytes32, bytes calldata) external {}

    function submit(bytes32, bytes32, bytes calldata) external {}

    function complete(bytes32 jobId, bytes32 deliverableHash, bytes calldata) external {
        if (shouldRevert) revert("mock-revert");
        calls.push(Call({jobId: jobId, isComplete: true, hashArg: deliverableHash}));
    }

    function reject(bytes32 jobId, bytes32 reason, bytes calldata) external {
        if (shouldRevert) revert("mock-revert");
        calls.push(Call({jobId: jobId, isComplete: false, hashArg: reason}));
    }

    function getJob(bytes32) external pure returns (
        address, address, address, uint256, uint256, uint8, string memory
    ) {
        return (address(0), address(0), address(0), 0, 0, 0, "");
    }

    function callCount() external view returns (uint256) {
        return calls.length;
    }
}

// ── Test contract ─────────────────────────────────────────────────────────────

contract AthenaCommitTest is Test {
    AthenaCommit public athena;
    MockUSDC public usdc;
    MockERC8183 public erc8183;

    address broker = makeAddr("broker");
    address client = makeAddr("client");
    address stranger = makeAddr("stranger");

    uint256 constant BOND = 1_000_000; // 1 USDC (6 decimals)

    bytes32 taskId;
    bytes32 commitHash;
    bytes32 wrongHash;
    bytes32 erc8183JobId;
    bytes32 deliverableHash;

    function setUp() public {
        usdc = new MockUSDC();
        erc8183 = new MockERC8183();
        athena = new AthenaCommit(address(usdc), address(erc8183));

        // taskId uses the canonical scheme: keccak256(abi.encodePacked(client, taskDescription, blockNumber))
        taskId = keccak256(abi.encodePacked(client, "Get USDC/ETH price every second for 60 seconds", block.number));
        commitHash = bytes32(keccak256("canonical-decision-json"));
        wrongHash = bytes32(keccak256("different-decision"));
        erc8183JobId = bytes32(keccak256("job-1"));
        deliverableHash = bytes32(keccak256("deliverable"));

        usdc.mint(broker, 10_000_000); // 10 USDC
        vm.prank(broker);
        usdc.approve(address(athena), type(uint256).max);
    }

    // ── Constructor / immutables ──────────────────────────────────────────────

    function test_immutables_set() public {
        assertEq(address(athena.USDC()), address(usdc));
        assertEq(address(athena.ERC8183()), address(erc8183));
    }

    // ── computeTaskId helper ──────────────────────────────────────────────────

    function test_computeTaskId_matches_offchain() public {
        bytes32 computed = athena.computeTaskId(
            client,
            "Get USDC/ETH price every second for 60 seconds",
            block.number
        );
        assertEq(computed, taskId);
    }

    // ── commit() ─────────────────────────────────────────────────────────────

    function test_commit_happy_no_erc8183() public {
        vm.prank(broker);
        athena.commit(taskId, commitHash, BOND, client, bytes32(0));

        AthenaCommit.Commitment memory c = athena.getCommitment(taskId);
        assertEq(c.commitHash, commitHash);
        assertEq(c.broker, broker);
        assertEq(c.client, client);
        assertEq(c.bondAmount, BOND);
        assertEq(c.erc8183JobId, bytes32(0));
        assertFalse(c.revealed);
        assertFalse(c.slashed);
        assertEq(usdc.balanceOf(address(athena)), BOND);
        assertTrue(athena.isCommitted(taskId));
    }

    function test_commit_happy_with_erc8183() public {
        vm.prank(broker);
        athena.commit(taskId, commitHash, BOND, client, erc8183JobId);

        AthenaCommit.Commitment memory c = athena.getCommitment(taskId);
        assertEq(c.erc8183JobId, erc8183JobId);
    }

    function test_commit_emits_event() public {
        vm.expectEmit(true, true, true, true);
        emit AthenaCommit.Committed(
            taskId, broker, client, commitHash, BOND, bytes32(0), block.number
        );
        vm.prank(broker);
        athena.commit(taskId, commitHash, BOND, client, bytes32(0));
    }

    function test_commit_reverts_duplicate() public {
        vm.prank(broker);
        athena.commit(taskId, commitHash, BOND, client, bytes32(0));

        vm.expectRevert(AthenaCommit.AlreadyCommitted.selector);
        vm.prank(broker);
        athena.commit(taskId, commitHash, BOND, client, bytes32(0));
    }

    function test_commit_reverts_zero_bond() public {
        vm.expectRevert(AthenaCommit.ZeroBond.selector);
        vm.prank(broker);
        athena.commit(taskId, commitHash, 0, client, bytes32(0));
    }

    function test_commit_reverts_zero_client() public {
        vm.expectRevert(AthenaCommit.ZeroClient.selector);
        vm.prank(broker);
        athena.commit(taskId, commitHash, BOND, address(0), bytes32(0));
    }

    // ── reveal() ─────────────────────────────────────────────────────────────

    function _commit(bytes32 jobId) internal {
        vm.prank(broker);
        athena.commit(taskId, commitHash, BOND, client, jobId);
    }

    function test_reveal_prediction_met_releases_to_broker() public {
        _commit(bytes32(0));
        vm.prank(broker);
        athena.reveal(taskId, true, commitHash, bytes32(0));

        assertEq(athena.withdrawable(broker), BOND);
        assertEq(athena.withdrawable(client), 0);
        assertTrue(athena.isRevealed(taskId));
        assertFalse(athena.isSlashed(taskId));
        // also verify via raw mapping tuple
        assertTrue(athena.getCommitment(taskId).revealed);
        assertFalse(athena.getCommitment(taskId).slashed);
    }

    function test_reveal_prediction_not_met_slashes_to_client() public {
        _commit(bytes32(0));
        vm.prank(broker);
        athena.reveal(taskId, false, commitHash, bytes32(0));

        assertEq(athena.withdrawable(client), BOND);
        assertEq(athena.withdrawable(broker), 0);
        assertTrue(athena.isRevealed(taskId));
        assertTrue(athena.isSlashed(taskId));
        assertTrue(athena.getCommitment(taskId).revealed);
        assertTrue(athena.getCommitment(taskId).slashed);
    }

    function test_reveal_emits_event_success() public {
        _commit(bytes32(0));
        vm.expectEmit(true, true, false, true);
        emit AthenaCommit.Revealed(taskId, broker, true, false, commitHash);
        vm.prank(broker);
        athena.reveal(taskId, true, commitHash, bytes32(0));
    }

    function test_reveal_emits_event_slash() public {
        _commit(bytes32(0));
        vm.expectEmit(true, true, false, true);
        emit AthenaCommit.Revealed(taskId, broker, false, true, commitHash);
        vm.prank(broker);
        athena.reveal(taskId, false, commitHash, bytes32(0));
    }

    function test_reveal_reverts_not_committed() public {
        vm.expectRevert(AthenaCommit.NotCommitted.selector);
        vm.prank(broker);
        athena.reveal(keccak256("unknown"), true, commitHash, bytes32(0));
    }

    function test_reveal_reverts_already_revealed() public {
        _commit(bytes32(0));
        vm.prank(broker);
        athena.reveal(taskId, true, commitHash, bytes32(0));

        vm.expectRevert(AthenaCommit.AlreadyRevealed.selector);
        vm.prank(broker);
        athena.reveal(taskId, true, commitHash, bytes32(0));
    }

    function test_reveal_reverts_wrong_caller() public {
        _commit(bytes32(0));
        vm.expectRevert(AthenaCommit.NotBroker.selector);
        vm.prank(stranger);
        athena.reveal(taskId, true, commitHash, bytes32(0));
    }

    function test_reveal_reverts_hash_mismatch() public {
        _commit(bytes32(0));
        vm.expectRevert(AthenaCommit.HashMismatch.selector);
        vm.prank(broker);
        athena.reveal(taskId, true, wrongHash, bytes32(0));
    }

    // ── ERC-8183 integration ──────────────────────────────────────────────────

    function test_reveal_calls_erc8183_complete_on_success() public {
        _commit(erc8183JobId);
        vm.prank(broker);
        athena.reveal(taskId, true, commitHash, deliverableHash);

        assertEq(erc8183.callCount(), 1);
        (bytes32 jobId, bool isComplete, bytes32 hashArg) = erc8183.calls(0);
        assertEq(jobId, erc8183JobId);
        assertTrue(isComplete);
        assertEq(hashArg, deliverableHash);
    }

    function test_reveal_calls_erc8183_reject_on_slash() public {
        _commit(erc8183JobId);
        vm.prank(broker);
        athena.reveal(taskId, false, commitHash, bytes32(0));

        assertEq(erc8183.callCount(), 1);
        (, bool isComplete,) = erc8183.calls(0);
        assertFalse(isComplete);
    }

    function test_reveal_erc8183_revert_does_not_block_bond_settlement() public {
        erc8183.setShouldRevert(true);
        _commit(erc8183JobId);

        // Bond settlement should still succeed even if ERC-8183 call reverts
        vm.prank(broker);
        athena.reveal(taskId, true, commitHash, deliverableHash);

        assertEq(athena.withdrawable(broker), BOND); // bond still settled
        assertEq(erc8183.callCount(), 0);            // ERC-8183 call failed silently
    }

    function test_reveal_skips_erc8183_when_jobid_zero() public {
        _commit(bytes32(0));
        vm.prank(broker);
        athena.reveal(taskId, true, commitHash, bytes32(0));

        assertEq(erc8183.callCount(), 0);
    }

    function test_reveal_emits_erc8183_settled_event() public {
        _commit(erc8183JobId);
        vm.expectEmit(true, true, false, true);
        emit AthenaCommit.ERC8183Settled(taskId, erc8183JobId, true);
        vm.prank(broker);
        athena.reveal(taskId, true, commitHash, deliverableHash);
    }

    // ── withdraw() ───────────────────────────────────────────────────────────

    function test_withdraw_broker_after_success() public {
        _commit(bytes32(0));
        vm.prank(broker);
        athena.reveal(taskId, true, commitHash, bytes32(0));

        uint256 before = usdc.balanceOf(broker);
        vm.prank(broker);
        athena.withdraw();

        assertEq(usdc.balanceOf(broker), before + BOND);
        assertEq(athena.withdrawable(broker), 0);
    }

    function test_withdraw_client_after_slash() public {
        _commit(bytes32(0));
        vm.prank(broker);
        athena.reveal(taskId, false, commitHash, bytes32(0));

        uint256 before = usdc.balanceOf(client);
        vm.prank(client);
        athena.withdraw();

        assertEq(usdc.balanceOf(client), before + BOND);
        assertEq(athena.withdrawable(client), 0);
    }

    function test_withdraw_reverts_nothing_to_withdraw() public {
        vm.expectRevert(AthenaCommit.NothingToWithdraw.selector);
        vm.prank(stranger);
        athena.withdraw();
    }

    function test_withdraw_emits_event() public {
        _commit(bytes32(0));
        vm.prank(broker);
        athena.reveal(taskId, true, commitHash, bytes32(0));

        vm.expectEmit(true, false, false, true);
        emit AthenaCommit.Withdrawn(broker, BOND);
        vm.prank(broker);
        athena.withdraw();
    }

    // ── End-to-end paths ──────────────────────────────────────────────────────

    function test_full_happy_path_with_erc8183() public {
        // commit with ERC-8183 link
        vm.prank(broker);
        athena.commit(taskId, commitHash, BOND, client, erc8183JobId);
        assertEq(usdc.balanceOf(address(athena)), BOND);

        // reveal — prediction held
        vm.prank(broker);
        athena.reveal(taskId, true, commitHash, deliverableHash);
        assertEq(athena.withdrawable(broker), BOND);
        assertEq(erc8183.callCount(), 1); // ERC-8183 complete() called

        // broker withdraws
        vm.prank(broker);
        athena.withdraw();
        assertEq(usdc.balanceOf(broker), 10_000_000); // back to start
        assertEq(usdc.balanceOf(address(athena)), 0);
    }

    function test_full_slash_path_with_erc8183() public {
        vm.prank(broker);
        athena.commit(taskId, commitHash, BOND, client, erc8183JobId);

        vm.prank(broker);
        athena.reveal(taskId, false, commitHash, bytes32(0));
        assertEq(athena.withdrawable(client), BOND);
        assertEq(erc8183.callCount(), 1); // ERC-8183 reject() called

        vm.prank(client);
        athena.withdraw();
        assertEq(usdc.balanceOf(client), BOND);
        assertEq(usdc.balanceOf(address(athena)), 0);
    }

    function test_full_happy_path_no_erc8183() public {
        vm.prank(broker);
        athena.commit(taskId, commitHash, BOND, client, bytes32(0));

        vm.prank(broker);
        athena.reveal(taskId, true, commitHash, bytes32(0));

        vm.prank(broker);
        athena.withdraw();
        assertEq(usdc.balanceOf(broker), 10_000_000);
        assertEq(usdc.balanceOf(address(athena)), 0);
    }

    // ── Multiple independent streams ──────────────────────────────────────────

    function test_multiple_streams_independent() public {
        bytes32 taskId2 = keccak256(abi.encodePacked(client, "second task", block.number + 1));

        usdc.mint(broker, 10_000_000);
        vm.startPrank(broker);

        athena.commit(taskId, commitHash, BOND, client, bytes32(0));
        athena.commit(taskId2, commitHash, BOND, client, bytes32(0));

        // stream 1 succeeds, stream 2 fails
        athena.reveal(taskId, true, commitHash, bytes32(0));
        athena.reveal(taskId2, false, commitHash, bytes32(0));

        vm.stopPrank();

        assertEq(athena.withdrawable(broker), BOND);
        assertEq(athena.withdrawable(client), BOND);
    }
}
