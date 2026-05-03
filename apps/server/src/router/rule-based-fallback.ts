import type { IntegrationServices } from "@auto/api/context";
import type { TradeProposal } from "@auto/api/trade-types";

/**
 * When the LLM is unavailable (errors, rate limits, etc.) we only record a safe
 * HOLD — no substitute rule engine that trades WETH/USDC from DexScreener heuristics.
 */
export function buildRuleBasedFallbackProposal({
	cycleId,
	state,
}: {
	cycleId: string;
	state: Awaited<ReturnType<IntegrationServices["getState"]>>;
}): TradeProposal {
	return {
		action: "HOLD",
		amountInWei: "0",
		tokenIn: state.tokenIn,
		tokenOut: state.tokenOut,
		reasoning: [
			"LLM unavailable (e.g. rate limit or upstream error); executor (live) mode falls back to HOLD only.",
			"No automated trades without a model-generated proposal.",
			`cycleId=${cycleId}`,
		].join(" "),
	};
}
