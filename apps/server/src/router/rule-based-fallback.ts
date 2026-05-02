import type { IntegrationServices } from "@auto/api/context";
import type { TradeProposal } from "@auto/api/trade-types";
import { env } from "@auto/env/server";
import { getDexScreenerMarketContext } from "../integrations/dexscreener";

export async function buildRuleBasedFallbackProposal({
	cycleId,
	state,
}: {
	cycleId: string;
	state: Awaited<ReturnType<IntegrationServices["getState"]>>;
}): Promise<TradeProposal> {
	const market = await getDexScreenerMarketContext({
		chainId: env.CHAIN_ID,
		tokenIn: state.tokenIn,
		tokenOut: state.tokenOut,
	}).catch(() => null);

	// Conservative defaults: only trade when signals are strong and liquidity exists.
	const change1h = market?.priceChange1hPct ?? null;
	const ratio1h = market?.buySellRatio1h ?? null;
	const liquidityUsd = market?.liquidityUsd ?? null;
	const volume24h = market?.volume24h ?? null;

	const hasLiquidity =
		liquidityUsd !== null &&
		Number.isFinite(liquidityUsd) &&
		liquidityUsd >= 5000;
	const hasVolume =
		volume24h !== null && Number.isFinite(volume24h) && volume24h >= 5000;

	let action: TradeProposal["action"] = "HOLD";
	if (
		change1h !== null &&
		ratio1h !== null &&
		hasLiquidity &&
		hasVolume &&
		change1h >= 2 &&
		ratio1h >= 1.2
	) {
		action = "BUY";
	} else if (
		change1h !== null &&
		ratio1h !== null &&
		hasLiquidity &&
		hasVolume &&
		change1h <= -2 &&
		ratio1h <= 0.8
	) {
		action = "SELL";
	}

	const amountInWei =
		action === "HOLD" ? "0" : state.requestedAmountInWei.toString();

	const marketSummary = market
		? `DexScreener(chain=${market.chain}, priceUsd=${market.priceUsd ?? "n/a"}, change1hPct=${market.priceChange1hPct ?? "n/a"}, buySellRatio1h=${market.buySellRatio1h ?? "n/a"}, liquidityUsd=${market.liquidityUsd ?? "n/a"}, volume24h=${market.volume24h ?? "n/a"})`
		: "DexScreener unavailable";

	return {
		action,
		tokenIn: state.tokenIn,
		tokenOut: state.tokenOut,
		amountInWei,
		reasoning: [
			"Rule-based fallback activated because the LLM was unavailable.",
			"LLM not available.",
			`Signal: ${marketSummary}`,
			action === "HOLD"
				? "Decision: HOLD to protect capital until signals are strong."
				: `Decision: ${action} based on short-term momentum + volume imbalance with sufficient liquidity.`,
			`cycleId=${cycleId}`,
		].join(" "),
	};
}
