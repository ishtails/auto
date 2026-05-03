import type { CycleLogRecord } from "@auto/api/trade-types";
import { env } from "@auto/env/server";
import { Queue, Worker } from "bunqueue/client";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { vaultCycleLogs } from "../db/schema";
import { OgLogger } from "../integrations/og-logger";
import {
	patchVaultCycleLogOgFailure,
	patchVaultCycleLogOgStorage,
} from "../router/cycle-log-cache";
import { debugLog } from "../router/debug";

/** 0G KV should not store UI-only `ogStorage` fields (`pending`, `lastError`). */
const cycleRecordForOgKvWrite = (record: CycleLogRecord): CycleLogRecord => {
	const og = record.ogStorage;
	if (!og) {
		return record;
	}
	return {
		...record,
		ogStorage: {
			pointer: og.pointer,
			...(og.rootHash?.trim() ? { rootHash: og.rootHash } : {}),
			...(og.txHash?.trim() ? { txHash: og.txHash } : {}),
		},
	};
};

export const ogCycleLogQueue = new Queue("og-cycle-log", { embedded: true });

export interface OgCycleLogJob {
	/** Same `memoryPointer` as `VaultConfig` / agent profile (0G stream id). */
	memoryPointer: string;
	record: CycleLogRecord;
	vaultId: string;
}

/**
 * Enqueue 0G KV write + proof merge. Await so the job is persisted before HTTP returns
 * (structured async — not a floating promise).
 */
export const enqueueOgCycleLogJob = async (
	payload: OgCycleLogJob
): Promise<void> => {
	await ogCycleLogQueue.add("complete-og-proof", payload);
};

export const ogCycleLogWorker = new Worker(
	"og-cycle-log",
	async (job) => {
		const { vaultId, memoryPointer, record } = job.data as OgCycleLogJob;
		const { cycleId } = record;

		const row = await db.query.vaultCycleLogs.findFirst({
			where: and(
				eq(vaultCycleLogs.vaultId, vaultId),
				eq(vaultCycleLogs.cycleId, cycleId)
			),
		});

		if (!row) {
			debugLog(cycleId, "og worker: row missing, skip", { vaultId });
			return;
		}

		const cached = row.record as CycleLogRecord;
		const existingOg = cached.ogStorage;
		if (existingOg?.txHash?.trim() || existingOg?.rootHash?.trim()) {
			debugLog(cycleId, "og worker: proof already stored, skip", { vaultId });
			return;
		}

		const dynamicLogger = new OgLogger(
			env.OG_INDEXER_RPC,
			env.OG_KV_ENDPOINT,
			memoryPointer,
			env.OG_RPC_URL,
			env.OG_PRIVATE_KEY,
			env.OG_FLOW_CONTRACT
		);

		try {
			const outcome = await dynamicLogger.write(
				cycleRecordForOgKvWrite(record),
				{
					batchTimeoutMs: null,
				}
			);

			await patchVaultCycleLogOgStorage({
				vaultId,
				cycleId,
				ogStorage: {
					pointer: outcome.pointer,
					...(outcome.rootHash ? { rootHash: outcome.rootHash } : {}),
					...(outcome.txHash ? { txHash: outcome.txHash } : {}),
					pending: false,
				},
			});

			debugLog(cycleId, "og worker: proof patched", {
				vaultId,
				hasTx: Boolean(outcome.txHash),
				hasRoot: Boolean(outcome.rootHash),
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			debugLog(cycleId, "og worker: write threw", { vaultId, message });
			await patchVaultCycleLogOgFailure({ vaultId, cycleId, message });
		}
	},
	{
		embedded: true,
		concurrency: 2,
	}
);
