import { authedProcedure, publicProcedure } from "@auto/api";
import type { VaultConfig } from "@auto/api/context";
import { assertScheduleCadenceAllowed } from "@auto/api/schedule-cadence";
import {
	getVaultCycleLogsInputSchema,
	getVaultCycleLogsOutputSchema,
	runTradeCycleInputSchema,
	runTradeCycleOutputSchema,
} from "@auto/api/trade-types";
import {
	createVaultDeploymentSchema,
	getVaultAgentProfileInputSchema,
	getVaultBalancesSchema,
	getVaultDeploymentSchema,
	listVaultsOutputSchema,
	prepareVaultDeploymentSchema,
	setVaultAgentBasenameOutputSchema,
	setVaultAgentBasenameSchema,
	setVaultExecutorEnabledSchema,
	setVaultScheduleOutputSchema,
	setVaultScheduleSchema,
	updateVaultAgentSettingsOutputSchema,
	updateVaultAgentSettingsSchema,
	vaultAgentProfileOutputSchema,
} from "@auto/api/vault-types";
import {
	VAULT_FACTORY_ABI,
	VAULT_FACTORY_ADDRESS,
} from "@auto/contracts/factory-definitions";
import { env } from "@auto/env/server";
import { ORPCError } from "@orpc/server";
import { and, desc, eq, lt, or } from "drizzle-orm";
import { createPublicClient, hashTypedData, http, isAddress } from "viem";
import { normalize } from "viem/ens";
import { getUserWalletAddress } from "./auth/middleware";
import { db } from "./db";
import {
	agentProfiles,
	users,
	vaultCycleLogs,
	vaultDeployments,
	vaults,
} from "./db/schema";
import {
	addressesEqual,
	getBasenamesRegistryAddress,
	resolveBasenameForwardAddress,
} from "./integrations/basenames-resolve";
import { ChainStateClient } from "./integrations/chain-state";
import { debugLog } from "./router/debug";
import { runTradeCycleInternal } from "./router/run-trade-cycle";

/** `UserVault.maxTradeSizeBps` when deployed+active; else DB profile (e.g. pre-deploy). */
async function resolveVaultMaxTradeBpsFromChainFirst(vault: {
	agentProfile: { maxTradeBps: number } | null;
	status: string;
	vaultAddress: string | null;
}): Promise<number> {
	if (
		vault.status === "active" &&
		vault.vaultAddress &&
		isAddress(vault.vaultAddress)
	) {
		try {
			const chainState = new ChainStateClient(
				env.CHAIN_RPC_URL,
				vault.vaultAddress
			);
			return await chainState.getMaxTradeSizeBps();
		} catch {
			// RPC or contract read failure — fall back below
		}
	}
	return vault.agentProfile?.maxTradeBps ?? 50;
}

