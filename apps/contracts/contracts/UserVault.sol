// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title UserVault — Non-custodial trading vault with post-swap protocol fees
/// @notice Deployed as EIP-1167 minimal proxy via VaultFactory. Owner controls
///         withdrawals (fee-free) and agent permissions. Authorized agent executes
///         constrained swaps with per-swap approvals and forced self-recipient.
contract UserVault is Initializable, ReentrancyGuard {
	using SafeERC20 for IERC20;

	uint256 public constant BPS_DENOMINATOR = 10_000;
	uint16 public constant MAX_FEE_BPS = 500; // 5% ceiling
	uint16 public constant MAX_TRADE_SIZE_BPS_CEILING = 10_000;

	struct SwapParams {
		address tokenIn;
		uint256 amountIn;
		address tokenOut;
		uint256 amountOutMinimum;
		bytes swapCalldata;
		uint256 deadline;
	}

	address public owner;
	address public authorizedAgent;
	address public swapRouter;
	address public protocolFeeReceiver;
	uint16 public feeBps;
	uint16 public maxTradeSizeBps;
	bool public agentPaused;

	error Unauthorized();
	error InvalidAddress();
	error InvalidBps(uint256 bps);
	error InvalidAmount();
	error InsufficientBalance(address token, uint256 needed, uint256 available);
	error AgentPaused();
	error SwapFailed(bytes reason);
	error DeadlineExpired();
	error InsufficientOutput(uint256 received, uint256 minimum);
	error FeeTooHigh(uint16 bps, uint16 max);

	event SwapExecuted(
		address indexed agent,
		address indexed tokenIn,
		address indexed tokenOut,
		uint256 amountIn,
		uint256 amountOut,
		uint256 protocolFee
	);
	event Withdrawn(address indexed owner, address indexed token, uint256 amount, address to);
	event AgentUpdated(address indexed previousAgent, address indexed newAgent);
	event AgentPausedEvent(bool paused);
	event RiskParamsUpdated(uint16 maxTradeSizeBps);
	event ProtocolFeeUpdated(uint16 feeBps);

	modifier onlyOwner() {
		if (msg.sender != owner) revert Unauthorized();
		_;
	}

	modifier onlyAgent() {
		if (msg.sender != authorizedAgent) revert Unauthorized();
		if (agentPaused) revert AgentPaused();
		_;
	}

	/// @dev Disable initializers on the implementation contract
	constructor() {
		_disableInitializers();
	}

	/// @notice Initialize a new vault clone
	/// @param _owner The user's wallet address (full control)
	/// @param _agent The server/relayer address (swap execution only)
	/// @param _swapRouter Uniswap V3 SwapRouter address
	/// @param _protocolFeeReceiver Address that receives protocol fees
	/// @param _feeBps Protocol fee in basis points (0 for V1)
	/// @param _maxTradeSizeBps Max single trade size as % of vault balance
	function initialize(
		address _owner,
		address _agent,
		address _swapRouter,
		address _protocolFeeReceiver,
		uint16 _feeBps,
		uint16 _maxTradeSizeBps
	) external initializer {
		if (_owner == address(0) || _agent == address(0) || _swapRouter == address(0)) {
			revert InvalidAddress();
		}
		if (_feeBps > MAX_FEE_BPS) {
			revert FeeTooHigh(_feeBps, MAX_FEE_BPS);
		}
		if (_maxTradeSizeBps == 0 || _maxTradeSizeBps > MAX_TRADE_SIZE_BPS_CEILING) {
			revert InvalidBps(_maxTradeSizeBps);
		}

		owner = _owner;
		authorizedAgent = _agent;
		swapRouter = _swapRouter;
		protocolFeeReceiver = _protocolFeeReceiver;
		feeBps = _feeBps;
		maxTradeSizeBps = _maxTradeSizeBps;
	}

	/// @notice Receive ETH deposits
	receive() external payable {}

	// ─── Agent Functions ─────────────────────────────────────────────

	/// @notice Execute a constrained swap. Output always stays in this vault.
	/// @param params Swap parameters packed into a struct
	function executeSwap(SwapParams calldata params) external nonReentrant onlyAgent {
		if (block.timestamp > params.deadline) {
			revert DeadlineExpired();
		}
		if (params.amountIn == 0) {
			revert InvalidAmount();
		}

		// Enforce max trade size relative to vault balance
		uint256 balance = IERC20(params.tokenIn).balanceOf(address(this));
		if (balance < params.amountIn) {
			revert InsufficientBalance(params.tokenIn, params.amountIn, balance);
		}
		uint256 maxAllowed = (balance * maxTradeSizeBps) / BPS_DENOMINATOR;
		if (params.amountIn > maxAllowed) {
			revert InsufficientBalance(params.tokenIn, params.amountIn, maxAllowed);
		}

		// Snapshot output token balance before swap
		uint256 outBalanceBefore = IERC20(params.tokenOut).balanceOf(address(this));

		// Per-swap approval: approve exact amount, execute, revoke
		IERC20(params.tokenIn).forceApprove(swapRouter, params.amountIn);

		(bool success, bytes memory returnData) = swapRouter.call(params.swapCalldata);
		if (!success) {
			// Revoke approval on failure
			IERC20(params.tokenIn).forceApprove(swapRouter, 0);
			revert SwapFailed(returnData);
		}

		// Immediately revoke allowance
		IERC20(params.tokenIn).forceApprove(swapRouter, 0);

		// Measure output received via balance delta
		uint256 received = IERC20(params.tokenOut).balanceOf(address(this)) - outBalanceBefore;
		if (received < params.amountOutMinimum) {
			revert InsufficientOutput(received, params.amountOutMinimum);
		}

		// Post-swap protocol fee on output token
		uint256 fee = _collectFee(params.tokenOut, received);

		emit SwapExecuted(
			msg.sender, params.tokenIn, params.tokenOut, params.amountIn, received - fee, fee
		);
	}

	// ─── Owner Functions ─────────────────────────────────────────────

	/// @notice Withdraw tokens. Only callable by owner. No protocol fee.
	/// @param token ERC20 token address
	/// @param amount Amount to withdraw
	/// @param to Recipient address
	function withdraw(address token, uint256 amount, address to) external nonReentrant onlyOwner {
		if (to == address(0)) revert InvalidAddress();
		if (amount == 0) revert InvalidAmount();

		uint256 balance = IERC20(token).balanceOf(address(this));
		if (balance < amount) {
			revert InsufficientBalance(token, amount, balance);
		}

		IERC20(token).safeTransfer(to, amount);
		emit Withdrawn(msg.sender, token, amount, to);
	}

	/// @notice Withdraw ETH. Only callable by owner. No protocol fee.
	/// @param amount Amount of ETH to withdraw
	/// @param to Recipient address
	function withdrawETH(uint256 amount, address to) external nonReentrant onlyOwner {
		if (to == address(0)) revert InvalidAddress();
		if (amount == 0) revert InvalidAmount();

		uint256 balance = address(this).balance;
		if (balance < amount) {
			revert InsufficientBalance(address(0), amount, balance);
		}

		(bool success, bytes memory returnData) = to.call{ value: amount }("");
		if (!success) {
			revert SwapFailed(returnData);
		}
		emit Withdrawn(msg.sender, address(0), amount, to);
	}

	/// @notice Replace the authorized agent address
	/// @param _agent New agent address
	function setAuthorizedAgent(address _agent) external onlyOwner {
		if (_agent == address(0)) revert InvalidAddress();
		address previous = authorizedAgent;
		authorizedAgent = _agent;
		emit AgentUpdated(previous, _agent);
	}

	/// @notice Pause agent execution (emergency stop)
	function pauseAgent() external onlyOwner {
		agentPaused = true;
		emit AgentPausedEvent(true);
	}

	/// @notice Unpause agent execution
	function unpauseAgent() external onlyOwner {
		agentPaused = false;
		emit AgentPausedEvent(false);
	}

	/// @notice Update risk parameters
	/// @param _maxTradeSizeBps New max trade size in basis points
	function setRiskParams(uint16 _maxTradeSizeBps) external onlyOwner {
		if (_maxTradeSizeBps == 0 || _maxTradeSizeBps > MAX_TRADE_SIZE_BPS_CEILING) {
			revert InvalidBps(_maxTradeSizeBps);
		}
		maxTradeSizeBps = _maxTradeSizeBps;
		emit RiskParamsUpdated(_maxTradeSizeBps);
	}

	// ─── Internal Functions ──────────────────────────────────────────

	/// @dev Collect protocol fee on received output. Returns fee amount.
	function _collectFee(address tokenOut, uint256 received) internal returns (uint256 fee) {
		if (feeBps > 0 && protocolFeeReceiver != address(0)) {
			fee = (received * feeBps) / BPS_DENOMINATOR;
			if (fee > 0) {
				IERC20(tokenOut).safeTransfer(protocolFeeReceiver, fee);
			}
		}
	}

	// ─── View Functions ──────────────────────────────────────────────

	/// @notice Get vault's balance of a specific token
	/// @param token ERC20 token address (address(0) for ETH)
	function getBalance(address token) external view returns (uint256) {
		if (token == address(0)) {
			return address(this).balance;
		}
		return IERC20(token).balanceOf(address(this));
	}
}
