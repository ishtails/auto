import type { IntegrationServices, VaultConfig } from "@auto/api/context";
import type {
	CycleLogRecord,
	KeeperExecutionResult,
	RiskDecision,
	runTradeCycleInputSchema,
	runTradeCycleOutputSchema,
} from "@auto/api/trade-types";
import { env } from "@auto/env/server";
import { ORPCError } from "@orpc/server";
import type { z } from "zod";
import { TOKENS } from "../config";
import { ChainStateClient } from "../integrations/chain-state";
import { enqueueOgCycleLogJob } from "../services/og-cycle-log-queue";
import { loadTradingMemoryEntries } from "../services/trading-memory-source";
import { cacheCycleLogToDb } from "./cycle-log-cache";
import { sanitizeCycleLogRecord } from "./cycle-log-sanitize";
import {
	debugLog,
	integrationDebugLog,
	requireNumber,
	requireString,
} from "./debug";
import { getOwnedActiveVault } from "./owned-vault";
import { buildRuleBasedFallbackProposal } from "./rule-based-fallback";

const deriveAmountInWei = (balanceWei: bigint, maxTradeBps: number): bigint => {
	const derived = (balanceWei * BigInt(maxTradeBps)) / 10_000n;
	return derived > balanceWei ? balanceWei : derived;
};

const resolveCycleMode = ({
	executorEnabled,
	requestedDryRun,
}: {
	executorEnabled: boolean;
	requestedDryRun: boolean | undefined;
}): CycleLogRecord["mode"] => {
	if (!executorEnabled) {
		return "suggest";
	}
	if (requestedDryRun) {
		return "dryRun";
	}
	return "live";
};

const requireTradeProposal = async ({
	services,
	state,
	vaultConfig,
	cycleId,
	executorEnabled,
	requestedDryRun,
}: {
	services: IntegrationServices;
	state: Awaited<ReturnType<IntegrationServices["getState"]>>;
	vaultConfig: VaultConfig;
	cycleId: string;
	executorEnabled: boolean;
	requestedDryRun: boolean | undefined;
}) => {
	try {
		const proposal = await services.generateProposal(state, vaultConfig);
		return { proposal, llmAvailable: true as const };
	} catch (error) {
		const err = error instanceof Error ? error : new Error(String(error));
		debugLog(cycleId, "llm failed", { message: err.message });
		// If executor (live) mode is on and this isn't a user-requested preview run, fall
		// back to HOLD instead of blocking the cycle entirely.
		if (executorEnabled && !requestedDryRun) {
			const fallback = buildRuleBasedFallbackProposal({
				cycleId,
				state,
			});
			debugLog(cycleId, "llm fallback proposal", fallback);
			return { proposal: fallback, llmAvailable: false as const };
		}

		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message:
				"The agent couldn’t generate a recommendation right now. Please try again.",
			data: { reason: err.message },
		});
	}
};

/** Risk text stored on cycle logs and shown in the app (no dev/mock placeholders). */
const buildUserFacingRiskDecision = (
	proposal: CycleLogRecord["proposal"],
	deterministicRisk: RiskDecision,
	computeRisk: RiskDecision,
	finalRisk: RiskDecision
): RiskDecision => {
	if (finalRisk.decision === "REJECT") {
		return {
			decision: "REJECT",
			reason:
				deterministicRisk.decision === "REJECT"
					? deterministicRisk.reason
					: computeRisk.reason,
		};
	}
	if (proposal.action === "HOLD") {
		return {
			decision: "APPROVE",
			reason: deterministicRisk.reason,
		};
	}
	if (env.MOCK_RISK_AGENT) {
		return {
			decision: "APPROVE",
			reason: deterministicRisk.reason,
		};
	}
	return {
		decision: "APPROVE",
		reason: computeRisk.reason,
	};
};

const resolveVaultRisk = async (args: {
	cycleId: string;
	proposal: CycleLogRecord["proposal"];
	services: IntegrationServices;
	state: Awaited<ReturnType<IntegrationServices["getState"]>>;
	vaultConfig: VaultConfig;
}): Promise<{
	computeRisk: RiskDecision;
	deterministicRisk: RiskDecision;
	logRiskDecision: RiskDecision;
	riskDecision: RiskDecision;
}> => {
	const { cycleId, proposal, services, state, vaultConfig } = args;
	const deterministicRisk = await services.evaluateRisk(
		proposal,
		state,
		vaultConfig
	);
	debugLog(cycleId, "deterministic risk", deterministicRisk);

	const tradingMemoryForVerifier =
		deterministicRisk.decision === "REJECT"
			? []
			: await loadTradingMemoryEntries(vaultConfig.memoryPointer);

	const computeRisk: RiskDecision =
		deterministicRisk.decision === "REJECT"
			? {
					decision: "REJECT",
					reason: "0G Compute verifier skipped (deterministic gate rejected)",
				}
			: await services.sendToRiskAgent(proposal, {
					cycleId,
					deterministicRisk,
					tradingMemory: tradingMemoryForVerifier,
				});
	debugLog(cycleId, "0g compute verifier", computeRisk);

	const riskDecision: RiskDecision =
		deterministicRisk.decision === "APPROVE" &&
		computeRisk.decision === "APPROVE"
			? computeRisk
			: {
					decision: "REJECT",
					reason:
						deterministicRisk.decision === "REJECT"
							? deterministicRisk.reason
							: `deterministic=${deterministicRisk.decision}:${deterministicRisk.reason};0g_compute=${computeRisk.decision}:${computeRisk.reason}`,
				};
	debugLog(cycleId, "final risk decision", riskDecision);

	const logRiskDecision = buildUserFacingRiskDecision(
		proposal,
		deterministicRisk,
		computeRisk,
		riskDecision
	);

	return {
		computeRisk,
		deterministicRisk,
		logRiskDecision,
		riskDecision,
	};
};

