import type { CycleLogRecord } from "@auto/api/trade-types";
import { ORPCError } from "@orpc/server";
import { desc, eq } from "drizzle-orm";
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

		const limit = readNumberQuery(c.req.query("limit"), 25, 1, 100);
		const pollMs = readNumberQuery(c.req.query("pollMs"), 3000, 1000, 30_000);

		c.header("Cache-Control", "no-store");

		return streamSSE(c, async (stream) => {
			const seen = new Set<string>();

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

			const sendHistory = async () => {
				const recent = await readRecentLogsFromDb();
				const ordered = [...recent].reverse();
				for (const record of ordered) {
					seen.add(record.cycleId);
				}
				await stream.writeSSE({
					event: "history",
					data: JSON.stringify(ordered),
				});
			};

			await sendHistory();

			stream.onAbort(() => {
				// no-op; loop checks abort via thrown errors on write/sleep
			});

			for (;;) {
				await stream.sleep(pollMs);

				const recent = await readRecentLogsFromDb();
				const ordered = [...recent].reverse();

				const newRecords: CycleLogRecord[] = [];
				for (const record of ordered) {
					if (seen.has(record.cycleId)) {
						continue;
					}
					seen.add(record.cycleId);
					newRecords.push(record);
				}

				for (const record of newRecords) {
					await stream.writeSSE({
						event: "cycle",
						data: JSON.stringify(record),
					});
				}

				await stream.writeSSE({ event: "ping", data: String(Date.now()) });
			}
		});
	});
}