// Server-side router implementation with full DB access
export const appRouter = {
	// Health check - simple status
	healthCheck: publicProcedure.handler(() => "OK"),

	// Integration diagnostics
	integrationDiagnostics: publicProcedure.handler(async ({ context }) =>
		context.services.getDiagnostics()
	),

	prepareVaultDeployment: authedProcedure
		.input(prepareVaultDeploymentSchema)
		.handler(async ({ context, input }) => {
			if (context.auth?.type !== "user") {
				throw new ORPCError("UNAUTHORIZED", {
					message: "Requires user context",
				});
			}

			const ownerAddress = await getUserWalletAddress(context.auth.privyUserId);
			if (!ownerAddress) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "Could not resolve owner wallet address",
				});
			}

			const publicClient = createPublicClient({
				transport: http(env.CHAIN_RPC_URL),
			});

			const nonce = await publicClient.readContract({
				address: VAULT_FACTORY_ADDRESS,
				abi: VAULT_FACTORY_ABI,
				functionName: "getNonce",
				args: [ownerAddress as `0x${string}`],
			});

			// viem can hash typed data with bigint values, but Privy’s client-side
			// signing flow JSON.stringify’s the payload, which cannot serialize bigint.
			// So we compute the hash with bigint and return a JSON-safe version.
			const typedDataForHash = {
				domain: {
					name: "AutoVaultFactory",
					version: "1",
					chainId: env.CHAIN_ID,
					verifyingContract: VAULT_FACTORY_ADDRESS,
				},
				types: {
					DeployConfig: [
						{ name: "owner", type: "address" },
						{ name: "swapRouter", type: "address" },
						{ name: "maxTradeSizeBps", type: "uint16" },
						{ name: "nonce", type: "uint256" },
					],
				},
				primaryType: "DeployConfig" as const,
				message: {
					owner: ownerAddress as `0x${string}`,
					swapRouter: env.UNISWAP_ROUTER_ADDRESS as `0x${string}`,
					maxTradeSizeBps: input.maxTradeSizeBps,
					nonce,
				},
			} as const;

			const signedConfigHash = hashTypedData(typedDataForHash);

			const typedData = {
				...typedDataForHash,
				message: {
					...typedDataForHash.message,
					nonce: nonce.toString(),
				},
			} as const;

			return {
				defaults: {
					chainId: env.CHAIN_ID,
					factoryAddress: VAULT_FACTORY_ADDRESS,
					swapRouterAddress: env.UNISWAP_ROUTER_ADDRESS,
					tokenIn: env.TOKEN_WETH,
					tokenOut: env.TOKEN_USDC,
				},
				signedConfigHash,
				typedData,
			};
		}),

	// Trade cycle: authenticated, always scoped to a user-owned vault
	runTradeCycle: authedProcedure
		.input(runTradeCycleInputSchema)
		.output(runTradeCycleOutputSchema)
		.handler(async ({ context, input }) => {
			const startedAt = Date.now();
			if (context.auth.type !== "user") {
				throw new ORPCError("UNAUTHORIZED", {
					message: "Vault execution requires user auth",
				});
			}

			const cycleId = crypto.randomUUID();
			try {
				return await runTradeCycleInternal({
					context: { auth: context.auth, services: context.services },
					input,
					cycleId,
					startedAt,
				});
			} catch (error: unknown) {
				const err = error instanceof Error ? error : new Error(String(error));
				debugLog(cycleId, "error", {
					ms: Date.now() - startedAt,
					message: err.message,
				});
				throw error;
			}
		}),

	getVaultCycleLogs: authedProcedure
		.input(getVaultCycleLogsInputSchema)
		.output(getVaultCycleLogsOutputSchema)
		.handler(async ({ context, input }) => {
			if (context.auth?.type !== "user") {
				throw new ORPCError("UNAUTHORIZED", {
					message: "Requires user context",
				});
			}

			const user = await db.query.users.findFirst({
				where: eq(users.privyUserId, context.auth.privyUserId),
			});

			if (!user) {
				throw new ORPCError("NOT_FOUND", { message: "User not found" });
			}

			const vault = await db.query.vaults.findFirst({
				where: and(eq(vaults.id, input.vaultId), eq(vaults.userId, user.id)),
			});

			if (!vault) {
				throw new ORPCError("UNAUTHORIZED", {
					message: "Not authorized to view this vault",
				});
			}

			const limit = input.limit ?? 10;
			const cursor = input.cursor ?? null;

			const whereClause = cursor
				? and(
						eq(vaultCycleLogs.vaultId, vault.id),
						or(
							lt(vaultCycleLogs.occurredAt, new Date(cursor.occurredAt)),
							and(
								eq(vaultCycleLogs.occurredAt, new Date(cursor.occurredAt)),
								lt(vaultCycleLogs.cycleId, cursor.cycleId)
							)
						)
					)
				: eq(vaultCycleLogs.vaultId, vault.id);

			const rows = await db
				.select({
					record: vaultCycleLogs.record,
					occurredAt: vaultCycleLogs.occurredAt,
					cycleId: vaultCycleLogs.cycleId,
				})
				.from(vaultCycleLogs)
				.where(whereClause)
				.orderBy(desc(vaultCycleLogs.occurredAt), desc(vaultCycleLogs.cycleId))
				.limit(limit + 1);

			const hasMore = rows.length > limit;
			const pageRows = hasMore ? rows.slice(0, limit) : rows;
			const last = pageRows.at(-1) ?? null;

			return {
				items: pageRows.map((row) => ({
					record: row.record,
					occurredAt: row.occurredAt.toISOString(),
					cycleId: row.cycleId,
				})),
				nextCursor:
					hasMore && last
						? {
								occurredAt: last.occurredAt.toISOString(),
								cycleId: last.cycleId,
							}
						: null,
			};
		}),

	// ─── Vault Procedures with DB Implementation ───────────────────────

	me: authedProcedure.handler(async ({ context }) => {
		if (context.auth?.type !== "user") {
			throw new ORPCError("UNAUTHORIZED", { message: "Requires user context" });
		}

		// Fetch wallet address from Privy API if not already cached
		let walletAddress = context.auth.walletAddress;
		if (!walletAddress) {
			walletAddress = await getUserWalletAddress(context.auth.privyUserId);
		}

		// Upsert user in database
		const userResult = await db
			.insert(users)
			.values({
				privyUserId: context.auth.privyUserId,
				primaryWalletAddress: walletAddress ?? "",
			})
			.onConflictDoUpdate({
				target: users.privyUserId,
				set: {
					primaryWalletAddress: walletAddress ?? "",
					updatedAt: new Date(),
				},
			})
			.returning();

		return {
			privyUserId: context.auth.privyUserId,
			walletAddress: walletAddress ?? null,
			userId: userResult[0]?.id,
		};
	}),

	listVaults: authedProcedure
		.output(listVaultsOutputSchema)
		.handler(async ({ context }) => {
			if (context.auth?.type !== "user") {
				throw new ORPCError("UNAUTHORIZED", {
					message: "Requires user context",
				});
			}

			// Get user and their vaults with agent profiles
			const user = await db.query.users.findFirst({
				where: eq(users.privyUserId, context.auth.privyUserId),
				with: {
					vaults: {
						with: {
							agentProfile: true,
						},
					},
				},
			});

			if (!user) {
				return [];
			}

			return Promise.all(
				user.vaults.map(async (vault) => ({
					id: vault.id,
					name: vault.agentProfile?.name ?? "Unnamed Vault",
					status: vault.status,
					riskScore: await resolveVaultMaxTradeBpsFromChainFirst(vault),
					maxSlippageBps: vault.agentProfile?.maxSlippageBps ?? 100,
					executorEnabled: vault.agentProfile?.executorEnabled ?? false,
					vaultAddress: vault.vaultAddress ?? null,
					tokenIn: vault.agentProfile?.tokenIn ?? null,
					tokenOut: vault.agentProfile?.tokenOut ?? null,
					scheduleCadenceSeconds:
						vault.agentProfile?.scheduleCadenceSeconds ?? 0,
					scheduleNextRunAt:
						vault.agentProfile?.scheduleNextRunAt?.toISOString() ?? null,
					agentBasename: vault.agentProfile?.agentBasename ?? null,
				}))
			);
		}),

	createVaultDeployment: authedProcedure
		.input(createVaultDeploymentSchema)
		.handler(async ({ context, input }) => {
			if (context.auth?.type !== "user") {
				throw new ORPCError("UNAUTHORIZED", {
					message: "Requires user context",
				});
			}

			// Fetch wallet address from Privy if not already available
			let walletAddress = context.auth.walletAddress;
			if (!walletAddress) {
				walletAddress = await getUserWalletAddress(context.auth.privyUserId);
			}

			if (!walletAddress) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "Could not fetch wallet address from Privy",
				});
			}

			// Get or create user
			let user = await db.query.users.findFirst({
				where: eq(users.privyUserId, context.auth.privyUserId),
			});

			if (!user) {
				const result = await db
					.insert(users)
					.values({
						privyUserId: context.auth.privyUserId,
						primaryWalletAddress: walletAddress,
					})
					.returning();
				user = result[0];
			}

			if (!user) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "Failed to create user",
				});
			}

			// Import deploy queue dynamically
			const { deployQueue } = await import("./services/deploy-queue");

			// Create vault record
			const vaultResult = await db
				.insert(vaults)
				.values({
					userId: user.id,
					ownerAddress: walletAddress,
					factoryAddress: input.factoryAddress ?? VAULT_FACTORY_ADDRESS,
					chainId: 84_532, // Base Sepolia
					status: "queued",
				})
				.returning();

			const vault = vaultResult[0];

			if (!vault) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "Failed to create vault",
				});
			}

			// Create agent profile
			const profileResult = await db
				.insert(agentProfiles)
				.values({
					vaultId: vault.id,
					name: input.name,
					geminiSystemPrompt: input.geminiSystemPrompt,
					executorEnabled: input.executorEnabled ?? false,
					maxTradeBps: input.maxTradeBps,
					maxSlippageBps: input.maxSlippageBps,
					tokenIn: input.tokenIn,
					tokenOut: input.tokenOut,
					memoryPointer: `auto-vault-${vault.id}`,
					scheduleCadenceSeconds: 0,
					scheduleNextRunAt: null,
				})
				.returning();

			// Create deployment record
			const deploymentResult = await db
				.insert(vaultDeployments)
				.values({
					vaultId: vault.id,
					status: "queued",
					signedConfigHash: input.signedConfigHash,
					ownerSignature: input.ownerSignature,
				})
				.returning();

			const deployment = deploymentResult[0];

			if (!deployment) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "Failed to create deployment",
				});
			}

			// Enqueue deployment job with wallet address for on-chain tx
			await deployQueue.add("deploy-vault", {
				deploymentId: deployment.id,
				vaultId: vault.id,
				ownerAddress: walletAddress,
				signedConfigHash: input.signedConfigHash,
				ownerSignature: input.ownerSignature,
				maxTradeSizeBps: input.maxTradeBps,
				tokenIn: input.tokenIn,
				tokenOut: input.tokenOut,
			});

			return {
				deploymentId: deployment.id,
				vaultId: vault.id,
				status: "queued",
				profileId: profileResult[0]?.id,
			};
		}),

	setVaultExecutorEnabled: authedProcedure
		.input(setVaultExecutorEnabledSchema)
		.handler(async ({ context, input }) => {
			if (context.auth?.type !== "user") {
				throw new ORPCError("UNAUTHORIZED", {
					message: "Requires user context",
				});
			}

			const user = await db.query.users.findFirst({
				where: eq(users.privyUserId, context.auth.privyUserId),
			});

			if (!user) {
				throw new ORPCError("NOT_FOUND", { message: "User not found" });
			}

			const vault = await db.query.vaults.findFirst({
				where: and(eq(vaults.id, input.vaultId), eq(vaults.userId, user.id)),
			});

			if (!vault) {
				throw new ORPCError("UNAUTHORIZED", {
					message: "Not authorized to update this vault",
				});
			}

			await db
				.update(agentProfiles)
				.set(
					input.executorEnabled
						? { executorEnabled: true, updatedAt: new Date() }
						: {
								executorEnabled: false,
								scheduleCadenceSeconds: 0,
								scheduleNextRunAt: null,
								updatedAt: new Date(),
							}
				)
				.where(eq(agentProfiles.vaultId, vault.id));

			return { ok: true };
		}),

	setVaultSchedule: authedProcedure
		.input(setVaultScheduleSchema)
		.output(setVaultScheduleOutputSchema)
		.handler(async ({ context, input }) => {
			if (context.auth?.type !== "user") {
				throw new ORPCError("UNAUTHORIZED", {
					message: "Requires user context",
				});
			}

			try {
				assertScheduleCadenceAllowed(
					input.scheduleCadenceSeconds,
					env.SCHEDULER_MIN_CADENCE_SECONDS
				);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				throw new ORPCError("BAD_REQUEST", { message });
			}

			const user = await db.query.users.findFirst({
				where: eq(users.privyUserId, context.auth.privyUserId),
			});

			if (!user) {
				throw new ORPCError("NOT_FOUND", { message: "User not found" });
			}

			const vault = await db.query.vaults.findFirst({
				where: and(eq(vaults.id, input.vaultId), eq(vaults.userId, user.id)),
				with: { agentProfile: true },
			});

			if (!vault?.agentProfile) {
				throw new ORPCError("UNAUTHORIZED", {
					message: "Not authorized to update this vault",
				});
			}

			if (
				input.scheduleCadenceSeconds > 0 &&
				!vault.agentProfile.executorEnabled
			) {
				throw new ORPCError("BAD_REQUEST", {
					message:
						"Scheduled autopilot requires executor (live) mode. Turn executor on first.",
				});
			}

			let scheduleNextRunAt: Date | null = null;
			if (input.scheduleCadenceSeconds > 0) {
				if (input.firstRunAtUtc) {
					const parsed = Date.parse(input.firstRunAtUtc);
					if (Number.isNaN(parsed)) {
						throw new ORPCError("BAD_REQUEST", {
							message: "firstRunAtUtc must be a valid ISO 8601 datetime",
						});
					}
					scheduleNextRunAt = new Date(Math.max(Date.now(), parsed));
				} else {
					scheduleNextRunAt = new Date(
						Date.now() + input.scheduleCadenceSeconds * 1000
					);
				}
			}

			await db
				.update(agentProfiles)
				.set({
					scheduleCadenceSeconds: input.scheduleCadenceSeconds,
					scheduleNextRunAt,
					updatedAt: new Date(),
				})
				.where(eq(agentProfiles.vaultId, vault.id));

			return {
				ok: true as const,
				scheduleNextRunAt: scheduleNextRunAt?.toISOString() ?? null,
			};
		}),

	getVaultAgentProfile: authedProcedure
		.input(getVaultAgentProfileInputSchema)
		.output(vaultAgentProfileOutputSchema)
		.handler(async ({ context, input }) => {
			if (context.auth?.type !== "user") {
				throw new ORPCError("UNAUTHORIZED", {
					message: "Requires user context",
				});
			}

			const user = await db.query.users.findFirst({
				where: eq(users.privyUserId, context.auth.privyUserId),
			});

			if (!user) {
				throw new ORPCError("NOT_FOUND", { message: "User not found" });
			}

			const vault = await db.query.vaults.findFirst({
				where: and(eq(vaults.id, input.vaultId), eq(vaults.userId, user.id)),
				with: { agentProfile: true },
			});

			if (!vault?.agentProfile) {
				throw new ORPCError("NOT_FOUND", {
					message: "Vault or agent profile not found",
				});
			}

			const p = vault.agentProfile;
			const maxTradeBps = await resolveVaultMaxTradeBpsFromChainFirst(vault);
			return {
				geminiSystemPrompt: p.geminiSystemPrompt,
				maxSlippageBps: p.maxSlippageBps,
				maxTradeBps,
				name: p.name,
				tokenIn: p.tokenIn,
				tokenOut: p.tokenOut,
				agentBasename: p.agentBasename ?? null,
			};
		}),

	updateVaultAgentSettings: authedProcedure
		.input(updateVaultAgentSettingsSchema)
		.output(updateVaultAgentSettingsOutputSchema)
		.handler(async ({ context, input }) => {
			if (context.auth?.type !== "user") {
				throw new ORPCError("UNAUTHORIZED", {
					message: "Requires user context",
				});
			}

			const user = await db.query.users.findFirst({
				where: eq(users.privyUserId, context.auth.privyUserId),
			});

			if (!user) {
				throw new ORPCError("NOT_FOUND", { message: "User not found" });
			}

			const vault = await db.query.vaults.findFirst({
				where: and(eq(vaults.id, input.vaultId), eq(vaults.userId, user.id)),
			});

			if (!vault) {
				throw new ORPCError("UNAUTHORIZED", {
					message: "Not authorized to update this vault",
				});
			}

			const tokenIn = input.tokenIn.toLowerCase();
			const tokenOut = input.tokenOut.toLowerCase();
			if (!(isAddress(tokenIn) && isAddress(tokenOut))) {
				throw new ORPCError("BAD_REQUEST", {
					message: "tokenIn and tokenOut must be valid addresses",
				});
			}

			await db
				.update(agentProfiles)
				.set({
					geminiSystemPrompt: input.geminiSystemPrompt,
					maxSlippageBps: input.maxSlippageBps,
					name: input.name,
					tokenIn,
					tokenOut,
					updatedAt: new Date(),
				})
				.where(eq(agentProfiles.vaultId, vault.id));

			return { ok: true as const };
		}),

	setVaultAgentBasename: authedProcedure
		.input(setVaultAgentBasenameSchema)
		.output(setVaultAgentBasenameOutputSchema)
		.handler(async ({ context, input }) => {
			if (context.auth?.type !== "user") {
				throw new ORPCError("UNAUTHORIZED", {
					message: "Requires user context",
				});
			}

			const user = await db.query.users.findFirst({
				where: eq(users.privyUserId, context.auth.privyUserId),
			});

			if (!user) {
				throw new ORPCError("NOT_FOUND", { message: "User not found" });
			}

			const vault = await db.query.vaults.findFirst({
				where: and(eq(vaults.id, input.vaultId), eq(vaults.userId, user.id)),
			});

			if (!vault) {
				throw new ORPCError("UNAUTHORIZED", {
					message: "Not authorized to update this vault",
				});
			}

			const raw = input.agentBasename?.trim() ?? "";
			if (raw === "") {
				await db
					.update(agentProfiles)
					.set({ agentBasename: null, updatedAt: new Date() })
					.where(eq(agentProfiles.vaultId, vault.id));
				return { ok: true as const };
			}

			if (vault.chainId !== env.CHAIN_ID) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Vault chain does not match server configuration",
				});
			}

			if (!getBasenamesRegistryAddress(vault.chainId)) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Basenames are only supported on Base or Base Sepolia",
				});
			}

			if (!vault.vaultAddress) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Deploy the vault before linking a Basename",
				});
			}

			let normalized: string;
			try {
				normalized = normalize(raw);
			} catch {
				throw new ORPCError("BAD_REQUEST", {
					message: "Invalid Basename (normalization failed)",
				});
			}

			if (!normalized.endsWith(".base.eth")) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Basename must end with .base.eth",
				});
			}

			const resolved = await resolveBasenameForwardAddress({
				rpcUrl: env.CHAIN_RPC_URL,
				chainId: vault.chainId,
				basename: normalized,
			});

			if (!resolved) {
				throw new ORPCError("BAD_REQUEST", {
					message:
						"Could not resolve this name on-chain (no resolver or address record)",
				});
			}

			if (!addressesEqual(resolved, vault.vaultAddress)) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Basename does not resolve to this vault's address",
				});
			}

			await db
				.update(agentProfiles)
				.set({ agentBasename: normalized, updatedAt: new Date() })
				.where(eq(agentProfiles.vaultId, vault.id));

			return { ok: true as const };
		}),

	getVaultDeployment: authedProcedure
		.input(getVaultDeploymentSchema)
		.handler(async ({ context, input }) => {
			if (context.auth?.type !== "user") {
				throw new ORPCError("UNAUTHORIZED", {
					message: "Requires user context",
				});
			}

			const deployment = await db.query.vaultDeployments.findFirst({
				where: eq(vaultDeployments.id, input.deploymentId),
				with: {
					vault: true,
				},
			});

			if (!deployment) {
				throw new ORPCError("NOT_FOUND", { message: "Deployment not found" });
			}

			// Verify ownership: get user and check if they own the vault
			const user = await db.query.users.findFirst({
				where: eq(users.privyUserId, context.auth.privyUserId),
			});

			if (!user) {
				throw new ORPCError("UNAUTHORIZED", { message: "User not found" });
			}

			// Check if the vault belongs to this user
			const vault = await db.query.vaults.findFirst({
				where: and(
					eq(vaults.id, deployment.vaultId),
					eq(vaults.userId, user.id)
				),
			});

			if (!vault) {
				throw new ORPCError("UNAUTHORIZED", {
					message: "Not authorized to view this deployment",
				});
			}

			return {
				deploymentId: deployment.id,
				vaultId: deployment.vaultId,
				status: deployment.status,
				txHash: deployment.txHash,
				error: deployment.error,
				createdAt: deployment.createdAt.toISOString(),
				updatedAt: deployment.updatedAt.toISOString(),
			};
		}),

	getVaultBalancesByVaultId: authedProcedure
		.input(getVaultBalancesSchema)
		.handler(async ({ context, input }) => {
			if (context.auth?.type !== "user") {
				throw new ORPCError("UNAUTHORIZED", {
					message: "Requires user context",
				});
			}

			// Get user from DB
			const user = await db.query.users.findFirst({
				where: eq(users.privyUserId, context.auth.privyUserId),
			});

			if (!user) {
				throw new ORPCError("NOT_FOUND", { message: "User not found" });
			}

			// Verify vault ownership by userId
			const vault = await db.query.vaults.findFirst({
				where: and(
					eq(vaults.id, input.vaultId),
					eq(vaults.userId, user.id),
					eq(vaults.status, "active")
				),
				with: {
					agentProfile: true,
				},
			});

			if (!vault?.vaultAddress) {
				throw new ORPCError("NOT_FOUND", { message: "Active vault not found" });
			}
			if (!isAddress(vault.vaultAddress)) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Vault address is invalid. Deployment may be incomplete.",
					data: { vaultAddress: vault.vaultAddress },
				});
			}

			// Build vault config for on-chain queries
			const vaultConfig: VaultConfig = {
				vaultAddress: vault.vaultAddress,
				tokenIn: vault.agentProfile?.tokenIn ?? "",
				tokenOut: vault.agentProfile?.tokenOut ?? "",
				geminiSystemPrompt: vault.agentProfile?.geminiSystemPrompt ?? "",
				memoryPointer: vault.agentProfile?.memoryPointer ?? "",
			};

			const balances = await context.services.getVaultBalances(vaultConfig);

			return {
				hubTokenKey: balances.hubTokenKey,
				tokens: balances.tokens.map((t) => ({
					address: t.address,
					decimals: t.decimals,
					isHub: t.isHub,
					key: t.key,
					symbol: t.symbol,
					wei: t.wei.toString(),
				})),
				usdcWei: balances.usdcWei.toString(),
				wethWei: balances.wethWei.toString(),
			};
		}),
};

export type AppRouter = typeof appRouter;
