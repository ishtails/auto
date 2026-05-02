import type { RouteBuildResult, TradeProposal } from "@auto/api/trade-types";
import { CurrencyAmount, Token } from "@uniswap/sdk-core";
import {
	type Address,
	createPublicClient,
	encodeFunctionData,
	http,
} from "viem";
import { base, baseSepolia } from "viem/chains";
import {
	type ConfiguredSepoliaV3Route,
	getConfiguredSepoliaV3Route,
	getDecimalsForTokenAddress,
	TOKENS,
} from "../config";
import {
	buildRouteViaUniswapTradeApi,
	type UniswapTradeApiConfig,
} from "./uniswap-trade-api";

/** Base Sepolia — Uniswap v3 QuoterV2 (Base docs ecosystem contracts). */
const QUOTER_V2_BASE_SEPOLIA: Address =
	"0xC5290058841028F1614F3A6F0F5816cAd0df5E27";

const QUOTER_V2_ABI = [
	{
		inputs: [
			{
				components: [
					{ name: "tokenIn", type: "address" },
					{ name: "tokenOut", type: "address" },
					{ name: "amountIn", type: "uint256" },
					{ name: "fee", type: "uint24" },
					{ name: "sqrtPriceLimitX96", type: "uint160" },
				],
				name: "params",
				type: "tuple",
			},
		],
		name: "quoteExactInputSingle",
		outputs: [
			{ name: "amountOut", type: "uint256" },
			{ name: "sqrtPriceX96After", type: "uint160" },
			{ name: "initializedTicksCrossed", type: "uint32" },
			{ name: "gasEstimate", type: "uint256" },
		],
		stateMutability: "nonpayable",
		type: "function",
	},
] as const;

/**
 * SwapRouter02 implements `IV3SwapRouter` — not the legacy v3-periphery `SwapRouter`.
 * Per https://github.com/Uniswap/swap-router-contracts/blob/main/contracts/interfaces/IV3SwapRouter.sol
 * `exactInputSingle` / `exactInput` tuples have **no** `deadline` (deadline was removed in this router).
 */
const SWAP_ROUTER02_ABI = [
	{
		inputs: [
			{
				components: [
					{ name: "tokenIn", type: "address" },
					{ name: "tokenOut", type: "address" },
					{ name: "fee", type: "uint24" },
					{ name: "recipient", type: "address" },
					{ name: "amountIn", type: "uint256" },
					{ name: "amountOutMinimum", type: "uint256" },
					{ name: "sqrtPriceLimitX96", type: "uint160" },
				],
				name: "params",
				type: "tuple",
			},
		],
		name: "exactInputSingle",
		outputs: [{ name: "amountOut", type: "uint256" }],
		stateMutability: "payable",
		type: "function",
	},
	{
		inputs: [
			{
				components: [
					{ name: "path", type: "bytes" },
					{ name: "recipient", type: "address" },
					{ name: "amountIn", type: "uint256" },
					{ name: "amountOutMinimum", type: "uint256" },
				],
				name: "params",
				type: "tuple",
			},
		],
		name: "exactInput",
		outputs: [{ name: "amountOut", type: "uint256" }],
		stateMutability: "payable",
		type: "function",
	},
] as const;

interface BuildRouteConfig {
	chainId: number;
	recipientAddress: string;
	routerAddress: string;
	rpcUrl: string;
	/** When set with Base mainnet, routes via Uniswap Trading API (Universal Router, v2/v3/v4). */
	tradeApi?: UniswapTradeApiConfig;
}

const isDebugEnabled = (): boolean => process.env.DEBUG === "true";

const toSdkToken = (
	chainId: number,
	address: string,
	decimals: number
): Token => new Token(chainId, address, decimals);

const makeSepoliaPublicClient = (rpcUrl: string) =>
	createPublicClient({
		chain: baseSepolia,
		transport: http(rpcUrl),
	});

type SepoliaPublicClient = ReturnType<typeof makeSepoliaPublicClient>;

const encodeV3Path = (tokenPath: Address[], fees: number[]): `0x${string}` => {
	if (tokenPath.length !== fees.length + 1) {
		throw new Error("encodeV3Path: need fees.length === tokens.length - 1");
	}
	let hex = "";
	for (let i = 0; i < fees.length; i++) {
		const segmentIn = tokenPath[i];
		const feeTier = fees[i];
		if (!(segmentIn && feeTier !== undefined)) {
			throw new Error("encodeV3Path: missing token segment or fee");
		}
		hex += segmentIn.slice(2).toLowerCase();
		hex += feeTier.toString(16).padStart(6, "0");
	}
	const last = tokenPath.at(-1);
	if (!last) {
		throw new Error("encodeV3Path: missing terminal token");
	}
	hex += last.slice(2).toLowerCase();
	return `0x${hex}`;
};

