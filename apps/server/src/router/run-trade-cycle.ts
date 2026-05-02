import type { IntegrationServices, VaultConfig } from "@auto/api/context";
import type {
	CycleLogRecord,
	KeeperExecutionResult,
	runTradeCycleInputSchema,
	runTradeCycleOutputSchema,
} from "@auto/api/trade-types";
import { env } from "@auto/env/server";
import { ORPCError } from "@orpc/server";
import type { z } from "zod";
import { ChainStateClient } from "../integrations/chain-state";
import { cacheCycleLogToDb } from "./cycle-log-cache";
import { sanitizeCycleLogRecord } from "./cycle-log-sanitize";
import { debugLog, requireNumber, requireString } from "./debug";
import { getOwnedActiveVault } from "./owned-vault";
import { buildRuleBasedFallbackProposal } from "./rule-based-fallback";

const deriveAmountInWei = (balanceWei: bigint, maxTradeBps: number): bigint => {
	const derived = (balanceWei * BigInt(maxTradeBps)) / 10_000n;
	return derived > balanceWei ? balanceWei : derived;
};

const resolveCycleMode = ({
	autopilotEnabled,
	requestedDryRun,
}: {
	autopilotEnabled: boolean;
	requestedDryRun: boolean | undefined;
}): CycleLogRecord["mode"] => {
	if (!autopilotEnabled) {
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
	autopilotEnabled,
	requestedDryRun,
}: {
	services: IntegrationServices;
	state: Awaited<ReturnType<IntegrationServices["getState"]>>;
	vaultConfig: VaultConfig;
	cycleId: string;
	autopilotEnabled: boolean;
	requestedDryRun: boolean | undefined;
}) => {
	try {
		const proposal = await services.generateProposal(state, vaultConfig);
		return { proposal, llmAvailable: true as const };
	} catch (error) {
		const err = error instanceof Error ? error : new Error(String(error));
		debugLog(cycleId, "llm failed", { message: err.message });
		// If Autopilot is enabled and this isn't a user-requested preview run, fall
		// back to a deterministic rule-based proposal instead of blocking execution.
		if (autopilotEnabled && !requestedDryRun) {
			const fallback = await buildRuleBasedFallbackProposal({
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

const resolveExecutionPlan = ({
	cycleId,
	effectiveDryRun,
	llmAvailable,
	proposalAction,
	riskDecision,
	autopilotEnabled,
	requestedDryRun,
}: {
	cycleId: string;
	effectiveDryRun: boolean;
	llmAvailable: boolean;
	proposalAction: CycleLogRecord["proposal"]["action"];
	riskDecision: { decision: "APPROVE" | "REJECT" };
	autopilotEnabled: boolean;
	requestedDryRun: boolean | undefined;
}) => {
	if (!llmAvailable) {
		debugLog(cycleId, "skipping execution: llm unavailable", {
			autopilotEnabled,
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

	const autopilotEnabled = Boolean(profile.autopilot);
	const effectiveDryRun = input.dryRun || !autopilotEnabled;
	const mode = resolveCycleMode({
		autopilotEnabled,
		requestedDryRun: input.dryRun,
	});

	debugLog(cycleId, "resolved vault", {
		vaultAddress,
		tokenIn: profile.tokenIn,
		tokenOut: profile.tokenOut,
		maxTradeBps: profile.maxTradeBps,
		defaultMaxSlippageBps: profile.maxSlippageBps,
		memoryPointer: profile.memoryPointer,
		autopilot: autopilotEnabled,
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

	const { proposal, llmAvailable } = await requireTradeProposal({
		services: context.services,
		state,
		vaultConfig,
		cycleId,
		autopilotEnabled,
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

	const { shouldExecute, dryRunForRecord } = resolveExecutionPlan({
		cycleId,
		effectiveDryRun,
		llmAvailable,
		proposalAction: proposal.action,
		riskDecision,
		autopilotEnabled,
		requestedDryRun: input.dryRun,
	});

	if (shouldExecute) {
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
		riskDecision,
		execution,
		route,
	});

	const logPointer = await context.services.logCycle(cycleRecord, vaultConfig);
	debugLog(cycleId, "cycle logged", { logPointer });

	await cacheCycleLogToDb({
		vaultId: input.vaultId,
		record: cycleRecord,
		logPointer,
		cycleId,
	});

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
