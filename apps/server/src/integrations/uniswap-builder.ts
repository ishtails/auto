import type { RouteBuildResult, TradeProposal } from "@auto/api/trade-types";
import { JsonRpcProvider } from "@ethersproject/providers";
import { CurrencyAmount, Percent, Token, TradeType } from "@uniswap/sdk-core";
import { AlphaRouter, SwapType } from "@uniswap/smart-order-router";

interface BuildRouteConfig {
	chainId: number;
	recipientAddress: string;
	routerAddress: string;
	rpcUrl: string;
	tokenInDecimals: number;
	tokenOutDecimals: number;
}

type RouterLike = Pick<AlphaRouter, "route">;

export class UniswapBuilder {
	private readonly router: RouterLike;
	private readonly chainId: number;
	private readonly recipientAddress: string;
	private readonly routerAddress: string;
	private readonly tokenInDecimals: number;
	private readonly tokenOutDecimals: number;

	constructor(config: BuildRouteConfig, routerOverride?: RouterLike) {
		if (routerOverride) {
			this.router = routerOverride;
		} else {
			const provider = new JsonRpcProvider(config.rpcUrl);
			this.router = new AlphaRouter({
				chainId: config.chainId,
				provider,
			});
		}
		this.chainId = config.chainId;
		this.recipientAddress = config.recipientAddress;
		this.routerAddress = config.routerAddress;
		this.tokenInDecimals = config.tokenInDecimals;
		this.tokenOutDecimals = config.tokenOutDecimals;
	}

	async buildRoute(
		proposal: TradeProposal,
		maxSlippageBps: number
	): Promise<RouteBuildResult> {
		const tokenIn = new Token(
			this.chainId,
			proposal.tokenIn,
			this.tokenInDecimals
		);
		const tokenOut = new Token(
			this.chainId,
			proposal.tokenOut,
			this.tokenOutDecimals
		);
		const amountIn = BigInt(proposal.amountInWei);
		const inAmount = CurrencyAmount.fromRawAmount(tokenIn, amountIn.toString());

		const route = await this.router.route(
			inAmount,
			tokenOut,
			TradeType.EXACT_INPUT,
			{
				recipient: this.recipientAddress,
				slippageTolerance: new Percent(maxSlippageBps, 10_000),
				deadline: Math.floor(Date.now() / 1000) + 900,
				type: SwapType.SWAP_ROUTER_02,
			}
		);

		if (!route?.methodParameters?.calldata) {
			throw new Error("No route returned by Uniswap Auto Router.");
		}

		const quoteOut = BigInt(route.quote.quotient.toString());
		const amountOutMinimum =
			(quoteOut * BigInt(10_000 - maxSlippageBps)) / 10_000n;

		const deadlineSeconds = BigInt(Math.floor(Date.now() / 1000) + 900);

		return {
			target:
				(route.methodParameters as { to?: string }).to ?? this.routerAddress,
			tokenIn: proposal.tokenIn,
			tokenOut: proposal.tokenOut,
			amountIn,
			calldata: route.methodParameters.calldata as `0x${string}`,
			value: BigInt(route.methodParameters.value ?? "0"),
			amountOutMinimum,
			quoteOut,
			deadline: deadlineSeconds,
		};
	}
}
