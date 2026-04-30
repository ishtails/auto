import type { RiskDecision, TradeProposal } from "@auto/api/trade-types";

export interface RiskStateInput {
	allowedTokens: Set<string>;
	maxDrawdownBps: bigint;
	vaultBalanceWei: bigint;
}

export const evaluateRisk = (
	proposal: TradeProposal,
	state: RiskStateInput
): RiskDecision => {
	const tokenIn = proposal.tokenIn.toLowerCase();
	if (!state.allowedTokens.has(tokenIn)) {
		return { decision: "REJECT", reason: "tokenIn not allowlisted" };
	}

	const amountIn = BigInt(proposal.amountInWei);
	const cap = (state.vaultBalanceWei * state.maxDrawdownBps) / 10_000n;

	if (amountIn <= 0n) {
		return { decision: "REJECT", reason: "amount must be positive" };
	}

	if (amountIn > state.vaultBalanceWei) {
		return { decision: "REJECT", reason: "insufficient vault balance" };
	}

	if (amountIn > cap) {
		return { decision: "REJECT", reason: "exceeds max drawdown cap" };
	}

	if (proposal.action === "HOLD") {
		return { decision: "REJECT", reason: "proposal action is HOLD" };
	}

	return {
		decision: "APPROVE",
		reason: "within deterministic risk constraints",
	};
};
