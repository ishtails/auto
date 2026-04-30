import { describe, expect, it } from "bun:test";
import { UniswapBuilder } from "../src/integrations/uniswap-builder";

describe("UniswapBuilder", () => {
	it("returns calldata and slippage-adjusted minOut", async () => {
		const builder = new UniswapBuilder(
			{
				chainId: 8453,
				recipientAddress: "0x56823585DA2028dbf2265dca12a8109C6cc47d76",
				rpcUrl: "http://127.0.0.1:8545",
				routerAddress: "0x6fF5693b99212Da76ad316178A184AB56D299b43",
				tokenInDecimals: 18,
				tokenOutDecimals: 6,
			},
			{
				route: async () => ({
					methodParameters: {
						calldata: "0xabcdef",
						value: "0",
					},
					quote: { quotient: 1_000n },
				}),
			} as any
		);

		const result = await builder.buildRoute(
			{
				action: "BUY",
				tokenIn: "0x4200000000000000000000000000000000000006",
				tokenOut: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
				amountInWei: "100",
				reasoning: "test",
			},
			100
		);

		expect(result.calldata).toBe("0xabcdef");
		expect(result.amountOutMinimum).toBe(990n);
	});
});
