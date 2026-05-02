import type { CycleLogRecord } from "@auto/api/trade-types";

const truncateText = (value: string, maxLen: number): string =>
	value.length > maxLen ? `${value.slice(0, Math.max(0, maxLen - 1))}…` : value;

export const sanitizeCycleLogRecord = (
	record: CycleLogRecord
): CycleLogRecord => {
	const MAX_REASONING = 2000;
	const MAX_REASON = 2000;

	return {
		...record,
		proposal: {
			...record.proposal,
			reasoning: truncateText(record.proposal.reasoning, MAX_REASONING),
		},
		riskDecision: {
			...record.riskDecision,
			reason: truncateText(record.riskDecision.reason, MAX_REASON),
		},
	};
};
