import type { CycleLogRecord } from "@auto/api/trade-types";
import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, gt, or } from "drizzle-orm";
import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { resolveAuth } from "../auth/middleware";
import { db } from "../db";
import { vaultCycleLogs } from "../db/schema";
import { getOwnedActiveVault } from "./owned-vault";

const clampInt = (value: number, min: number, max: number): number =>
	Math.min(Math.max(value, min), max);

function readNumberQuery(
	value: string | undefined,
	fallback: number,
	min: number,
	max: number
): number {
	if (!value) {
		return fallback;
	}
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed)) {
		return fallback;
	}
	return clampInt(parsed, min, max);
}

export function registerCycleStreamRoutes(app: Hono) {
	app.get("/sse/vaults/:vaultId/cycles", async (c) => {
		const authHeader = c.req.header("Authorization");
		const auth = await resolveAuth(authHeader);
		if (!auth || auth.type !== "user") {
			throw new ORPCError("UNAUTHORIZED", { message: "Unauthorized" });
		}

		const vaultId = c.req.param("vaultId");

		await getOwnedActiveVault(auth.privyUserId, vaultId);

		// Keep SSE history small; older pages are loaded via paginated RPC.
		const limit = readNumberQuery(c.req.query("limit"), 10, 1, 25);
		const pollMs = readNumberQuery(c.req.query("pollMs"), 3000, 1000, 30_000);

		c.header("Cache-Control", "no-store");

		return streamSSE(c, async (stream) => {
			const seen = new Set<string>();
			const lastRecordSnapshot = new Map<string, string>();
			let lastCursor: { occurredAt: Date; cycleId: string } | null = null;

			const readRecentLogsFromDb = async (): Promise<CycleLogRecord[]> => {
				const rows = await db
					.select({ record: vaultCycleLogs.record })
					.from(vaultCycleLogs)
					.where(eq(vaultCycleLogs.vaultId, vaultId))
					.orderBy(desc(vaultCycleLogs.occurredAt))
					.limit(limit);

				const records: CycleLogRecord[] = [];
				for (const row of rows) {
					records.push(row.record as CycleLogRecord);
				}
				return records;
			};

			const readNewLogsFromDb = async (): Promise<CycleLogRecord[]> => {
				if (!lastCursor) {
					return [];
				}

				const rows = await db
					.select({
						record: vaultCycleLogs.record,
						occurredAt: vaultCycleLogs.occurredAt,
						cycleId: vaultCycleLogs.cycleId,
					})
					.from(vaultCycleLogs)
					.where(
						and(
							eq(vaultCycleLogs.vaultId, vaultId),
							or(
								gt(vaultCycleLogs.occurredAt, lastCursor.occurredAt),
								and(
									eq(vaultCycleLogs.occurredAt, lastCursor.occurredAt),
									gt(vaultCycleLogs.cycleId, lastCursor.cycleId)
								)
							)
						)
					)
					.orderBy(asc(vaultCycleLogs.occurredAt), asc(vaultCycleLogs.cycleId))
					.limit(25);

				const records: CycleLogRecord[] = [];
				for (const row of rows) {
					records.push(row.record as CycleLogRecord);
				}
				return records;
			};

			const sendHistory = async () => {
				const recent = await readRecentLogsFromDb();
				const ordered = [...recent].reverse();
				for (const record of ordered) {
					seen.add(record.cycleId);
					lastRecordSnapshot.set(record.cycleId, JSON.stringify(record));
				}

				// Track last cursor for incremental polling.
				const newest = ordered.at(-1) ?? null;
				if (newest) {
					lastCursor = {
						occurredAt: new Date(newest.timestamp),
						cycleId: newest.cycleId,
					};
				}

				await stream.writeSSE({
					event: "history",
					data: JSON.stringify(ordered),
				});
			};

			const emitUpdatedSnapshots = async () => {
				const recent = await readRecentLogsFromDb();
				for (const record of recent) {
					if (!seen.has(record.cycleId)) {
						continue;
					}
					const snap = JSON.stringify(record);
					if (lastRecordSnapshot.get(record.cycleId) === snap) {
						continue;
					}
					lastRecordSnapshot.set(record.cycleId, snap);
					await stream.writeSSE({
						event: "cycle",
						data: JSON.stringify(record),
					});
				}
			};

			await sendHistory();

			stream.onAbort(() => {
				// no-op; loop checks abort via thrown errors on write/sleep
			});

			for (;;) {
				await stream.sleep(pollMs);

				const newRecords = await readNewLogsFromDb();

				for (const record of newRecords) {
					seen.add(record.cycleId);
					lastRecordSnapshot.set(record.cycleId, JSON.stringify(record));
					lastCursor = {
						occurredAt: new Date(record.timestamp),
						cycleId: record.cycleId,
					};
					await stream.writeSSE({
						event: "cycle",
						data: JSON.stringify(record),
					});
				}

				await emitUpdatedSnapshots();

				await stream.writeSSE({ event: "ping", data: String(Date.now()) });
			}
		});
	});
}
