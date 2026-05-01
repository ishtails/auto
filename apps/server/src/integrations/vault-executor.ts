import type { RouteBuildResult } from "@auto/api/trade-types";
import { USER_VAULT_ABI } from "@auto/contracts/factory-definitions";
import { encodeFunctionData } from "viem";

export interface EncodedVaultCall {
	abi: string;
	calldata: `0x${string}`;
	functionArgs: string;
	functionName: string;
	target: string;
	value: string;
}

export const encodeVaultExecuteTrade = (
	vaultAddress: string,
	route: RouteBuildResult
): EncodedVaultCall => {
	if (route.value !== 0n) {
		throw new Error(
			"UserVault.executeSwap is nonpayable (route.value must be 0)"
		);
	}

	const params = {
		tokenIn: route.tokenIn as `0x${string}`,
		tokenOut: route.tokenOut as `0x${string}`,
		amountIn: route.amountIn,
		amountOutMinimum: route.amountOutMinimum,
		swapCalldata: route.calldata,
		deadline: route.deadline,
	};

	const calldata = encodeFunctionData({
		abi: USER_VAULT_ABI,
		functionName: "executeSwap",
		args: [params],
	});

	// Serialize for JSON API (convert BigInt to string)
	const paramsForJson = {
		...params,
		amountIn: params.amountIn.toString(),
		amountOutMinimum: params.amountOutMinimum.toString(),
		deadline: params.deadline.toString(),
	};

	return {
		abi: JSON.stringify(USER_VAULT_ABI),
		calldata,
		functionArgs: JSON.stringify([paramsForJson]),
		functionName: "executeSwap",
		target: vaultAddress,
		value: "0",
	};
};
