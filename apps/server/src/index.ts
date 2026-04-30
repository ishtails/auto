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

	try {
		const cycleId = randomUUID();
		const amountIn = BigInt(input.amountIn);

		console.log("[DEBUG] Step 1: Getting state...");
		const state = await integrationServices.getState({
			amountIn,
			tokenIn: "WETH",
			tokenOut: "USDC",
		});
		console.log("[DEBUG] State:", state);

		console.log("[DEBUG] Step 2: Generating proposal...");
		const proposal = await integrationServices.generateProposal(state);
		console.log("[DEBUG] Proposal:", proposal);

		console.log("[DEBUG] Step 3: Evaluating risk...");
		const deterministicRisk = await integrationServices.evaluateRisk(
			proposal,
			state
		);
		console.log("[DEBUG] Risk:", deterministicRisk);

		console.log("[DEBUG] Step 4: Sending to AXL...");
		const axlRisk = await integrationServices.sendToRiskAgent(proposal);
		console.log("[DEBUG] AXL risk:", axlRisk);

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
			console.log("[DEBUG] Step 5: Building route...");
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

			console.log("[DEBUG] Step 6: Executing trade...");
			execution = await integrationServices.executeVaultTrade({
				route: routeResult,
				tokenOut: proposal.tokenOut,
			});
			console.log("[DEBUG] Execution:", execution);
		}

		console.log("[DEBUG] Step 7: Logging cycle...");
		const logPointer = await integrationServices.logCycle({
			cycleId,
			timestamp: new Date().toISOString(),
			input,
			proposal,
			riskDecision,
			execution,
			route,
		});
		console.log("[DEBUG] Log pointer:", logPointer);

		return c.json({
			cycleId,
			decision: riskDecision.decision,
			executionId: execution?.executionId ?? null,
			txHash: execution?.txHash ?? null,
			logPointer,
		});
	} catch (error) {
		console.error("[DEBUG] Error in trade cycle:", error);
		throw error;
	}
	}
);

export default app;
