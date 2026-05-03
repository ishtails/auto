import type {
	CycleLogRecord,
	LlmTradingMemoryEntry,
} from "@auto/api/trade-types";
import { env } from "@auto/env/server";
import { db } from "../db";
import { OgLogger } from "../integrations/og-logger";
import { rawCycleLogToLlmTradingMemory } from "./trading-memory";

const MEMORY_READ_TIMEOUT_MS = 2500;

const autoVaultIdPrefix = "auto-vault-";
const uuidLikeRegex =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const extractVaultIdFromMemoryPointer = (
	memoryPointer: string
): string | null => {
	if (!memoryPointer.startsWith(autoVaultIdPrefix)) {
		return null;
	}
	const id = memoryPointer.slice(autoVaultIdPrefix.length);
	if (!uuidLikeRegex.test(id)) {
		return null;
	}
	return id;
};

const getRecentMemoryFromDb = async (
	memoryPointer: string
): Promise<LlmTradingMemoryEntry[]> => {
	const vaultId = extractVaultIdFromMemoryPointer(memoryPointer);
	if (!vaultId) {
		return [];
	}

	const rows = await db.query.vaultCycleLogs.findMany({
		where: (table, { eq }) => eq(table.vaultId, vaultId),
		orderBy: (table, { desc }) => desc(table.occurredAt),
		limit: 5,
	});

	const out: LlmTradingMemoryEntry[] = [];
	for (const row of rows) {
		const entry = rawCycleLogToLlmTradingMemory(row.record);
		if (entry) {
			out.push(entry);
		}
	}
	return out;
};

/**
 * Trading memory entries in the same shape Gemini sees — use this for the 0G Compute verifier
 * so judges can show an explicit “memory → verifier” path (not only proposal + gate).
 */
export const loadTradingMemoryEntries = async (
	memoryPointer: string
): Promise<LlmTradingMemoryEntry[]> => {
	const memoryFromDb = await getRecentMemoryFromDb(memoryPointer).catch(
		() => []
	);
	if (memoryFromDb.length > 0) {
		return memoryFromDb;
	}

	const dynamicLogger = new OgLogger(
		env.OG_INDEXER_RPC,
		env.OG_KV_ENDPOINT,
		memoryPointer,
		env.OG_RPC_URL,
		env.OG_PRIVATE_KEY,
		env.OG_FLOW_CONTRACT
	);

	const recentLogs = await Promise.race([
		dynamicLogger.readRecentLogs(5).catch(() => [] as CycleLogRecord[]),
		new Promise<CycleLogRecord[]>((resolve) =>
			setTimeout(() => resolve([]), MEMORY_READ_TIMEOUT_MS)
		),
	]);

	const mapped: LlmTradingMemoryEntry[] = [];
	for (const log of recentLogs) {
		const entry = rawCycleLogToLlmTradingMemory(log);
		if (entry) {
			mapped.push(entry);
		}
	}
	return mapped;
};
