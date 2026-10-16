// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ITokenMessengerV2} from "./interfaces/ITokenMessengerV2.sol";

/// @title AthenaTreasury
/// @notice A business treasury that an AI operator runs inside on-chain rules it cannot change.
///         Every decision is committed before it executes and revealed after it; the contract
///         verifies each revealed record and freezes the operator when a reveal is overdue.
contract AthenaTreasury is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ───────────────────────────── roles ─────────────────────────────
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant APPROVER_ROLE = keccak256("APPROVER_ROLE");

    // ─────────────────────────── constants ───────────────────────────
    uint32 public constant LOCAL_DOMAIN = 26;
    uint256 internal constant BPS = 10_000;
    uint16 public constant MAX_CCTP_FEE_BPS_CEILING = 1_000;

    uint8 public constant KIND_PAY = 1;
    uint8 public constant KIND_RESERVE = 2;
    uint8 public constant KIND_RELEASE_RESERVE = 3;

    uint8 public constant ESC_BUDGET = 1;
    uint8 public constant ESC_TX_LIMIT = 2;
    uint8 public constant ESC_PAYEE_CAP = 3;
    uint8 public constant ESC_LIQUIDITY_FLOOR = 4;

    // ───────────────────────────── types ─────────────────────────────
    struct Action {
        uint8 kind;
        bytes32 obligationId;
        bytes32 payeeId;
        address token;
        uint256 amount;
        uint256 maxFee;
        bytes32 evidenceHash;
    }

    struct Budget {
        uint256 limitPerPeriod;
        uint256 perTxApprovalLimit;
        uint256 spentInPeriod;
        uint64 periodSeconds;
        uint64 periodStart;
        bool requiresEvidence;
        bool exists;
    }

    enum PayeeStatus { None, Pending, Active, Suspended }

    struct PayeeData {
        address account;
        bytes32 remoteRecipient;
        uint32 domain;
        bytes32 category;
        address token;
        uint256 perTxCap;
    }

    struct Payee {
        PayeeData data;
        PayeeStatus status;
        uint64 activeFrom;
    }

    enum DecisionState { None, Committed, Executed, Escalated, Approved, Rejected, Cancelled, NoOp }

    struct Decision {
        bytes32 decisionHash;
        bytes32 actionHash;
        uint64 committedBlock;
        uint64 resolvedBlock;
        DecisionState state;
        bool revealed;
        bool flaggedOverdue;
    }

    struct Escalation {
        Action action;
        uint8 reason;
        uint64 expiresAt;
    }

    struct Receivable {
        address token;
        address customer;
        uint256 amountDue;
        uint256 amountPaid;
        bool exists;
    }

    // ──────────────────────────── wiring ─────────────────────────────
    address public immutable usdc;
    ITokenMessengerV2 public immutable tokenMessenger;

    // ──────────────────────────── config ─────────────────────────────
    uint64 public payeeCooldown;
    uint64 public escalationTtl;
    uint64 public revealDeadlineBlocks;
    uint32 public cctpMinFinalityThreshold;
    uint16 public maxCctpFeeBps;

    // ──────────────────────────── state ──────────────────────────────
    mapping(address => bool) public supportedToken;
    mapping(address => uint256) public reserved;
    mapping(address => uint256) public minOperating;
    mapping(bytes32 => mapping(address => Budget)) internal _budgets;
    mapping(bytes32 => Payee) internal _payees;
    mapping(bytes32 => PayeeData) internal _pendingPayees;
    mapping(bytes32 => bool) public hasPendingPayee;
    mapping(bytes32 => Decision) internal _decisions;
    mapping(bytes32 => Escalation) internal _escalations;
    mapping(bytes32 => bool) public obligationSettled;
    mapping(bytes32 => Receivable) internal _receivables;
    uint256 public overdueCount;

    // ──────────────────────────── events ─────────────────────────────
    event TokenSupportSet(address indexed token, bool supported);
    event MinOperatingSet(address indexed token, uint256 amount);
    event ConfigSet(uint64 payeeCooldown, uint64 escalationTtl, uint64 revealDeadlineBlocks, uint32 cctpMinFinalityThreshold, uint16 maxCctpFeeBps);
    event BudgetSet(bytes32 indexed category, address indexed token, uint256 limitPerPeriod, uint256 perTxApprovalLimit, uint64 periodSeconds, bool requiresEvidence);
    event PayeeProposed(bytes32 indexed payeeId, address account, bytes32 remoteRecipient, uint32 domain, bytes32 category, address token, bool isChange);
    event PayeeApproved(bytes32 indexed payeeId, uint64 activeFrom, address indexed approver);
    event PayeeRejected(bytes32 indexed payeeId, address indexed approver);
    event PayeeSuspended(bytes32 indexed payeeId, address indexed by);
    event PayeeCapChanged(bytes32 indexed payeeId, uint256 oldCap, uint256 newCap, address indexed by);
    event Funded(address indexed from, address indexed token, uint256 amount, bytes32 indexed sourceTag);
    event ReceivableRegistered(bytes32 indexed receivableId, address indexed token, address customer, uint256 amountDue);
    event ReceivablePaid(bytes32 indexed receivableId, address indexed payer, address token, uint256 amount, uint256 totalPaid);
    event DecisionCommitted(bytes32 indexed decisionId, bytes32 decisionHash, bytes32 actionHash, uint64 blockNumber);
    event DecisionExecuted(bytes32 indexed decisionId, uint8 kind, bytes32 indexed obligationId, bytes32 indexed payeeId, address token, uint256 amount, bytes32 evidenceHash);
    event CrossChainPaymentInitiated(bytes32 indexed decisionId, bytes32 indexed payeeId, uint32 destinationDomain, bytes32 mintRecipient, uint256 amount, uint256 maxFee);
    event ReserveMoved(bytes32 indexed decisionId, address indexed token, bool intoReserve, uint256 amount, uint256 reservedAfter);
    event DecisionEscalated(bytes32 indexed decisionId, uint8 reason, uint64 expiresAt);
    event EscalationApproved(bytes32 indexed decisionId, address indexed approver);
    event EscalationRejected(bytes32 indexed decisionId, address indexed approver);
    event DecisionCancelled(bytes32 indexed decisionId);
    event DecisionRevealed(bytes32 indexed decisionId, bytes preimage);
    event AuditArrears(bytes32 indexed decisionId, uint256 overdueCount);
    event AuditCleared(bytes32 indexed decisionId, uint256 overdueCount);
    event AdminWithdrawal(address indexed token, address indexed to, uint256 amount);

    // ──────────────────────────── errors ─────────────────────────────
    error ZeroAddress();
    error ZeroAmount();
    error ZeroValue();
    error RoleCollision();
    error Unauthorized();
    error UnsupportedToken(address token);
    error NoBudget(bytes32 category, address token);
    error BadPeriod();
    error BadConfig();
    error InvalidPayeeData();
    error NoPendingPayee(bytes32 payeeId);
    error PayeeNotActive(bytes32 payeeId);
    error PayeeCoolingDown(bytes32 payeeId, uint64 activeFrom);
    error TokenMismatch();
    error NotTightening(uint256 currentCap, uint256 newCap);
    error DecisionExists(bytes32 decisionId);
    error UnknownDecision(bytes32 decisionId);
    error BadDecisionState(bytes32 decisionId, DecisionState state);
    error CommitNotSettled();
    error ActionMismatch();
    error UnknownKind(uint8 kind);
    error AlreadySettled(bytes32 obligationId);
    error EvidenceRequired();
    error FeeNotAllowed();
    error FeeTooHigh();
    error NotCrossChainToken();
    error InsufficientFunds(address token, uint256 available, uint256 requested);
    error InsufficientReserve();
    error EscalationExpired();
    error NotRevealable();
    error AlreadyRevealed();
    error HashMismatch();
    error NotOverdue();
    error AuditInArrears(uint256 overdueCount);
    error ReceivableExists(bytes32 receivableId);
    error UnknownReceivable(bytes32 receivableId);
    error NotCustomer();
    error Overpayment(uint256 outstanding, uint256 attempted);

    // ─────────────────────────── modifiers ───────────────────────────
    modifier noArrears() {
        if (overdueCount != 0) revert AuditInArrears(overdueCount);
        _;
    }

    // ────────────────────────── constructor ──────────────────────────
    constructor(address admin, address approver, address operator, address usdc_, address tokenMessenger_) {
        if (
            admin == address(0) || approver == address(0) || operator == address(0) ||
            usdc_ == address(0) || tokenMessenger_ == address(0)
        ) revert ZeroAddress();
        usdc = usdc_;
        tokenMessenger = ITokenMessengerV2(tokenMessenger_);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(APPROVER_ROLE, approver);
        _grantRole(OPERATOR_ROLE, operator);
        supportedToken[usdc_] = true;
        emit TokenSupportSet(usdc_, true);
        escalationTtl = 3 days;
        revealDeadlineBlocks = 7_200;
        cctpMinFinalityThreshold = 1_000;
        maxCctpFeeBps = 100;
        emit ConfigSet(0, 3 days, 7_200, 1_000, 100);
    }

    function _grantRole(bytes32 role, address account) internal override returns (bool) {
        if (role == OPERATOR_ROLE) {
            if (hasRole(DEFAULT_ADMIN_ROLE, account) || hasRole(APPROVER_ROLE, account)) revert RoleCollision();
        } else if (role == DEFAULT_ADMIN_ROLE || role == APPROVER_ROLE) {
            if (hasRole(OPERATOR_ROLE, account)) revert RoleCollision();
        }
        return super._grantRole(role, account);
    }

    // ───────────────────────── admin config ──────────────────────────
    function setSupportedToken(address token, bool supported) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (token == address(0)) revert ZeroAddress();
        if (token == usdc && !supported) revert UnsupportedToken(token);
        supportedToken[token] = supported;
        emit TokenSupportSet(token, supported);
    }

    function setMinOperating(address token, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!supportedToken[token]) revert UnsupportedToken(token);
        minOperating[token] = amount;
        emit MinOperatingSet(token, amount);
    }

    function setConfig(
        uint64 payeeCooldown_,
        uint64 escalationTtl_,
        uint64 revealDeadlineBlocks_,
        uint32 cctpMinFinalityThreshold_,
        uint16 maxCctpFeeBps_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (escalationTtl_ == 0 || revealDeadlineBlocks_ == 0 || maxCctpFeeBps_ > MAX_CCTP_FEE_BPS_CEILING) {
            revert BadConfig();
        }
        payeeCooldown = payeeCooldown_;
        escalationTtl = escalationTtl_;
        revealDeadlineBlocks = revealDeadlineBlocks_;
        cctpMinFinalityThreshold = cctpMinFinalityThreshold_;
        maxCctpFeeBps = maxCctpFeeBps_;
        emit ConfigSet(payeeCooldown_, escalationTtl_, revealDeadlineBlocks_, cctpMinFinalityThreshold_, maxCctpFeeBps_);
    }

    function setBudget(
        bytes32 category,
        address token,
        uint256 limitPerPeriod,
        uint256 perTxApprovalLimit,
        uint64 periodSeconds,
        bool requiresEvidence
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!supportedToken[token]) revert UnsupportedToken(token);
        if (periodSeconds == 0) revert BadPeriod();
        Budget storage b = _budgets[category][token];
        b.limitPerPeriod = limitPerPeriod;
        b.perTxApprovalLimit = perTxApprovalLimit;
        b.periodSeconds = periodSeconds;
        b.requiresEvidence = requiresEvidence;
        if (!b.exists) {
            b.exists = true;
            b.periodStart = uint64(block.timestamp);
        }
        emit BudgetSet(category, token, limitPerPeriod, perTxApprovalLimit, periodSeconds, requiresEvidence);
    }

    function setPayeeCap(bytes32 payeeId, uint256 cap) external onlyRole(DEFAULT_ADMIN_ROLE) {
        Payee storage p = _payees[payeeId];
        if (p.status == PayeeStatus.None) revert PayeeNotActive(payeeId);
        emit PayeeCapChanged(payeeId, p.data.perTxCap, cap, msg.sender);
        p.data.perTxCap = cap;
    }

    function pause() external {
        if (!hasRole(DEFAULT_ADMIN_ROLE, msg.sender) && !hasRole(APPROVER_ROLE, msg.sender)) revert Unauthorized();
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function adminWithdraw(address token, address to, uint256 amount)
        external onlyRole(DEFAULT_ADMIN_ROLE) whenPaused nonReentrant
    {
        if (to == address(0)) revert ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
        emit AdminWithdrawal(token, to, amount);
    }

    // ──────────────────────────── payees ─────────────────────────────
    function proposePayee(bytes32 payeeId, PayeeData calldata d) external onlyRole(OPERATOR_ROLE) whenNotPaused {
        if (payeeId == bytes32(0)) revert ZeroValue();
        _validatePayeeData(d);
        Payee storage p = _payees[payeeId];
        bool isChange = p.status == PayeeStatus.Active || p.status == PayeeStatus.Suspended;
        if (!isChange) p.status = PayeeStatus.Pending;
        _pendingPayees[payeeId] = d;
        hasPendingPayee[payeeId] = true;
        emit PayeeProposed(payeeId, d.account, d.remoteRecipient, d.domain, d.category, d.token, isChange);
    }

    function approvePayee(bytes32 payeeId) external onlyRole(APPROVER_ROLE) whenNotPaused {
        if (!hasPendingPayee[payeeId]) revert NoPendingPayee(payeeId);
        Payee storage p = _payees[payeeId];
        p.data = _pendingPayees[payeeId];
        delete _pendingPayees[payeeId];
        hasPendingPayee[payeeId] = false;
        p.status = PayeeStatus.Active;
        p.activeFrom = uint64(block.timestamp) + payeeCooldown;
        emit PayeeApproved(payeeId, p.activeFrom, msg.sender);
    }

    function rejectPayee(bytes32 payeeId) external onlyRole(APPROVER_ROLE) {
        if (!hasPendingPayee[payeeId]) revert NoPendingPayee(payeeId);
        delete _pendingPayees[payeeId];
        hasPendingPayee[payeeId] = false;
        if (_payees[payeeId].status == PayeeStatus.Pending) _payees[payeeId].status = PayeeStatus.None;
        emit PayeeRejected(payeeId, msg.sender);
    }

    function suspendPayee(bytes32 payeeId) external {
        if (!hasRole(DEFAULT_ADMIN_ROLE, msg.sender) && !hasRole(APPROVER_ROLE, msg.sender)) revert Unauthorized();
        Payee storage p = _payees[payeeId];
        if (p.status != PayeeStatus.Active) revert PayeeNotActive(payeeId);
        p.status = PayeeStatus.Suspended;
        emit PayeeSuspended(payeeId, msg.sender);
    }

    function reactivatePayee(bytes32 payeeId) external onlyRole(APPROVER_ROLE) whenNotPaused {
        Payee storage p = _payees[payeeId];
        if (p.status != PayeeStatus.Suspended) revert PayeeNotActive(payeeId);
        p.status = PayeeStatus.Active;
        p.activeFrom = uint64(block.timestamp) + payeeCooldown;
        emit PayeeApproved(payeeId, p.activeFrom, msg.sender);
    }

    function tightenPayeeCap(bytes32 payeeId, uint256 newCap) external onlyRole(OPERATOR_ROLE) {
        Payee storage p = _payees[payeeId];
        if (p.status == PayeeStatus.None) revert PayeeNotActive(payeeId);
        uint256 cur = p.data.perTxCap;
        if (newCap == 0 || (cur != 0 && newCap >= cur)) revert NotTightening(cur, newCap);
        p.data.perTxCap = newCap;
        emit PayeeCapChanged(payeeId, cur, newCap, msg.sender);
    }

    // ───────────────────────── money coming in ───────────────────────
    function fund(address token, uint256 amount, bytes32 sourceTag) external nonReentrant {
        if (!supportedToken[token]) revert UnsupportedToken(token);
        if (amount == 0) revert ZeroAmount();
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit Funded(msg.sender, token, amount, sourceTag);
    }

    function registerReceivable(bytes32 receivableId, address token, uint256 amountDue, address customer)
        external onlyRole(OPERATOR_ROLE) whenNotPaused
    {
        if (receivableId == bytes32(0)) revert ZeroValue();
        if (!supportedToken[token]) revert UnsupportedToken(token);
        if (amountDue == 0) revert ZeroAmount();
        Receivable storage r = _receivables[receivableId];
        if (r.exists) revert ReceivableExists(receivableId);
        r.token = token;
        r.customer = customer;
        r.amountDue = amountDue;
        r.exists = true;
        emit ReceivableRegistered(receivableId, token, customer, amountDue);
    }

    function payReceivable(bytes32 receivableId, uint256 amount) external nonReentrant {
        Receivable storage r = _receivables[receivableId];
        if (!r.exists) revert UnknownReceivable(receivableId);
        if (r.customer != address(0) && msg.sender != r.customer) revert NotCustomer();
        if (amount == 0) revert ZeroAmount();
        uint256 newPaid = r.amountPaid + amount;
        if (newPaid > r.amountDue) revert Overpayment(r.amountDue - r.amountPaid, amount);
        r.amountPaid = newPaid;
        IERC20(r.token).safeTransferFrom(msg.sender, address(this), amount);
        emit ReceivablePaid(receivableId, msg.sender, r.token, amount, newPaid);
    }

    // ─────────────────────────── decisions ───────────────────────────
    function commit(bytes32 decisionId, bytes32 decisionHash, bytes32 actionHash)
        external onlyRole(OPERATOR_ROLE) whenNotPaused noArrears
    {
        if (decisionId == bytes32(0) || decisionHash == bytes32(0)) revert ZeroValue();
        Decision storage d = _decisions[decisionId];
        if (d.state != DecisionState.None) revert DecisionExists(decisionId);
        d.decisionHash = decisionHash;
        d.actionHash = actionHash;
        d.committedBlock = uint64(block.number);
        if (actionHash == bytes32(0)) {
            d.state = DecisionState.NoOp;
            d.resolvedBlock = uint64(block.number);
        } else {
            d.state = DecisionState.Committed;
        }
        emit DecisionCommitted(decisionId, decisionHash, actionHash, uint64(block.number));
    }

    function execute(bytes32 decisionId, Action calldata a)
        external onlyRole(OPERATOR_ROLE) whenNotPaused noArrears nonReentrant
    {
        Decision storage d = _decisions[decisionId];
        if (d.state != DecisionState.Committed) revert BadDecisionState(decisionId, d.state);
        if (block.number <= d.committedBlock) revert CommitNotSettled();
        if (keccak256(abi.encode(a)) != d.actionHash) revert ActionMismatch();
        d.resolvedBlock = uint64(block.number);
        Action memory act = a;

        if (act.kind == KIND_PAY) {
            (Payee storage p, Budget storage b) = _checkPayHard(act);
            _roll(b);
            uint8 reason = _softCheckPay(act, p, b);
            if (reason != 0) {
                _escalate(decisionId, d, act, reason);
                return;
            }
            d.state = DecisionState.Executed;
            _doPay(decisionId, act, p, b);
        } else if (act.kind == KIND_RESERVE) {
            _checkReserveHard(act);
            if (_freeOperating(act.token) - act.amount < minOperating[act.token]) {
                _escalate(decisionId, d, act, ESC_LIQUIDITY_FLOOR);
                return;
            }
            d.state = DecisionState.Executed;
            _moveReserve(decisionId, act, true);
        } else if (act.kind == KIND_RELEASE_RESERVE) {
            if (!supportedToken[act.token]) revert UnsupportedToken(act.token);
            if (act.amount == 0) revert ZeroAmount();
            if (reserved[act.token] < act.amount) revert InsufficientReserve();
            d.state = DecisionState.Executed;
            _moveReserve(decisionId, act, false);
        } else {
            revert UnknownKind(act.kind);
        }
    }

    function cancel(bytes32 decisionId) external onlyRole(OPERATOR_ROLE) {
        Decision storage d = _decisions[decisionId];
        if (d.state != DecisionState.Committed && d.state != DecisionState.Escalated) {
            revert BadDecisionState(decisionId, d.state);
        }
        if (d.state == DecisionState.Committed) d.resolvedBlock = uint64(block.number);
        d.state = DecisionState.Cancelled;
        emit DecisionCancelled(decisionId);
    }

    function reveal(bytes32 decisionId, bytes calldata preimage) external {
        Decision storage d = _decisions[decisionId];
        if (d.state == DecisionState.None || d.state == DecisionState.Committed) revert NotRevealable();
        if (d.revealed) revert AlreadyRevealed();
        if (sha256(preimage) != d.decisionHash) revert HashMismatch();
        d.revealed = true;
        emit DecisionRevealed(decisionId, preimage);
        if (d.flaggedOverdue) {
            d.flaggedOverdue = false;
            overdueCount -= 1;
            emit AuditCleared(decisionId, overdueCount);
        }
    }

    // ────────────────────────── escalations ──────────────────────────
    function approveEscalation(bytes32 decisionId) external onlyRole(APPROVER_ROLE) whenNotPaused nonReentrant {
        Decision storage d = _decisions[decisionId];
        if (d.state != DecisionState.Escalated) revert BadDecisionState(decisionId, d.state);
        Escalation storage e = _escalations[decisionId];
        if (block.timestamp > e.expiresAt) revert EscalationExpired();
        Action memory act = e.action;
        d.state = DecisionState.Approved;
        emit EscalationApproved(decisionId, msg.sender);
        if (act.kind == KIND_PAY) {
            (Payee storage p, Budget storage b) = _checkPayHard(act);
            _roll(b);
            _doPay(decisionId, act, p, b);
        } else if (act.kind == KIND_RESERVE) {
            _checkReserveHard(act);
            _moveReserve(decisionId, act, true);
        } else {
            revert UnknownKind(act.kind);
        }
    }

    function rejectEscalation(bytes32 decisionId) external onlyRole(APPROVER_ROLE) {
        Decision storage d = _decisions[decisionId];
        if (d.state != DecisionState.Escalated) revert BadDecisionState(decisionId, d.state);
        d.state = DecisionState.Rejected;
        emit EscalationRejected(decisionId, msg.sender);
    }

    // ───────────────────────────── audit ─────────────────────────────
    function flagOverdue(bytes32 decisionId) external {
        Decision storage d = _decisions[decisionId];
        if (d.state == DecisionState.None) revert UnknownDecision(decisionId);
        if (d.revealed || d.flaggedOverdue) revert NotOverdue();
        uint64 anchor = d.state == DecisionState.Committed ? d.committedBlock : d.resolvedBlock;
        if (block.number <= uint256(anchor) + revealDeadlineBlocks) revert NotOverdue();
        d.flaggedOverdue = true;
        overdueCount += 1;
        emit AuditArrears(decisionId, overdueCount);
    }

    // ─────────────────────────── internals ───────────────────────────
    function _validatePayeeData(PayeeData calldata d) internal view {
        if (!supportedToken[d.token]) revert UnsupportedToken(d.token);
        if (!_budgets[d.category][d.token].exists) revert NoBudget(d.category, d.token);
        if (d.domain == LOCAL_DOMAIN) {
            if (d.account == address(0) || d.remoteRecipient != bytes32(0)) revert InvalidPayeeData();
        } else {
            if (d.account != address(0) || d.remoteRecipient == bytes32(0) || d.token != usdc) revert InvalidPayeeData();
        }
    }

    function _roll(Budget storage b) internal {
        if (block.timestamp >= uint256(b.periodStart) + b.periodSeconds) {
            uint256 elapsed = block.timestamp - b.periodStart;
            b.periodStart = uint64(block.timestamp - (elapsed % b.periodSeconds));
            b.spentInPeriod = 0;
        }
    }

    function _freeOperating(address token) internal view returns (uint256) {
        uint256 bal = IERC20(token).balanceOf(address(this));
        uint256 r = reserved[token];
        return bal > r ? bal - r : 0;
    }

    function _checkPayHard(Action memory a) internal view returns (Payee storage p, Budget storage b) {
        if (!supportedToken[a.token]) revert UnsupportedToken(a.token);
        if (a.amount == 0) revert ZeroAmount();
        if (a.obligationId == bytes32(0)) revert ZeroValue();
        if (obligationSettled[a.obligationId]) revert AlreadySettled(a.obligationId);
        p = _payees[a.payeeId];
        if (p.status != PayeeStatus.Active) revert PayeeNotActive(a.payeeId);
        if (block.timestamp < p.activeFrom) revert PayeeCoolingDown(a.payeeId, p.activeFrom);
        if (p.data.token != a.token) revert TokenMismatch();
        b = _budgets[p.data.category][a.token];
        if (!b.exists) revert NoBudget(p.data.category, a.token);
        if (b.requiresEvidence && a.evidenceHash == bytes32(0)) revert EvidenceRequired();
        if (p.data.domain == LOCAL_DOMAIN) {
            if (a.maxFee != 0) revert FeeNotAllowed();
        } else {
            if (a.token != usdc) revert NotCrossChainToken();
            if (a.maxFee >= a.amount || a.maxFee * BPS > a.amount * maxCctpFeeBps) revert FeeTooHigh();
        }
        uint256 free = _freeOperating(a.token);
        if (free < a.amount) revert InsufficientFunds(a.token, free, a.amount);
    }

    function _softCheckPay(Action memory a, Payee storage p, Budget storage b) internal view returns (uint8) {
        if (b.perTxApprovalLimit != 0 && a.amount > b.perTxApprovalLimit) return ESC_TX_LIMIT;
        if (p.data.perTxCap != 0 && a.amount > p.data.perTxCap) return ESC_PAYEE_CAP;
        if (b.spentInPeriod + a.amount > b.limitPerPeriod) return ESC_BUDGET;
        if (_freeOperating(a.token) - a.amount < minOperating[a.token]) return ESC_LIQUIDITY_FLOOR;
        return 0;
    }

    function _checkReserveHard(Action memory a) internal view {
        if (!supportedToken[a.token]) revert UnsupportedToken(a.token);
        if (a.amount == 0) revert ZeroAmount();
        uint256 free = _freeOperating(a.token);
        if (free < a.amount) revert InsufficientFunds(a.token, free, a.amount);
    }

    function _doPay(bytes32 decisionId, Action memory a, Payee storage p, Budget storage b) internal {
        obligationSettled[a.obligationId] = true;
        b.spentInPeriod += a.amount;
        emit DecisionExecuted(decisionId, a.kind, a.obligationId, a.payeeId, a.token, a.amount, a.evidenceHash);
        if (p.data.domain == LOCAL_DOMAIN) {
            IERC20(a.token).safeTransfer(p.data.account, a.amount);
        } else {
            _payCrossChain(decisionId, a, p);
        }
    }

    function _payCrossChain(bytes32 decisionId, Action memory a, Payee storage p) internal {
        IERC20(a.token).forceApprove(address(tokenMessenger), a.amount);
        tokenMessenger.depositForBurn(
            a.amount,
            p.data.domain,
            p.data.remoteRecipient,
            a.token,
            bytes32(0),
            a.maxFee,
            cctpMinFinalityThreshold
        );
        emit CrossChainPaymentInitiated(decisionId, a.payeeId, p.data.domain, p.data.remoteRecipient, a.amount, a.maxFee);
    }

    function _moveReserve(bytes32 decisionId, Action memory a, bool intoReserve) internal {
        if (intoReserve) reserved[a.token] += a.amount;
        else reserved[a.token] -= a.amount;
        emit ReserveMoved(decisionId, a.token, intoReserve, a.amount, reserved[a.token]);
    }

    function _escalate(bytes32 decisionId, Decision storage d, Action memory a, uint8 reason) internal {
        d.state = DecisionState.Escalated;
        Escalation storage e = _escalations[decisionId];
        e.action = a;
        e.reason = reason;
        e.expiresAt = uint64(block.timestamp) + escalationTtl;
        emit DecisionEscalated(decisionId, reason, e.expiresAt);
    }

    // ───────────────────────────── views ─────────────────────────────
    function freeOperating(address token) external view returns (uint256) {
        return _freeOperating(token);
    }

    function getBudget(bytes32 category, address token) external view returns (Budget memory b, uint256 remaining) {
        b = _budgets[category][token];
        if (b.exists && block.timestamp >= uint256(b.periodStart) + b.periodSeconds) {
            uint256 elapsed = block.timestamp - b.periodStart;
            b.periodStart = uint64(block.timestamp - (elapsed % b.periodSeconds));
            b.spentInPeriod = 0;
        }
        remaining = b.limitPerPeriod > b.spentInPeriod ? b.limitPerPeriod - b.spentInPeriod : 0;
    }

    function getPayee(bytes32 payeeId) external view returns (Payee memory) {
        return _payees[payeeId];
    }

    function getPendingPayee(bytes32 payeeId) external view returns (PayeeData memory data, bool pending) {
        return (_pendingPayees[payeeId], hasPendingPayee[payeeId]);
    }

    function isPayable(bytes32 payeeId) external view returns (bool) {
        Payee storage p = _payees[payeeId];
        return p.status == PayeeStatus.Active && block.timestamp >= p.activeFrom;
    }

    function getDecision(bytes32 decisionId) external view returns (Decision memory) {
        return _decisions[decisionId];
    }

    function getEscalation(bytes32 decisionId) external view returns (Escalation memory) {
        return _escalations[decisionId];
    }

    function getReceivable(bytes32 receivableId) external view returns (Receivable memory) {
        return _receivables[receivableId];
    }

    /// Parity helpers so the backend can prove its hashing matches the contract's.
    function hashAction(Action calldata a) external pure returns (bytes32) {
        return keccak256(abi.encode(a));
    }

    function hashRecord(bytes calldata preimage) external pure returns (bytes32) {
        return sha256(preimage);
    }
}
