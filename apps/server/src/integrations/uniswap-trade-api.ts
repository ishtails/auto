import type { RouteBuildResult, TradeProposal } from "@auto/api/trade-types";
import { base, baseSepolia } from "viem/chains";

/** Chains we pass through to the Trading API (quote/swap must agree on chainId). */
const TRADE_API_CHAIN_IDS: ReadonlySet<number> = new Set([
	base.id,
	baseSepolia.id,
]);

const DEFAULT_API_BASE = "https://trade-api.gateway.uniswap.org/v1";
const TRAILING_SLASH_RE = /\/$/;

export interface UniswapTradeApiConfig {
	apiKey: string;
	/** Defaults to Uniswap gateway. */
	baseUrl?: string;
	/**
	 * When true, sends `x-permit2-disabled: true` so quotes use the ERC20-approve → Universal Router
	 * path (matches UserVault’s `forceApprove(swapRouter)` pattern). Full Permit2 + EIP-712 from the agent
	 * is not wired yet.
	 */
	permit2Disabled?: boolean;
	universalRouterVersion?: string;
}

export interface BuildRouteViaTradeApiInput {
	chainId: number;
	configuredRouterAddress: string;
	maxSlippageBps: number;
	proposal: TradeProposal;
	recipientVaultAddress: string;
	tradeApi: UniswapTradeApiConfig;
}

const isClassicAmmQuote = (
	quote: unknown
): quote is { input: { amount: string }; output: { amount: string } } =>
	typeof quote === "object" &&
	quote !== null &&
	"input" in quote &&
	"output" in quote &&
	typeof (quote as { input: unknown }).input === "object" &&
	(quote as { input: { amount?: unknown } }).input !== null &&
	typeof (quote as { input: { amount: unknown } }).input.amount === "string" &&
	typeof (quote as { output: { amount?: unknown } }).output === "object" &&
	(quote as { output: { amount: unknown } }).output !== null &&
	typeof (quote as { output: { amount: unknown } }).output.amount === "string";

const parseTxValue = (raw: string): bigint => {
	const t = raw.trim();
	if (t.startsWith("0x") || t.startsWith("0X")) {
		return BigInt(t);
	}
	return BigInt(t);
};

async function postJson<T>({
	url,
	body,
	headers,
}: {
	url: string;
	body: unknown;
	headers: Record<string, string>;
}): Promise<{ ok: boolean; status: number; json: T | null; text: string }> {
	const response = await fetch(url, {
		body: JSON.stringify(body),
		headers: {
			Accept: "application/json",
			"Content-Type": "application/json",
			...headers,
		},
		method: "POST",
	});
	const text = await response.text();
	let json: T | null = null;
	try {
		json = text ? (JSON.parse(text) as T) : null;
	} catch {
		json = null;
	}
	return { json, ok: response.ok, status: response.status, text };
}

/**
 * Production path: Uniswap Developer Platform Trading API → /quote → /swap.
 * Uses Universal Router calldata, prefers V4 (inclusive of hooks) then V3/V2.
 */
