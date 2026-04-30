// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract MockSwapRouter {
	using SafeERC20 for IERC20;

	uint256 public numerator = 99;
	uint256 public denominator = 100;
	bool public shouldRevert;

	error ForcedRevert();

	function setRate(uint256 newNumerator, uint256 newDenominator) external {
		numerator = newNumerator;
		denominator = newDenominator;
	}

	function setShouldRevert(bool enabled) external {
		shouldRevert = enabled;
	}

	function swapExactInputSingle(
		address tokenIn,
		address tokenOut,
		uint256 amountIn,
		uint256 minAmountOut,
		address recipient
	) external returns (uint256 amountOut) {
		if (shouldRevert) {
			revert ForcedRevert();
		}

		IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
		amountOut = (amountIn * numerator) / denominator;
		require(amountOut >= minAmountOut, "INSUFFICIENT_OUTPUT");
		IERC20(tokenOut).safeTransfer(recipient, amountOut);
	}
}