const wrapQuoteError = (label: string, cause: unknown): never => {
	const message = cause instanceof Error ? cause.message : String(cause);
	throw new Error(`V3 quote failed (${label}): ${message}`);
};

async function quoteExactInputSingleQuoter(
	publicClient: SepoliaPublicClient,
	tokenIn: Address,
	tokenOut: Address,
	fee: number,
	amountIn: bigint
): Promise<bigint> {
	const result = await publicClient.readContract({
		abi: QUOTER_V2_ABI,
		address: QUOTER_V2_BASE_SEPOLIA,
		args: [
			{
				amountIn,
				fee,
				sqrtPriceLimitX96: 0n,
				tokenIn,
				tokenOut,
			},
		],
		functionName: "quoteExactInputSingle",
	});
	return result[0];
}

async function quoteSingleHop(
	publicClient: SepoliaPublicClient,
	fee: number,
	tokenInSdk: Token,
	tokenOutSdk: Token,
	amountIn: bigint
): Promise<CurrencyAmount<Token>> {
	try {
		const amountOut = await quoteExactInputSingleQuoter(
			publicClient,
			tokenInSdk.address as Address,
			tokenOutSdk.address as Address,
			fee,
			amountIn
		);
		return CurrencyAmount.fromRawAmount(tokenOutSdk, amountOut.toString());
	} catch (cause) {
		return wrapQuoteError("single-hop", cause);
	}
}

async function quoteTwoHopViaWeth(
	publicClient: SepoliaPublicClient,
	route: Extract<ConfiguredSepoliaV3Route, { kind: "double" }>,
	tokenInSdk: Token,
	wethSdk: Token,
	tokenOutSdk: Token,
	amountIn: bigint
): Promise<CurrencyAmount<Token>> {
	let wethMidWei: bigint;
	try {
		wethMidWei = await quoteExactInputSingleQuoter(
			publicClient,
			tokenInSdk.address as Address,
			wethSdk.address as Address,
			route.firstFee,
			amountIn
		);
	} catch (cause) {
		return wrapQuoteError("first hop", cause);
	}

	let outWei: bigint;
	try {
		outWei = await quoteExactInputSingleQuoter(
			publicClient,
			wethSdk.address as Address,
			tokenOutSdk.address as Address,
			route.secondFee,
			wethMidWei
		);
	} catch (cause) {
		return wrapQuoteError("second hop", cause);
	}

	return CurrencyAmount.fromRawAmount(tokenOutSdk, outWei.toString());
}

function encodeSwapRouter02Calldata(params: {
	amountIn: bigint;
	amountOutMinimum: bigint;
	proposal: TradeProposal;
	recipient: Address;
	route: ConfiguredSepoliaV3Route;
}): `0x${string}` {
	const { amountIn, amountOutMinimum, proposal, recipient, route } = params;
	if (route.kind === "single") {
		return encodeFunctionData({
			abi: SWAP_ROUTER02_ABI,
			args: [
				{
					amountIn,
					amountOutMinimum,
					fee: route.fee,
					recipient,
					sqrtPriceLimitX96: 0n,
					tokenIn: proposal.tokenIn as Address,
					tokenOut: proposal.tokenOut as Address,
				},
			],
			functionName: "exactInputSingle",
		});
	}

	const path = encodeV3Path(
		[
			proposal.tokenIn as Address,
			TOKENS.WETH.address as Address,
			proposal.tokenOut as Address,
		],
		[route.firstFee, route.secondFee]
	);
	return encodeFunctionData({
		abi: SWAP_ROUTER02_ABI,
		args: [
			{
				amountIn,
				amountOutMinimum,
				path,
				recipient,
			},
		],
		functionName: "exactInput",
	});
}

export class UniswapBuilder {
	private readonly chainId: number;
	private readonly recipientAddress: Address;
	private readonly routerAddress: Address;
	private readonly rpcUrl: string;
	private readonly tradeApi?: UniswapTradeApiConfig;

	constructor(config: BuildRouteConfig) {
		this.chainId = config.chainId;
		this.recipientAddress = config.recipientAddress as Address;
		this.routerAddress = config.routerAddress as Address;
		this.rpcUrl = config.rpcUrl;
		this.tradeApi = config.tradeApi;
	}

