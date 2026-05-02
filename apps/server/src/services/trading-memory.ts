import type {
	CycleLogRecord,
	LlmTradingMemoryEntry,
	TradingMemoryExecutionOutcome,
} from "@auto/api/trade-types";

const inferSkipReason = (
	record: CycleLogRecord,
	outcome: TradingMemoryExecutionOutcome
): string | undefined => {
	if (outcome !== "skipped") {
		return;
	}
	const action = record.proposal.action;
	if (action === "HOLD") {
		return "hold_proposal";
	}
	if (record.riskDecision.decision === "REJECT") {
		return "risk_rejected";
	}
	const mode = record.mode;
	if (mode === "suggest") {
		return "suggest_mode_no_chain_execution";
	}
	if (mode === "dryRun") {
		return "dry_run_no_chain_execution";
	}
	if (record.input?.dryRun) {
		return "dry_run_flag";
	}
	if (record.riskDecision.decision === "APPROVE") {
		return "no_execution_recorded";
	}
	return;
};

const resolveMode = (record: CycleLogRecord): LlmTradingMemoryEntry["mode"] => {
	const m = record.mode;
	if (m === "suggest" || m === "dryRun" || m === "live") {
		return m;
	}
	return "unknown";
};

const resolveExecutionOutcome = (
	record: CycleLogRecord
): TradingMemoryExecutionOutcome => {
	const exec = record.execution;
	if (exec?.status === "failed") {
		return "failed";
	}
	if (exec?.status === "completed" && exec.txHash) {
		return "completed";
	}
	return "skipped";
};

/**
 * Maps a persisted cycle log into LLM memory. Works with older rows that omit `mode`.
 */
export const cycleLogRecordToLlmTradingMemory = (
	record: CycleLogRecord
): LlmTradingMemoryEntry => {
	const executionOutcome = resolveExecutionOutcome(record);
	const mode = resolveMode(record);
	const riskDecision = record.riskDecision.decision;
	const skipReason = inferSkipReason(record, executionOutcome);
	const exec = record.execution;
	const route = record.route;

	return {
		timestamp: record.timestamp,
		mode,
		riskDecision,
		executionOutcome,
		executionKeeperStatus: exec?.status,
		txHashPresent: Boolean(exec?.txHash),
		proposalAction: record.proposal.action,
		proposalTokenIn: record.proposal.tokenIn,
		proposalTokenOut: record.proposal.tokenOut,
		proposalAmountInWei: record.proposal.amountInWei,
		routeTokenIn: route?.tokenIn,
		routeTokenOut: route?.tokenOut,
		routeAmountIn: route?.amountIn,
		reasoning: record.proposal.reasoning,
		skipReason,
	};
};

/** Best-effort parse for JSONB rows that may predate newer fields. */
export const rawCycleLogToLlmTradingMemory = (
	raw: unknown
): LlmTradingMemoryEntry | null => {
	if (!raw || typeof raw !== "object") {
		return null;
	}
	const r = raw as Partial<CycleLogRecord>;
	if (
		!r.proposal ||
		typeof r.proposal !== "object" ||
		!r.riskDecision ||
		typeof r.riskDecision !== "object"
	) {
		return null;
	}
	const decision = r.riskDecision.decision;
	if (decision !== "APPROVE" && decision !== "REJECT") {
		return null;
	}

	const record: CycleLogRecord = {
		cycleId: typeof r.cycleId === "string" ? r.cycleId : "",
		execution: r.execution ?? null,
		input:
			r.input && typeof r.input === "object"
				? r.input
				: { vaultId: "00000000-0000-4000-8000-000000000000", dryRun: false },
		mode: r.mode,
		proposal: r.proposal,
		riskDecision: r.riskDecision,
		route: r.route ?? null,
		timestamp:
			typeof r.timestamp === "string" ? r.timestamp : new Date(0).toISOString(),
	};

	return cycleLogRecordToLlmTradingMemory(record);
};
