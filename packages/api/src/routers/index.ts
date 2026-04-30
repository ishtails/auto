import { randomUUID } from "node:crypto";
import type { RouterClient } from "@orpc/server";

import { publicProcedure } from "../index";
import {
	type CycleLogRecord,
	type KeeperExecutionResult,
	runTradeCycleInputSchema,
} from "../trade-types";

export const appRouter = {
	healthCheck: publicProcedure.handler(() => "OK"),
	integrationDiagnostics: publicProcedure.handler(async ({ context }) =>
		context.services.getDiagnostics()
	),
	runTradeCycle: publicProcedure
		.input(runTradeCycleInputSchema)
		.handler(async ({ context, input }) => {
			const cycleId = randomUUID();
			const amountIn = BigInt(input.amountIn);
			const state = await context.services.getState({
				amountIn,
				tokenIn: "WETH",
				tokenOut: "USDC",
			});
			const proposal = await context.services.generateProposal(state);
			const deterministicRisk = await context.services.evaluateRisk(
				proposal,
				state
			);
			const axlRisk = await context.services.sendToRiskAgent(proposal);
			const riskDecision =
				deterministicRisk.decision === "APPROVE" &&
				axlRisk.decision === "APPROVE"
					? axlRisk
					: {
							decision: "REJECT" as const,
							reason: `deterministic=${deterministicRisk.decision}:${deterministicRisk.reason};axl=${axlRisk.decision}:${axlRisk.reason}`,
						};

			let execution: KeeperExecutionResult | null = null;
			let route: CycleLogRecord["route"] = null;

			if (!input.dryRun && riskDecision.decision === "APPROVE") {
				const routeResult = await context.services.buildRoute(
					proposal,
					input.maxSlippageBps
				);
				console.log("[DEBUG] Route target:", routeResult.target);
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
				});
			}

			const logPointer = await context.services.logCycle({
				cycleId,
				timestamp: new Date().toISOString(),
				input,
				proposal,
				riskDecision,
				execution,
				route,
			});

			return {
				cycleId,
				decision: riskDecision.decision,
				executionId: execution?.executionId ?? null,
				txHash: execution?.txHash ?? null,
				logPointer,
			};
		}),
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
