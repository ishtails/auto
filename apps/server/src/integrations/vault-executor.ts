import type { RouteBuildResult } from "@auto/api/trade-types";
import { encodeFunctionData } from "viem";

const vaultAbi = [
	{
		type: "function",
		name: "executeTrade",
		stateMutability: "payable",
		inputs: [
			{
				name: "request",
				type: "tuple",
				components: [
					{ name: "target", type: "address" },
					{ name: "tokenIn", type: "address" },
					{ name: "amountIn", type: "uint256" },
					{ name: "data", type: "bytes" },
				],
			},
		],
		outputs: [],
	},
] as const;

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
	const request = {
		target: route.target as `0x${string}`,
		tokenIn: route.tokenIn as `0x${string}`,
		amountIn: route.amountIn,
		data: route.calldata,
	};

	const calldata = encodeFunctionData({
		abi: vaultAbi,
		functionName: "executeTrade",
		args: [request],
	});

	return {
		abi: JSON.stringify(vaultAbi),
		calldata,
		functionArgs: JSON.stringify([request]),
		functionName: "executeTrade",
		target: vaultAddress,
		value: route.value.toString(),
	};
};
