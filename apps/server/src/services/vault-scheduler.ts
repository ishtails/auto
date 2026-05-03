import type { IntegrationServices } from "@auto/api/context";
import { runTradeCycleInputSchema } from "@auto/api/trade-types";
import { env } from "@auto/env/server";
import { and, eq, gt, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "../db";
import { agentProfiles, users, vaults } from "../db/schema";
import { debugLog } from "../router/debug";
import { runTradeCycleInternal } from "../router/run-trade-cycle";

let tickMutex = false;

async function runDueVaults(services: IntegrationServices): Promise<void> {
	const rows = await db
		.select({
			vaultId: agentProfiles.vaultId,
			cadenceSeconds: agentProfiles.scheduleCadenceSeconds,
			privyUserId: users.privyUserId,
		})
		.from(agentProfiles)
		.innerJoin(vaults, eq(agentProfiles.vaultId, vaults.id))
		.innerJoin(users, eq(vaults.userId, users.id))
		.where(
			and(
				gt(agentProfiles.scheduleCadenceSeconds, 0),
				eq(agentProfiles.executorEnabled, true),
				eq(vaults.status, "active"),
				isNotNull(vaults.vaultAddress),
				isNotNull(agentProfiles.scheduleNextRunAt),
				lte(agentProfiles.scheduleNextRunAt, new Date())
			)
		)
		.orderBy(agentProfiles.scheduleNextRunAt)
		.limit(8);

	for (const row of rows) {
		const cadence = row.cadenceSeconds;
		await db
			.update(agentProfiles)
			.set({
				scheduleNextRunAt: sql`now() + (${cadence}::int * interval '1 second')`,
				updatedAt: new Date(),
			})
			.where(eq(agentProfiles.vaultId, row.vaultId));

		const cycleId = crypto.randomUUID();
		const startedAt = Date.now();
		const input = runTradeCycleInputSchema.parse({
			vaultId: row.vaultId,
			dryRun: false,
		});

		try {
			await runTradeCycleInternal({
				context: {
					auth: {
						type: "user",
						privyUserId: row.privyUserId,
					},
					services,
				},
				input,
				cycleId,
				startedAt,
			});
			debugLog(cycleId, "scheduler cycle ok", { vaultId: row.vaultId });
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));
			console.error(
				`[VaultScheduler] cycle failed vaultId=${row.vaultId}`,
				err
			);
			debugLog(cycleId, "scheduler cycle error", {
				vaultId: row.vaultId,
				message: err.message,
			});
		}
	}
}

export function startVaultScheduler(services: IntegrationServices): void {
	if (!env.SCHEDULER_ENABLED) {
		console.log("[VaultScheduler] disabled (SCHEDULER_ENABLED=false)");
		return;
	}

	const tickMs = env.SCHEDULER_TICK_MS;
	console.log(
		`[VaultScheduler] started tick=${tickMs}ms minCadence=${env.SCHEDULER_MIN_CADENCE_SECONDS}s`
	);

	const tick = () => {
		if (tickMutex) {
			return;
		}
		tickMutex = true;
		runDueVaults(services)
			.catch((e) => {
				console.error("[VaultScheduler] tick error", e);
			})
			.finally(() => {
				tickMutex = false;
			});
	};

	setInterval(tick, tickMs);
	// First pass shortly after boot (don't block listen).
	setTimeout(tick, 3000);
}
