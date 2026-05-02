import type { RiskDecision, TradeProposal } from "@auto/api/trade-types";

export interface RiskStateInput {
	allowedTokens: Set<string>;
	maxDrawdownBps: bigint;
	/** Lowercase address → balance wei string for vault holdings per token. */
	portfolioBalancesWei: Record<string, string>;
}

export const evaluateRisk = (
	proposal: TradeProposal,
	state: RiskStateInput
): RiskDecision => {
	if (proposal.action === "HOLD") {
		const amt = BigInt(proposal.amountInWei);
		if (amt !== 0n) {
			return {
				decision: "REJECT",
				reason: "HOLD requires amountInWei=0",
			};
		}
		return {
			decision: "APPROVE",
			reason: "HOLD — approved no-op (no on-chain execution)",
		};
	}

	const tokenIn = proposal.tokenIn.toLowerCase();
	const tokenOut = proposal.tokenOut.toLowerCase();
	if (!state.allowedTokens.has(tokenIn)) {
		return { decision: "REJECT", reason: "tokenIn not allowlisted" };
	}
	if (!state.allowedTokens.has(tokenOut)) {
		return { decision: "REJECT", reason: "tokenOut not allowlisted" };
	}

	const tokenInBalanceWei = BigInt(state.portfolioBalancesWei[tokenIn] ?? "0");

	const amountIn = BigInt(proposal.amountInWei);
	const cap = (tokenInBalanceWei * state.maxDrawdownBps) / 10_000n;

	if (amountIn <= 0n) {
		return { decision: "REJECT", reason: "amount must be positive" };
	}

	if (amountIn > tokenInBalanceWei) {
		return { decision: "REJECT", reason: "insufficient vault balance" };
	}

	if (amountIn > cap) {
		return { decision: "REJECT", reason: "exceeds max drawdown cap" };
	}

	return {
		decision: "APPROVE",
		reason: "within deterministic risk constraints",
	};
};
