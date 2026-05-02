import type { RouteBuildResult, TradeProposal } from "@auto/api/trade-types";
import { CurrencyAmount, Token } from "@uniswap/sdk-core";
import { Pool } from "@uniswap/v3-sdk";
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

const V3_POOL_ABI = [
	{
		inputs: [],
		name: "liquidity",
		outputs: [{ name: "", type: "uint128" }],
		stateMutability: "view",
		type: "function",
	},
	{
		inputs: [],
		name: "slot0",
		outputs: [
			{ name: "sqrtPriceX96", type: "uint160" },
			{ name: "tick", type: "int24" },
			{ name: "observationIndex", type: "uint16" },
			{ name: "observationCardinality", type: "uint16" },
			{ name: "observationCardinalityNext", type: "uint16" },
			{ name: "feeProtocol", type: "uint8" },
			{ name: "unlocked", type: "bool" },
		],
		stateMutability: "view",
		type: "function",
	},
] as const;

const SWAP_ROUTER_ABI = [
	{
		inputs: [
			{
				components: [
					{ name: "tokenIn", type: "address" },
					{ name: "tokenOut", type: "address" },
					{ name: "fee", type: "uint24" },
					{ name: "recipient", type: "address" },
					{ name: "deadline", type: "uint256" },
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
					{ name: "deadline", type: "uint256" },
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

async function loadV3Pool(
	publicClient: SepoliaPublicClient,
	poolAddress: Address,
	tokenA: Token,
	tokenB: Token,
	fee: number
): Promise<Pool> {
	const slot0 = await publicClient.readContract({
		abi: V3_POOL_ABI,
		address: poolAddress,
		functionName: "slot0",
	});
	const liquidity = await publicClient.readContract({
		abi: V3_POOL_ABI,
		address: poolAddress,
		functionName: "liquidity",
	});

	const tick = slot0[1];
	return new Pool(
		tokenA,
		tokenB,
		fee,
		slot0[0].toString(),
		liquidity.toString(),
		typeof tick === "bigint" ? Number(tick) : tick
	);
}

/** v3-sdk typings may expose sync or async getOutputAmount depending on version. */
const resolvePoolOutput = (
	pool: Pool,
	input: CurrencyAmount<Token>
): Promise<[CurrencyAmount<Token>, Pool]> =>
	Promise.resolve(pool.getOutputAmount(input)) as Promise<
		[CurrencyAmount<Token>, Pool]
	>;

const wrapQuoteError = (label: string, cause: unknown): never => {
	const message = cause instanceof Error ? cause.message : String(cause);
	throw new Error(`V3 pool quote failed (${label}): ${message}`);
};

async function quoteSingleHop(
	publicClient: SepoliaPublicClient,
	poolAddress: Address,
	fee: number,
	tokenInSdk: Token,
	tokenOutSdk: Token,
	amountIn: bigint
): Promise<CurrencyAmount<Token>> {
	const pool = await loadV3Pool(
		publicClient,
		poolAddress,
		tokenInSdk,
		tokenOutSdk,
		fee
	);
	try {
		const [out] = await resolvePoolOutput(
			pool,
			CurrencyAmount.fromRawAmount(tokenInSdk, amountIn.toString())
		);
		return out;
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
	const pool1 = await loadV3Pool(
		publicClient,
		route.firstPool,
		tokenInSdk,
		wethSdk,
		route.firstFee
	);
	let wethMid: CurrencyAmount<Token>;
	try {
		const mid = await resolvePoolOutput(
			pool1,
			CurrencyAmount.fromRawAmount(tokenInSdk, amountIn.toString())
		);
		wethMid = mid[0];
	} catch (cause) {
		return wrapQuoteError("first hop", cause);
	}

	const pool2 = await loadV3Pool(
		publicClient,
		route.secondPool,
		wethSdk,
		tokenOutSdk,
		route.secondFee
	);
	try {
		const [out] = await resolvePoolOutput(pool2, wethMid);
		return out;
	} catch (cause) {
		return wrapQuoteError("second hop", cause);
	}
}

function encodeSwapRouterCalldata(params: {
	amountIn: bigint;
	amountOutMinimum: bigint;
	deadlineSeconds: bigint;
	proposal: TradeProposal;
	recipient: Address;
	route: ConfiguredSepoliaV3Route;
}): `0x${string}` {
	const {
		amountIn,
		amountOutMinimum,
		deadlineSeconds,
		proposal,
		recipient,
		route,
	} = params;
	if (route.kind === "single") {
		return encodeFunctionData({
			abi: SWAP_ROUTER_ABI,
			args: [
				{
					amountIn,
					amountOutMinimum,
					deadline: deadlineSeconds,
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
		abi: SWAP_ROUTER_ABI,
		args: [
			{
				amountIn,
				amountOutMinimum,
				deadline: deadlineSeconds,
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
						route.poolAddress,
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

		const calldata = encodeSwapRouterCalldata({
			amountIn,
			amountOutMinimum,
			deadlineSeconds,
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
