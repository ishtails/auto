import { VAULT_FACTORY_ABI } from "@auto/contracts/factory-definitions";
import { env } from "@auto/env/server";
import { and, eq, isNotNull } from "drizzle-orm";
import { createPublicClient, decodeEventLog, http, isAddress } from "viem";
import { db } from "../db";
import { vaultDeployments, vaults } from "../db/schema";

function getDeployedVaultAddress(args: unknown): `0x${string}` | null {
	if (!args || typeof args !== "object") {
		return null;
	}
	if (!("vault" in args)) {
		return null;
	}
	const vault = (args as Record<string, unknown>).vault;
	if (typeof vault !== "string") {
		return null;
	}
	if (!isAddress(vault)) {
		return null;
	}
	return vault;
}

export async function startupSync() {
	console.log("[StartupSync] Checking for pending deployments...");

	// Find deployments that were submitted but server crashed before resolving
	const pending = await db
		.select()
		.from(vaultDeployments)
		.where(
			and(
				eq(vaultDeployments.status, "submitted"),
				isNotNull(vaultDeployments.txHash)
			)
		);

	if (pending.length === 0) {
		console.log("[StartupSync] No pending deployments found.");
		return;
	}

	console.log(
		`[StartupSync] Found ${pending.length} pending deployments. Resolving...`
	);

	for (const deployment of pending) {
		try {
			const txHash = deployment.txHash;
			if (!txHash) {
				continue;
			}

			const publicClient = createPublicClient({
				chain: undefined,
				transport: http(env.CHAIN_RPC_URL),
			});

			const receipt = await publicClient.getTransactionReceipt({
				hash: txHash as `0x${string}`,
			});

			let deployedVault: `0x${string}` | null = null;
			for (const log of receipt.logs) {
				try {
					const decoded = decodeEventLog({
						abi: VAULT_FACTORY_ABI,
						data: log.data,
						topics: log.topics,
					});
					if (decoded.eventName === "VaultDeployed") {
						deployedVault = getDeployedVaultAddress(decoded.args);
						break;
					}
				} catch {
					// ignore non-matching logs
				}
			}

			if (!deployedVault) {
				throw new Error("VaultDeployed event not found in receipt logs");
			}

			await db
				.update(vaultDeployments)
				.set({ status: "active" })
				.where(eq(vaultDeployments.id, deployment.id));

			await db
				.update(vaults)
				.set({ status: "active", vaultAddress: deployedVault })
				.where(eq(vaults.id, deployment.vaultId));

			console.log(
				`[StartupSync] Resolved deployment ${deployment.id} to active.`
			);
		} catch (error) {
			console.error(
				`[StartupSync] Failed to resolve deployment ${deployment.id}:`,
				error
			);
		}
	}
}
