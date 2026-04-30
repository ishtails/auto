// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";

contract Vault is AccessControl, ReentrancyGuard, Pausable {
	using SafeERC20 for IERC20;

	bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");
	uint256 public constant BPS_DENOMINATOR = 10_000;
	address public constant ETH_SENTINEL = address(0);

	struct TradeRequest {
		address target;
		address tokenIn;
		uint256 amountIn;
		bytes data;
	}

	uint256 public maxTradeSizeBps;
	mapping(address token => bool allowed) public tokenAllowed;
	mapping(address router => bool allowed) public routerAllowed;

	address[] private _allowedTokenList;
	address[] private _allowedRouterList;
	mapping(address token => bool tracked) private _isTokenTracked;
	mapping(address router => bool tracked) private _isRouterTracked;

	error UnauthorizedExecutor(address caller);
	error TokenNotAllowed(address token);
	error RouterNotAllowed(address router);
	error TradeTooLarge(uint256 amountIn, uint256 maxAllowed);
	error InsufficientBalance(address token, uint256 needed, uint256 available);
	error ExternalCallFailed(bytes reason);
	error InvalidAddress();
	error InvalidBps(uint256 bps);
	error InvalidAmount();
	error InvalidEthValue(uint256 expected, uint256 actual);

	event DepositETH(address indexed from, uint256 amount);
	event DepositToken(address indexed from, address indexed token, uint256 amount);
	event WithdrawETH(address indexed to, uint256 amount);
	event WithdrawToken(address indexed to, address indexed token, uint256 amount);
	event TradeExecuted(
		address indexed executor,
		address indexed target,
		address indexed tokenIn,
		uint256 amountIn,
		uint256 value,
		bytes data
	);
	event ExecutorUpdated(address indexed executor, bool allowed);
	event TokenAllowlistUpdated(address indexed token, bool allowed);
	event RouterAllowlistUpdated(address indexed router, bool allowed);
	event RiskParamsUpdated(uint256 maxTradeSizeBps);

	constructor(address admin, address executor, uint256 initialMaxTradeSizeBps) {
		if (admin == address(0) || executor == address(0)) {
			revert InvalidAddress();
		}
		_validateBps(initialMaxTradeSizeBps);

		_grantRole(DEFAULT_ADMIN_ROLE, admin);
		_grantRole(EXECUTOR_ROLE, executor);
		maxTradeSizeBps = initialMaxTradeSizeBps;

		emit ExecutorUpdated(executor, true);
		emit RiskParamsUpdated(initialMaxTradeSizeBps);
	}

	receive() external payable {
		emit DepositETH(msg.sender, msg.value);
	}

	function depositETH() external payable whenNotPaused {
		if (msg.value == 0) {
			revert InvalidAmount();
		}
		emit DepositETH(msg.sender, msg.value);
	}

	function depositToken(
		address token,
		uint256 amount
	) external nonReentrant whenNotPaused {
		if (!tokenAllowed[token]) {
			revert TokenNotAllowed(token);
		}
		if (amount == 0) {
			revert InvalidAmount();
		}

		IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
		emit DepositToken(msg.sender, token, amount);
	}

	function withdrawETH(
		uint256 amount,
		address to
	) external nonReentrant onlyRole(DEFAULT_ADMIN_ROLE) whenNotPaused {
		if (to == address(0)) {
			revert InvalidAddress();
		}
		if (amount == 0) {
			revert InvalidAmount();
		}

		uint256 balance = address(this).balance;
		if (balance < amount) {
			revert InsufficientBalance(ETH_SENTINEL, amount, balance);
		}

		(bool success, bytes memory returnData) = to.call{ value: amount }("");
		if (!success) {
			revert ExternalCallFailed(returnData);
		}

		emit WithdrawETH(to, amount);
	}

	function withdrawToken(
		address token,
		uint256 amount,
		address to
	) external nonReentrant onlyRole(DEFAULT_ADMIN_ROLE) whenNotPaused {
		if (to == address(0)) {
			revert InvalidAddress();
		}
		if (amount == 0) {
			revert InvalidAmount();
		}

		uint256 balance = IERC20(token).balanceOf(address(this));
		if (balance < amount) {
			revert InsufficientBalance(token, amount, balance);
		}

		IERC20(token).safeTransfer(to, amount);
		emit WithdrawToken(to, token, amount);
	}

	function getVaultBalance(address token) external view returns (uint256) {
		if (token == ETH_SENTINEL) {
			return address(this).balance;
		}
		return IERC20(token).balanceOf(address(this));
	}

	function executeTrade(
		TradeRequest calldata request
	) external payable nonReentrant whenNotPaused {
		if (!hasRole(EXECUTOR_ROLE, msg.sender)) {
			revert UnauthorizedExecutor(msg.sender);
		}
		if (!routerAllowed[request.target]) {
			revert RouterNotAllowed(request.target);
		}
		if (!tokenAllowed[request.tokenIn]) {
			revert TokenNotAllowed(request.tokenIn);
		}

		uint256 balance = _balanceOfToken(request.tokenIn);
		if (balance < request.amountIn) {
			revert InsufficientBalance(request.tokenIn, request.amountIn, balance);
		}

		uint256 maxAllowed = (balance * maxTradeSizeBps) / BPS_DENOMINATOR;
		if (request.amountIn > maxAllowed) {
			revert TradeTooLarge(request.amountIn, maxAllowed);
		}

		if (request.tokenIn != ETH_SENTINEL && msg.value != 0) {
			revert InvalidEthValue(0, msg.value);
		}
		if (request.tokenIn == ETH_SENTINEL && msg.value != request.amountIn) {
			revert InvalidEthValue(request.amountIn, msg.value);
		}

		(bool success, bytes memory returnData) = request.target.call{ value: msg.value }(
			request.data
		);
		if (!success) {
			revert ExternalCallFailed(returnData);
		}

		emit TradeExecuted(
			msg.sender,
			request.target,
			request.tokenIn,
			request.amountIn,
			msg.value,
			request.data
		);
	}

	function setExecutor(
		address executor,
		bool allowed
	) external onlyRole(DEFAULT_ADMIN_ROLE) {
		if (executor == address(0)) {
			revert InvalidAddress();
		}

		if (allowed) {
			_grantRole(EXECUTOR_ROLE, executor);
		} else {
			_revokeRole(EXECUTOR_ROLE, executor);
		}

		emit ExecutorUpdated(executor, allowed);
	}

	function setTokenAllowed(
		address token,
		bool allowed
	) external onlyRole(DEFAULT_ADMIN_ROLE) {
		tokenAllowed[token] = allowed;
		if (!_isTokenTracked[token]) {
			_allowedTokenList.push(token);
			_isTokenTracked[token] = true;
		}

		for (uint256 i = 0; i < _allowedRouterList.length; i++) {
			address router = _allowedRouterList[i];
			_syncTokenApproval(token, router);
		}

		emit TokenAllowlistUpdated(token, allowed);
	}

	function setRouterAllowed(
		address router,
		bool allowed
	) external onlyRole(DEFAULT_ADMIN_ROLE) {
		if (router == address(0)) {
			revert InvalidAddress();
		}

		routerAllowed[router] = allowed;
		if (!_isRouterTracked[router]) {
			_allowedRouterList.push(router);
			_isRouterTracked[router] = true;
		}

		for (uint256 i = 0; i < _allowedTokenList.length; i++) {
			address token = _allowedTokenList[i];
			_syncTokenApproval(token, router);
		}

		emit RouterAllowlistUpdated(router, allowed);
	}

	function setRiskParams(
		uint256 newMaxTradeSizeBps
	) external onlyRole(DEFAULT_ADMIN_ROLE) {
		_validateBps(newMaxTradeSizeBps);
		maxTradeSizeBps = newMaxTradeSizeBps;
		emit RiskParamsUpdated(newMaxTradeSizeBps);
	}

	function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
		_pause();
	}

	function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
		_unpause();
	}

	function _syncTokenApproval(address token, address router) internal {
		if (token == ETH_SENTINEL) {
			return;
		}

		bool shouldApprove = tokenAllowed[token] && routerAllowed[router];
		uint256 allowanceAmount = shouldApprove ? type(uint256).max : 0;
		IERC20(token).forceApprove(router, allowanceAmount);
	}

	function _balanceOfToken(address token) internal view returns (uint256) {
		if (token == ETH_SENTINEL) {
			return address(this).balance;
		}
		return IERC20(token).balanceOf(address(this));
	}

	function _validateBps(uint256 bps) internal pure {
		if (bps == 0 || bps > BPS_DENOMINATOR) {
			revert InvalidBps(bps);
		}
	}
}
