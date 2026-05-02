import type { CycleLogRecord } from "@auto/api/trade-types";
import { db } from "../db";
import { vaultCycleLogs } from "../db/schema";
import { debugLog } from "./debug";

export const cacheCycleLogToDb = async ({
	vaultId,
	record,
	logPointer,
	cycleId,
}: {
	vaultId: string;
	record: CycleLogRecord;
	logPointer: string;
	cycleId: string;
}) => {
	try {
		await db
			.insert(vaultCycleLogs)
			.values({
				vaultId,
				cycleId: record.cycleId,
				occurredAt: new Date(record.timestamp),
				decision: record.riskDecision.decision,
				txHash: record.execution?.txHash ?? null,
				logPointer,
				record,
			})
			.onConflictDoNothing();
	} catch (error) {
		debugLog(cycleId, "db cache write failed", error);
	}
};
