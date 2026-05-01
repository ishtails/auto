import type { RouterClient } from "@orpc/server";
import { ORPCError } from "@orpc/server";
import type { VaultConfig } from "../context";
import { authedProcedure, publicProcedure } from "../index";
import {
	type CycleLogRecord,
	type KeeperExecutionResult,
	runTradeCycleInputSchema,
} from "../trade-types";
import {
	createVaultDeploymentSchema,
	getVaultBalancesOutputSchema,
	getVaultBalancesSchema,
	getVaultDeploymentOutputSchema,
	getVaultDeploymentSchema,
	listVaultsOutputSchema,
	prepareVaultDeploymentOutputSchema,
	prepareVaultDeploymentSchema,
} from "../vault-types";

// NOTE: This router is a template that gets extended by the server.
// The server implementation provides the actual handlers with DB access.
// This pattern allows the API package to define the contract while
// the server provides the implementation.

export const appRouterTemplate = {
	healthCheck: publicProcedure.handler(() => "OK"),

	vaultBalances: publicProcedure.handler(async ({ context }) => {
		const balances = await context.services.getVaultBalances();
		return {
			wethWei: balances.wethWei.toString(),
			usdcWei: balances.usdcWei.toString(),
		};
	}),

	integrationDiagnostics: publicProcedure.handler(async ({ context }) =>
		context.services.getDiagnostics()
	),

	prepareVaultDeployment: authedProcedure
		.input(prepareVaultDeploymentSchema)
		.output(prepareVaultDeploymentOutputSchema)
		.handler(() => {
			throw new ORPCError("NOT_IMPLEMENTED", {
				message: "Server must implement this procedure",
			});
		}),

	runTradeCycle: publicProcedure
		.input(runTradeCycleInputSchema)
		.handler(async ({ context, input }) => {
			const cycleId = crypto.randomUUID();
			if (!input.amountIn) {
				throw new ORPCError("BAD_REQUEST", { message: "amountIn is required" });
			}
			if (input.maxSlippageBps === undefined) {
				throw new ORPCError("BAD_REQUEST", {
					message: "maxSlippageBps is required",
				});
			}

			const amountIn = BigInt(input.amountIn);

			let vaultConfig: VaultConfig | undefined;
			if (input.vaultId) {
				if (!context.auth) {
					throw new ORPCError("UNAUTHORIZED", {
						message: "Vault execution requires auth",
					});
				}
				// Server implementation will override this with real vault lookup
				vaultConfig = undefined;
			}

			const state = await context.services.getState(
				{
					amountIn,
					tokenIn: "WETH",
					tokenOut: "USDC",
				},
				vaultConfig
			);

			const proposal = await context.services.generateProposal(
				state,
				vaultConfig
			);
			const deterministicRisk = await context.services.evaluateRisk(
				proposal,
				state,
				vaultConfig
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
					input.maxSlippageBps,
					vaultConfig
				);

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
			}

			const logPointer = await context.services.logCycle(
				{
					cycleId,
					timestamp: new Date().toISOString(),
					input,
					proposal,
					riskDecision,
					execution,
					route,
				},
				vaultConfig
			);

			let displayReason: string | null = null;
			if (riskDecision.decision === "REJECT") {
				displayReason =
					deterministicRisk.decision === "REJECT"
						? deterministicRisk.reason
						: axlRisk.reason;
			}

			return {
				cycleId,
				decision: riskDecision.decision,
				reason: displayReason,
				executionId: execution?.executionId ?? null,
				txHash: execution?.txHash ?? null,
				logPointer,
			};
		}),

	// ─── Vault Procedures (Server implements these with DB) ───────────

	me: authedProcedure.handler(() => {
		throw new ORPCError("NOT_IMPLEMENTED", {
			message: "Server must implement this procedure",
		});
	}),

	listVaults: authedProcedure.output(listVaultsOutputSchema).handler(() => {
		throw new ORPCError("NOT_IMPLEMENTED", {
			message: "Server must implement this procedure",
		});
	}),

	createVaultDeployment: authedProcedure
		.input(createVaultDeploymentSchema)
		.handler(() => {
			throw new ORPCError("NOT_IMPLEMENTED", {
				message: "Server must implement this procedure",
			});
		}),

	getVaultDeployment: authedProcedure
		.input(getVaultDeploymentSchema)
		.output(getVaultDeploymentOutputSchema)
		.handler(() => {
			throw new ORPCError("NOT_IMPLEMENTED", {
				message: "Server must implement this procedure",
			});
		}),

	getVaultBalancesByVaultId: authedProcedure
		.input(getVaultBalancesSchema)
		.output(getVaultBalancesOutputSchema)
		.handler(() => {
			throw new ORPCError("NOT_IMPLEMENTED", {
				message: "Server must implement this procedure",
			});
		}),
};

// Server will override these with actual implementations
export const appRouter = appRouterTemplate;
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