	async buildRoute(
		proposal: TradeProposal,
		maxSlippageBps: number,
		decimalsOverride?: { tokenInDecimals: number; tokenOutDecimals: number }
	): Promise<RouteBuildResult> {
		const amountIn = BigInt(proposal.amountInWei);
		if (amountIn <= 0n) {
			throw new Error("amountIn must be positive");
		}

		if (this.chainId === base.id) {
			if (!this.tradeApi?.apiKey) {
				throw new Error(
					`Base mainnet (${base.id}) requires UNISWAP_TRADE_API_KEY (Uniswap Developer Platform) and UNISWAP_ROUTER_ADDRESS set to the Universal Router used by the API`
				);
			}
			// No local pool fallback on mainnet: TOKENS execution addresses are Sepolia; API is the supported path.
			return await buildRouteViaUniswapTradeApi({
				chainId: this.chainId,
				configuredRouterAddress: this.routerAddress,
				maxSlippageBps,
				proposal,
				recipientVaultAddress: this.recipientAddress,
				tradeApi: this.tradeApi,
			});
		}

		if (this.chainId === baseSepolia.id) {
			if (this.tradeApi?.apiKey) {
				try {
					return await buildRouteViaUniswapTradeApi({
						chainId: this.chainId,
						configuredRouterAddress: this.routerAddress,
						maxSlippageBps,
						proposal,
						recipientVaultAddress: this.recipientAddress,
						tradeApi: this.tradeApi,
					});
				} catch (apiError) {
					const detail =
						apiError instanceof Error ? apiError.message : String(apiError);
					if (isDebugEnabled()) {
						console.warn(
							"[UniswapBuilder] Trading API failed; using configured Sepolia pools (exactInput*):",
							detail
						);
					}
					return await this.buildRouteSepoliaConfiguredV3(
						proposal,
						maxSlippageBps,
						decimalsOverride
					);
				}
			}
			return await this.buildRouteSepoliaConfiguredV3(
				proposal,
				maxSlippageBps,
				decimalsOverride
			);
		}

		throw new Error(
			`UniswapBuilder: unsupported chainId ${this.chainId}. Use Base mainnet (${base.id}) with UNISWAP_TRADE_API_KEY, or Base Sepolia (${baseSepolia.id}) with TOKENS pool config.`
		);
	}

	private async buildRouteSepoliaConfiguredV3(
		proposal: TradeProposal,
		maxSlippageBps: number,
		decimalsOverride?: { tokenInDecimals: number; tokenOutDecimals: number }
	): Promise<RouteBuildResult> {
		const tokenInDecimals =
			decimalsOverride?.tokenInDecimals ??
			getDecimalsForTokenAddress(proposal.tokenIn);
		const tokenOutDecimals =
			decimalsOverride?.tokenOutDecimals ??
			getDecimalsForTokenAddress(proposal.tokenOut);

		const amountIn = BigInt(proposal.amountInWei);
		const route = getConfiguredSepoliaV3Route(
			proposal.tokenIn,
			proposal.tokenOut
		);

		const publicClient = makeSepoliaPublicClient(this.rpcUrl);

		const tokenInSdk = toSdkToken(
			this.chainId,
			proposal.tokenIn,
			tokenInDecimals
		);
		const tokenOutSdk = toSdkToken(
			this.chainId,
			proposal.tokenOut,
			tokenOutDecimals
		);
		const wethSdk = toSdkToken(
			this.chainId,
			TOKENS.WETH.address,
			TOKENS.WETH.decimals
		);

		const deadlineSeconds = BigInt(Math.floor(Date.now() / 1000) + 900);

		const quoteOut =
			route.kind === "single"
				? await quoteSingleHop(
						publicClient,
						route.fee,
						tokenInSdk,
						tokenOutSdk,
						amountIn
					)
				: await quoteTwoHopViaWeth(
						publicClient,
						route,
						tokenInSdk,
						wethSdk,
						tokenOutSdk,
						amountIn
					);

		const quoteOutWei = BigInt(quoteOut.quotient.toString());
		const amountOutMinimum =
			(quoteOutWei * BigInt(10_000 - maxSlippageBps)) / 10_000n;

		const calldata = encodeSwapRouter02Calldata({
			amountIn,
			amountOutMinimum,
			proposal,
			recipient: this.recipientAddress,
			route,
		});

		return {
			amountIn,
			amountOutMinimum,
			calldata,
			deadline: deadlineSeconds,
			quoteOut: quoteOutWei,
			target: this.routerAddress,
			tokenIn: proposal.tokenIn,
			tokenOut: proposal.tokenOut,
			value: 0n,
		};
	}
}
