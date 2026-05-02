import { authedProcedure, publicProcedure } from "@auto/api";
import type { IntegrationServices, VaultConfig } from "@auto/api/context";
import {
	type CycleLogRecord,
	type KeeperExecutionResult,
	runTradeCycleInputSchema,
	runTradeCycleOutputSchema,
} from "@auto/api/trade-types";
import {
	createVaultDeploymentSchema,
	getVaultBalancesSchema,
	getVaultDeploymentSchema,
	listVaultsOutputSchema,
	prepareVaultDeploymentSchema,
} from "@auto/api/vault-types";
import {
	VAULT_FACTORY_ABI,
	VAULT_FACTORY_ADDRESS,
} from "@auto/contracts/factory-definitions";
import { env } from "@auto/env/server";
import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { createPublicClient, hashTypedData, http, isAddress } from "viem";
import type { z } from "zod";
import { getUserWalletAddress } from "./auth/middleware";
import { db } from "./db";
import { agentProfiles, users, vaultDeployments, vaults } from "./db/schema";
import { ChainStateClient } from "./integrations/chain-state";

const deriveAmountInWei = (balanceWei: bigint, maxTradeBps: number): bigint => {
	const derived = (balanceWei * BigInt(maxTradeBps)) / 10_000n;
	return derived > balanceWei ? balanceWei : derived;
};

const requireNumber = (value: number | undefined, label: string): number => {
	if (value === undefined) {
		throw new ORPCError("BAD_REQUEST", { message: `${label} is required` });
	}
	return value;
};

const requireString = (value: string | undefined, label: string): string => {
	if (!value) {
		throw new ORPCError("BAD_REQUEST", { message: `${label} is required` });
	}
	return value;
};

const truncateText = (value: string, maxLen: number): string =>
	value.length > maxLen ? `${value.slice(0, Math.max(0, maxLen - 1))}…` : value;

const sanitizeCycleLogRecord = (record: CycleLogRecord): CycleLogRecord => {
	const MAX_REASONING = 2000;
	const MAX_REASON = 2000;

	return {
		...record,
		proposal: {
			...record.proposal,
			reasoning: truncateText(record.proposal.reasoning, MAX_REASONING),
		},
		riskDecision: {
			...record.riskDecision,
			reason: truncateText(record.riskDecision.reason, MAX_REASON),
		},
	};
};

// DO NOT REMOVE: This debug logger is intentionally always available behind
// `DEBUG=true` for investigating prod/testnet issues.
const isDebugEnabled = (): boolean => process.env.DEBUG === "true";

const debugLog = (cycleId: string, message: string, data?: unknown) => {
	if (!isDebugEnabled()) {
		return;
	}
	const prefix = `[runTradeCycle:${cycleId}]`;
	if (data) {
		console.log(prefix, message, data);
		return;
	}
	console.log(prefix, message);
};

