import type {
	LlmTradingMemoryEntry,
	RiskDecision,
	TradeProposal,
} from "@auto/api/trade-types";
import {
	pingOgComputeVerifierRouter,
	runOgComputeVerifierStage,
} from "./og-compute-verifier";

/** Thin wrapper — pass **tradingMemory** so the verifier matches Gemini’s context. */
export function verifyProposalWithOgComputeRouter(
	proposal: TradeProposal,
	deterministicRisk: RiskDecision,
	options?: { cycleId?: string; tradingMemory?: LlmTradingMemoryEntry[] }
): Promise<RiskDecision> {
	return runOgComputeVerifierStage({
		cycleId: options?.cycleId,
		deterministicRisk,
		proposal,
		tradingMemory: options?.tradingMemory ?? [],
	});
}

export function pingOgComputeRouter(): Promise<boolean> {
	return pingOgComputeVerifierRouter();
}
