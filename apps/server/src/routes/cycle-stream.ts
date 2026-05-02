import type { CycleLogRecord } from "@auto/api/trade-types";
import { env } from "@auto/env/server";
import { ORPCError } from "@orpc/server";
import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { resolveAuth } from "../auth/middleware";
import { OgLogger } from "../integrations/og-logger";
import { getOwnedActiveVault } from "../router";

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

		const { profile } = await getOwnedActiveVault(auth.privyUserId, vaultId);
		const streamId = profile.memoryPointer;
		if (!streamId) {
			throw new ORPCError("NOT_FOUND", {
				message: "Vault stream not configured (memoryPointer missing)",
			});
		}

		const limit = readNumberQuery(c.req.query("limit"), 25, 1, 100);
		const pollMs = readNumberQuery(c.req.query("pollMs"), 3000, 1000, 30_000);

		const logger = new OgLogger(
			env.OG_INDEXER_RPC,
			env.OG_KV_ENDPOINT,
			streamId,
			env.OG_RPC_URL,
			env.OG_PRIVATE_KEY,
			env.OG_FLOW_CONTRACT
		);

		c.header("Cache-Control", "no-store");

		return streamSSE(c, async (stream) => {
			const seen = new Set<string>();

			const sendHistory = async () => {
				const recent = await logger.readRecentLogs(limit);
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

				const recent = await logger.readRecentLogs(limit);
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
