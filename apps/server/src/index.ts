import { randomUUID } from "node:crypto";
import { runTradeCycleInputSchema } from "@auto/api/trade-types";
import { env } from "@auto/env/server";
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

// Debug middleware for POST requests
app.use("/rpc/*", async (c, next) => {
	if (c.req.method === "POST") {
		console.log("[DEBUG] Request headers:", Object.fromEntries(c.req.raw.headers.entries()));
		try {
			const cloned = c.req.raw.clone();
			const body = await cloned.text();
			console.log("[DEBUG] Raw body:", body);
		} catch (e) {
			console.log("[DEBUG] Could not read body:", e);
		}
	}
	await next();
});

// Health check
app.get("/", (c) => c.text("OK"));

// Diagnostics endpoint
app.get("/diagnostics", async (c) => {
	const diagnostics = await integrationServices.getDiagnostics();
	return c.json(diagnostics, diagnostics.ok ? 200 : 503);
});

// Run trade cycle endpoint
app.post("/rpc/runTradeCycle", async (c) => {
	// Manual body parsing
	let body: unknown;
	try {
		body = await c.req.json();
		console.log("[DEBUG] Parsed body:", body);
	} catch (e) {
		console.log("[DEBUG] Failed to parse JSON body:", e);
		return c.json({ error: "Invalid JSON body" }, 400);
	}

	// Validate with Zod
	const parseResult = runTradeCycleInputSchema.safeParse(body);
	if (!parseResult.success) {
		console.log("[DEBUG] Validation failed:", parseResult.error.issues);
		return c.json({ error: "Validation failed", issues: parseResult.error.issues }, 400);
	}

	const input = parseResult.data;
	console.log("[DEBUG] Validated input:", input);
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