const resolveExecutionPlan = ({
	cycleId,
	effectiveDryRun,
	llmAvailable,
	proposalAction,
	riskDecision,
	executorEnabled,
	requestedDryRun,
}: {
	cycleId: string;
	effectiveDryRun: boolean;
	llmAvailable: boolean;
	proposalAction: CycleLogRecord["proposal"]["action"];
	riskDecision: { decision: "APPROVE" | "REJECT" };
	executorEnabled: boolean;
	requestedDryRun: boolean | undefined;
}) => {
	if (!llmAvailable) {
		debugLog(cycleId, "skipping execution: llm unavailable", {
			executorEnabled,
			requestedDryRun: requestedDryRun ?? null,
		});
	}

	if (!effectiveDryRun && proposalAction === "HOLD") {
		debugLog(cycleId, "skipping execution: proposal is HOLD", null);
	}

	const shouldExecute =
		!effectiveDryRun &&
		llmAvailable &&
		proposalAction !== "HOLD" &&
		riskDecision.decision === "APPROVE";

	const dryRunForRecord =
		effectiveDryRun || !llmAvailable || proposalAction === "HOLD";

	return { shouldExecute, dryRunForRecord };
};

export async function runTradeCycleInternal({
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

	const executorEnabled = Boolean(profile.executorEnabled);
	const effectiveDryRun = input.dryRun || !executorEnabled;
	const mode = resolveCycleMode({
		executorEnabled,
		requestedDryRun: input.dryRun,
	});

	debugLog(cycleId, "resolved vault", {
		vaultAddress,
		tokenIn: profile.tokenIn,
		tokenOut: profile.tokenOut,
		maxTradeBps: profile.maxTradeBps,
		defaultMaxSlippageBps: profile.maxSlippageBps,
		memoryPointer: profile.memoryPointer,
		executorEnabled,
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
		const balanceWei = await chainState.getVaultBalance(TOKENS.WETH.address);
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
		{ amountIn, maxTradeBps: profile.maxTradeBps },
		vaultConfig
	);
	debugLog(cycleId, "state loaded", {
		hubBalanceWei: state.vaultBalanceWei.toString(),
		requestedAmountInWei: state.requestedAmountInWei.toString(),
		maxTradeBps: state.maxTradeBps,
	});

	const { proposal, llmAvailable } = await requireTradeProposal({
		services: context.services,
		state,
		vaultConfig,
		cycleId,
		executorEnabled,
		requestedDryRun: input.dryRun,
	});
	debugLog(cycleId, "proposal", {
		action: proposal.action,
		tokenIn: proposal.tokenIn,
		tokenOut: proposal.tokenOut,
		amountInWei: proposal.amountInWei,
		reasoning: proposal.reasoning,
		llmAvailable,
	});

	const { computeRisk, deterministicRisk, logRiskDecision, riskDecision } =
		await resolveVaultRisk({
			cycleId,
			proposal,
			services: context.services,
			state,
			vaultConfig,
		});

	let execution: KeeperExecutionResult | null = null;
	let route: CycleLogRecord["route"] = null;

	const { shouldExecute, dryRunForRecord } = resolveExecutionPlan({
		cycleId,
		effectiveDryRun,
		llmAvailable,
		proposalAction: proposal.action,
		riskDecision,
		executorEnabled,
		requestedDryRun: input.dryRun,
	});

	if (shouldExecute) {
		const routeResult = await context.services.buildRoute(
			proposal,
			effectiveMaxSlippageBps,
			vaultConfig,
			{ cycleId }
		);
		integrationDebugLog(cycleId, "Uniswap", "route build complete", {
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
			cycleId,
			route: routeResult,
			tokenOut: proposal.tokenOut,
			vaultConfig,
		});
		integrationDebugLog(cycleId, "Keeper Hub", "execution result", execution);

		if (execution.status !== "completed" || !execution.txHash) {
			throw new ORPCError("INTERNAL_SERVER_ERROR", {
				message: execution.error ?? "Execution did not return a tx hash",
				data: { executionId: execution.executionId, status: execution.status },
			});
		}
	}

	const cycleRecord = sanitizeCycleLogRecord({
		cycleId,
		mode,
		timestamp: new Date().toISOString(),
		input: {
			...input,
			dryRun: dryRunForRecord,
			amountIn: effectiveAmountIn,
			maxSlippageBps: effectiveMaxSlippageBps,
		},
		proposal,
		riskDecision: logRiskDecision,
		execution,
		route,
	});

	const { logPointer } = await context.services.logCycle(
		cycleRecord,
		vaultConfig
	);
	debugLog(cycleId, "cycle log pointer derived", { logPointer });

	const recordForCache: CycleLogRecord = {
		...cycleRecord,
		ogStorage: {
			pointer: logPointer,
			pending: true,
		},
	};

	await cacheCycleLogToDb({
		cycleId,
		logPointer,
		record: recordForCache,
		vaultId: input.vaultId,
	});

	await enqueueOgCycleLogJob({
		memoryPointer: vaultConfig.memoryPointer,
		record: recordForCache,
		vaultId: input.vaultId,
	});
	debugLog(cycleId, "0G write job enqueued", { logPointer });

	let displayReason: string | null = null;
	if (riskDecision.decision === "REJECT") {
		displayReason =
			deterministicRisk.decision === "REJECT"
				? deterministicRisk.reason
				: computeRisk.reason;
	} else if (proposal.action === "HOLD") {
		displayReason = deterministicRisk.reason;
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
