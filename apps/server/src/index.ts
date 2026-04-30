import { randomUUID } from "node:crypto";
import { runTradeCycleInputSchema } from "@auto/api/trade-types";
import { env } from "@auto/env/server";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { createIntegrationServices } from "./services/trade-cycle-services";

const app = new Hono();
const integrationServices = createIntegrationServices();

app.use(logger());
app.use(
	"/*",
	cors({
		origin: env.CORS_ORIGIN,
		allowMethods: ["GET", "POST", "OPTIONS"],
	})
);

// Health check
app.get("/", (c) => c.text("OK"));

// Diagnostics endpoint
app.get("/diagnostics", async (c) => {
	const diagnostics = await integrationServices.getDiagnostics();
	return c.json(diagnostics, diagnostics.ok ? 200 : 503);
});

// Run trade cycle endpoint
app.post(
	"/rpc/runTradeCycle",
	zValidator("json", runTradeCycleInputSchema),
	async (c) => {
		const input = c.req.valid("json");
		const cycleId = randomUUID();
		const amountIn = BigInt(input.amountIn);

		// Get state
		const state = await integrationServices.getState({
			amountIn,
			tokenIn: "WETH",
			tokenOut: "USDC",
		});

		// Generate proposal
		const proposal = await integrationServices.generateProposal(state);

		// Evaluate risk (deterministic)
		const deterministicRisk = await integrationServices.evaluateRisk(
			proposal,
			state
		);

		// Get AXL risk decision
		const axlRisk = await integrationServices.sendToRiskAgent(proposal);

		// Combine risk decisions
		const riskDecision =
			deterministicRisk.decision === "APPROVE" && axlRisk.decision === "APPROVE"
				? axlRisk
				: {
						decision: "REJECT" as const,
						reason: `deterministic=${deterministicRisk.decision}:${deterministicRisk.reason};axl=${axlRisk.decision}:${axlRisk.reason}`,
					};

		let execution: {
			executionId: string;
			status: "pending" | "completed" | "failed";
			txHash: string | null;
			error: string | null;
		} | null = null;
		let route: {
			target: string;
			tokenIn: string;
			tokenOut: string;
			amountIn: string;
			amountOutMinimum: string;
			quoteOut: string;
		} | null = null;

		// Execute if approved and not dry run
		if (!input.dryRun && riskDecision.decision === "APPROVE") {
			const routeResult = await integrationServices.buildRoute(
				proposal,
				input.maxSlippageBps
			);
			route = {
				target: routeResult.target,
				tokenIn: routeResult.tokenIn,
				tokenOut: proposal.tokenOut,
				amountIn: routeResult.amountIn.toString(),
				amountOutMinimum: routeResult.amountOutMinimum.toString(),
				quoteOut: routeResult.quoteOut.toString(),
			};
			execution = await integrationServices.executeVaultTrade({
				route: routeResult,
				tokenOut: proposal.tokenOut,
			});
		}

		// Log cycle
		const logPointer = await integrationServices.logCycle({
			cycleId,
			timestamp: new Date().toISOString(),
			input,
			proposal,
			riskDecision,
			execution,
			route,
		});

		return c.json({
			cycleId,
			decision: riskDecision.decision,
			executionId: execution?.executionId ?? null,
			txHash: execution?.txHash ?? null,
			logPointer,
		});
	}
);

export default app;
