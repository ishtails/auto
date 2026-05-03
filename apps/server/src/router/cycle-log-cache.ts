import type { CycleLogRecord } from "@auto/api/trade-types";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { vaultCycleLogs } from "../db/schema";
import { debugLog } from "./debug";

/** Idempotent merge of `ogStorage` on an existing cycle row (matched by vault + cycle id). */
export const patchVaultCycleLogOgStorage = async ({
	vaultId,
	cycleId,
	ogStorage,
}: {
	vaultId: string;
	cycleId: string;
	ogStorage: NonNullable<CycleLogRecord["ogStorage"]>;
}): Promise<boolean> => {
	try {
		const row = await db.query.vaultCycleLogs.findFirst({
			where: and(
				eq(vaultCycleLogs.vaultId, vaultId),
				eq(vaultCycleLogs.cycleId, cycleId)
			),
		});
		if (!row) {
			debugLog(cycleId, "og patch skipped: row missing", { vaultId });
			return false;
		}

		const prev = row.record as CycleLogRecord;
		const hasProof =
			Boolean(ogStorage.txHash?.trim()) || Boolean(ogStorage.rootHash?.trim());

		const nextOg: NonNullable<CycleLogRecord["ogStorage"]> = {
			...prev.ogStorage,
			...ogStorage,
			pointer:
				ogStorage.pointer || prev.ogStorage?.pointer || row.logPointer || "",
		};
		if (hasProof) {
			nextOg.pending = undefined;
			nextOg.lastError = undefined;
		} else if (ogStorage.pending === false) {
			nextOg.lastError = undefined;
		}

		const nextRecord: CycleLogRecord = {
			...prev,
			ogStorage: nextOg,
		};

		await db
			.update(vaultCycleLogs)
			.set({
				record: nextRecord,
				logPointer: nextOg.pointer || row.logPointer,
			})
			.where(
				and(
					eq(vaultCycleLogs.vaultId, vaultId),
					eq(vaultCycleLogs.cycleId, cycleId)
				)
			);

		return true;
	} catch (error) {
		debugLog(cycleId, "og patch failed", error);
		return false;
	}
};

export const patchVaultCycleLogOgFailure = async ({
	vaultId,
	cycleId,
	message,
}: {
	vaultId: string;
	cycleId: string;
	message: string;
}): Promise<boolean> => {
	try {
		const row = await db.query.vaultCycleLogs.findFirst({
			where: and(
				eq(vaultCycleLogs.vaultId, vaultId),
				eq(vaultCycleLogs.cycleId, cycleId)
			),
		});
		if (!row) {
			debugLog(cycleId, "og failure patch skipped: row missing", { vaultId });
			return false;
		}

		const prev = row.record as CycleLogRecord;
		const pointer =
			prev.ogStorage?.pointer ?? row.logPointer ?? `${vaultId}:${cycleId}`;

		const nextRecord: CycleLogRecord = {
			...prev,
			ogStorage: {
				pointer,
				...prev.ogStorage,
				pending: false,
				lastError: message,
			},
		};

		await db
			.update(vaultCycleLogs)
			.set({ record: nextRecord })
			.where(
				and(
					eq(vaultCycleLogs.vaultId, vaultId),
					eq(vaultCycleLogs.cycleId, cycleId)
				)
			);

		return true;
	} catch (error) {
		debugLog(cycleId, "og failure patch failed", error);
		return false;
	}
};

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