export async function buildRouteViaUniswapTradeApi(
	input: BuildRouteViaTradeApiInput
): Promise<RouteBuildResult> {
	if (!TRADE_API_CHAIN_IDS.has(input.chainId)) {
		throw new Error(
			`buildRouteViaUniswapTradeApi: unsupported chainId ${input.chainId} (supported: ${[...TRADE_API_CHAIN_IDS].join(", ")})`
		);
	}

	const {
		apiKey,
		baseUrl = DEFAULT_API_BASE,
		permit2Disabled = true,
		universalRouterVersion = "2.0",
	} = input.tradeApi;

	const headers: Record<string, string> = {
		"x-api-key": apiKey,
		"x-universal-router-version": universalRouterVersion,
	};
	if (permit2Disabled) {
		headers["x-permit2-disabled"] = "true";
	}

	const amountIn = BigInt(input.proposal.amountInWei);
	if (amountIn <= 0n) {
		throw new Error("amountIn must be positive");
	}

	const slippageTolerance = input.maxSlippageBps / 100;
	const deadlineUnix = Math.floor(Date.now() / 1000) + 900;

	const quoteBody = {
		amount: input.proposal.amountInWei,
		hooksOptions: "V4_HOOKS_INCLUSIVE",
		protocols: ["V4", "V3", "V2"],
		routingPreference: "BEST_PRICE",
		slippageTolerance,
		swapper: input.recipientVaultAddress,
		tokenIn: input.proposal.tokenIn,
		tokenInChainId: input.chainId,
		tokenOut: input.proposal.tokenOut,
		tokenOutChainId: input.chainId,
		type: "EXACT_INPUT",
	};

	const quoteRes = await postJson<Record<string, unknown>>({
		body: quoteBody,
		headers,
		url: `${baseUrl.replace(TRAILING_SLASH_RE, "")}/quote`,
	});

	if (!(quoteRes.ok && quoteRes.json)) {
		throw new Error(
			`Uniswap /quote failed (${quoteRes.status}): ${quoteRes.text.slice(0, 500)}`
		);
	}

	const qPayload = quoteRes.json;
	const routing = qPayload.routing;
	if (routing !== "CLASSIC") {
		throw new Error(
			`Uniswap /quote routing=${String(routing)} — only CLASSIC (on-chain Universal Router) is supported for UserVault.executeSwap`
		);
	}

	if (permit2Disabled && qPayload.permitData) {
		throw new Error(
			"Uniswap quote returned permitData while x-permit2-disabled is true — check API headers or disable Permit2 on the quote request"
		);
	}
	if (!permit2Disabled && qPayload.permitData) {
		throw new Error(
			"Permit2 signature is required for this quote; enable x-permit2-disabled for vault ERC20-approve flows or add Permit2 signing"
		);
	}

	const innerQuote = qPayload.quote;
	if (!isClassicAmmQuote(innerQuote)) {
		throw new Error("Uniswap /quote returned a non-classic quote payload");
	}

	const quoteOutWei = BigInt(innerQuote.output.amount);
	const amountOutMinimum =
		(quoteOutWei * BigInt(10_000 - input.maxSlippageBps)) / 10_000n;

	const swapRes = await postJson<{
		swap?: {
			chainId: number;
			data: string;
			from: string;
			to: string;
			value: string;
		};
	}>({
		body: {
			deadline: deadlineUnix,
			quote: innerQuote,
			simulateTransaction: false,
		},
		headers,
		url: `${baseUrl.replace(TRAILING_SLASH_RE, "")}/swap`,
	});

	if (!(swapRes.ok && swapRes.json?.swap)) {
		throw new Error(
			`Uniswap /swap failed (${swapRes.status}): ${swapRes.text.slice(0, 500)}`
		);
	}

	const swap = swapRes.json.swap;
	if (swap.chainId !== input.chainId) {
		throw new Error(
			`Uniswap /swap chainId mismatch: expected ${input.chainId}, got ${swap.chainId}`
		);
	}

	const valueWei = parseTxValue(swap.value);
	if (valueWei !== 0n) {
		throw new Error(
			`Uniswap /swap returned non-zero tx value (${valueWei}); UserVault.executeSwap only supports ERC20 → ERC20 with value 0`
		);
	}

	if (swap.from.toLowerCase() !== input.recipientVaultAddress.toLowerCase()) {
		throw new Error(
			`Uniswap /swap "from" must be the vault (swapper); got ${swap.from}, expected ${input.recipientVaultAddress}`
		);
	}

	if (swap.to.toLowerCase() !== input.configuredRouterAddress.toLowerCase()) {
		throw new Error(
			`Uniswap /swap router ${swap.to} does not match UNISWAP_ROUTER_ADDRESS ${input.configuredRouterAddress}. Deploy or reconfigure the vault’s swapRouter to the Universal Router address the API targets.`
		);
	}

	return {
		amountIn,
		amountOutMinimum,
		calldata: swap.data as `0x${string}`,
		deadline: BigInt(deadlineUnix),
		quoteOut: quoteOutWei,
		target: swap.to,
		tokenIn: input.proposal.tokenIn,
		tokenOut: input.proposal.tokenOut,
		value: valueWei,
	};
}