export async function getOwnedActiveVault(
	privyUserId: string,
	vaultId: string
) {
	const user = await db.query.users.findFirst({
		where: eq(users.privyUserId, privyUserId),
	});

	if (!user) {
		throw new ORPCError("NOT_FOUND", { message: "User not found" });
	}

	const vault = await db.query.vaults.findFirst({
		where: and(
			eq(vaults.id, vaultId),
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
	const profile = vault.agentProfile;
	if (!profile) {
		throw new ORPCError("NOT_FOUND", { message: "Vault profile not found" });
	}
	if (!isAddress(vault.vaultAddress)) {
		throw new ORPCError("BAD_REQUEST", {
			message: "Vault address is invalid. Deployment may be incomplete.",
			data: { vaultAddress: vault.vaultAddress },
		});
	}

	const vaultAddress = vault.vaultAddress as `0x${string}`;
	return { vaultAddress, profile };
}

async function runTradeCycleInternal({
	context,
	input,
	cycleId,
	startedAt,
}: {
	context: {
		auth: { type: "user"; privyUserId: string };
		services: IntegrationServices;
	};
	input: z.infer<typeof runTradeCycleInputSchema>;
	cycleId: string;
	startedAt: number;
}): Promise<z.infer<typeof runTradeCycleOutputSchema>> {
	let amountInInput = input.amountIn;
	let maxSlippageBps = input.maxSlippageBps;

	debugLog(cycleId, "start", {
		vaultId: input.vaultId,
		dryRun: input.dryRun,
		hasAmountIn: Boolean(input.amountIn),
		maxSlippageBps: input.maxSlippageBps ?? null,
	});

	const { vaultAddress, profile } = await getOwnedActiveVault(
		context.auth.privyUserId,
		input.vaultId
	);
	debugLog(cycleId, "resolved vault", {
		vaultAddress,
		tokenIn: profile.tokenIn,
		tokenOut: profile.tokenOut,
		maxTradeBps: profile.maxTradeBps,
		defaultMaxSlippageBps: profile.maxSlippageBps,
		memoryPointer: profile.memoryPointer,
	});

	const vaultConfig: VaultConfig = {
		vaultAddress,
		tokenIn: profile.tokenIn,
		tokenOut: profile.tokenOut,
		geminiSystemPrompt: profile.geminiSystemPrompt,
		memoryPointer: profile.memoryPointer,
	};

	if (maxSlippageBps === undefined) {
		maxSlippageBps = profile.maxSlippageBps;
	}
	if (!amountInInput) {
		const chainState = new ChainStateClient(env.CHAIN_RPC_URL, vaultAddress);
		const balanceWei = await chainState.getVaultBalance(profile.tokenIn);
		const derived = deriveAmountInWei(balanceWei, profile.maxTradeBps);
		debugLog(cycleId, "derived amountIn", {
			balanceWei: balanceWei.toString(),
			derivedWei: derived.toString(),
		});
		if (derived <= 0n) {
			throw new ORPCError("BAD_REQUEST", {
				message: "Vault has no available balance to trade",
			});
		}
		amountInInput = derived.toString();
	}

	const effectiveAmountIn = requireString(amountInInput, "amountIn");
	const effectiveMaxSlippageBps = requireNumber(
		maxSlippageBps,
		"maxSlippageBps"
	);
	debugLog(cycleId, "effective params", {
		amountInWei: effectiveAmountIn,
		maxSlippageBps: effectiveMaxSlippageBps,
	});

	const amountIn = BigInt(effectiveAmountIn);
	const state = await context.services.getState(
		{ amountIn, tokenIn: "WETH", tokenOut: "USDC" },
		vaultConfig
	);
	debugLog(cycleId, "state loaded", {
		vaultBalanceWei: state.vaultBalanceWei.toString(),
		requestedAmountInWei: state.requestedAmountInWei.toString(),
	});

	const proposal = await context.services.generateProposal(state, vaultConfig);
	debugLog(cycleId, "proposal", {
		action: proposal.action,
		tokenIn: proposal.tokenIn,
		tokenOut: proposal.tokenOut,
		amountInWei: proposal.amountInWei,
	});

	const deterministicRisk = await context.services.evaluateRisk(
		proposal,
		state,
		vaultConfig
	);
	debugLog(cycleId, "deterministic risk", deterministicRisk);
	const axlRisk = await context.services.sendToRiskAgent(proposal);
	debugLog(cycleId, "axl risk", axlRisk);

	const riskDecision =
		deterministicRisk.decision === "APPROVE" && axlRisk.decision === "APPROVE"
			? axlRisk
			: {
					decision: "REJECT" as const,
					reason: `deterministic=${deterministicRisk.decision}:${deterministicRisk.reason};axl=${axlRisk.decision}:${axlRisk.reason}`,
				};
	debugLog(cycleId, "final risk decision", riskDecision);

	let execution: KeeperExecutionResult | null = null;
	let route: CycleLogRecord["route"] = null;

	if (!input.dryRun && riskDecision.decision === "APPROVE") {
		const routeResult = await context.services.buildRoute(
			proposal,
			effectiveMaxSlippageBps,
			vaultConfig
		);
		debugLog(cycleId, "route built", {
			target: routeResult.target,
			amountIn: routeResult.amountIn.toString(),
			amountOutMinimum: routeResult.amountOutMinimum.toString(),
			quoteOut: routeResult.quoteOut.toString(),
			tokenIn: routeResult.tokenIn,
			tokenOut: routeResult.tokenOut,
		});

		route = {
			target: routeResult.target,
			tokenIn: routeResult.tokenIn,
			tokenOut: proposal.tokenOut,
			amountIn: routeResult.amountIn.toString(),
			amountOutMinimum: routeResult.amountOutMinimum.toString(),
			quoteOut: routeResult.quoteOut.toString(),
		};

		execution = await context.services.executeVaultTrade({
			route: routeResult,
			tokenOut: proposal.tokenOut,
			vaultConfig,
		});
		debugLog(cycleId, "execution result", execution);

		if (execution.status !== "completed" || !execution.txHash) {
			throw new ORPCError("INTERNAL_SERVER_ERROR", {
				message: execution.error ?? "Execution did not return a tx hash",
				data: { executionId: execution.executionId, status: execution.status },
			});
		}
	}

	const logPointer = await context.services.logCycle(
		sanitizeCycleLogRecord({
			cycleId,
			timestamp: new Date().toISOString(),
			input: {
				...input,
				amountIn: effectiveAmountIn,
				maxSlippageBps: effectiveMaxSlippageBps,
			},
			proposal,
			riskDecision,
			execution,
			route,
		}),
		vaultConfig
	);
	debugLog(cycleId, "cycle logged", { logPointer });

	let displayReason: string | null = null;
	if (riskDecision.decision === "REJECT") {
		displayReason =
			deterministicRisk.decision === "REJECT"
				? deterministicRisk.reason
				: axlRisk.reason;
	}

	debugLog(cycleId, "success", {
		ms: Date.now() - startedAt,
		decision: riskDecision.decision,
		txHash: execution?.txHash ?? null,
	});

	return {
		cycleId,
		decision: riskDecision.decision,
		reason: displayReason,
		executionId: execution?.executionId ?? null,
		txHash: execution?.txHash ?? null,
		logPointer,
	};
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

			return user.vaults.map((vault) => ({
				id: vault.id,
				name: vault.agentProfile?.name ?? "Unnamed Vault",
				status: vault.status,
				riskScore: vault.agentProfile?.maxTradeBps ?? 50,
				maxSlippageBps: vault.agentProfile?.maxSlippageBps ?? 100,
				vaultAddress: vault.vaultAddress ?? null,
				tokenIn: vault.agentProfile?.tokenIn ?? null,
				tokenOut: vault.agentProfile?.tokenOut ?? null,
			}));
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
					maxTradeBps: input.maxTradeBps,
					maxSlippageBps: input.maxSlippageBps,
					tokenIn: input.tokenIn,
					tokenOut: input.tokenOut,
					memoryPointer: `auto-vault-${vault.id}`,
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
				usdcWei: balances.usdcWei.toString(),
				wethWei: balances.wethWei.toString(),
			};
		}),
};

export type AppRouter = typeof appRouter;
