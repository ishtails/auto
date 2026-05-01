import { z } from "zod";

export const tradeActionSchema = z.enum(["BUY", "SELL", "HOLD"]);

export const tradeProposalSchema = z.object({
	action: tradeActionSchema,
	tokenIn: z.string(),
	tokenOut: z.string(),
	amountInWei: z.string(),
	reasoning: z.string().min(1),
});

export const riskDecisionSchema = z.object({
	decision: z.enum(["APPROVE", "REJECT"]),
	reason: z.string().min(1),
});

export const runTradeCycleInputSchema = z
	.object({
		amountIn: z.string().regex(/^\d+$/).optional(),
		maxSlippageBps: z.number().int().min(1).max(2000).optional(),
		dryRun: z.boolean().optional().default(false),
		vaultId: z.string().uuid().optional(),
	})
	.superRefine((value, context) => {
		if (!value.vaultId) {
			if (!value.amountIn) {
				context.addIssue({
					code: "custom",
					message: "amountIn is required when vaultId is not provided",
					path: ["amountIn"],
				});
			}
			if (value.maxSlippageBps === undefined) {
				context.addIssue({
					code: "custom",
					message: "maxSlippageBps is required when vaultId is not provided",
					path: ["maxSlippageBps"],
				});
			}
		}
	});

export type TradeProposal = z.infer<typeof tradeProposalSchema>;
export type RiskDecision = z.infer<typeof riskDecisionSchema>;
export type RunTradeCycleInput = z.infer<typeof runTradeCycleInputSchema>;

export interface RouteBuildResult {
	amountIn: bigint;
	amountOutMinimum: bigint;
	calldata: `0x${string}`;
	deadline: bigint;
	quoteOut: bigint;
	target: string;
	tokenIn: string;
	tokenOut: string;
	value: bigint;
}

export interface KeeperExecutionResult {
	error: string | null;
	executionId: string;
	status: "pending" | "completed" | "failed";
	txHash: string | null;
}

export interface CycleLogRecord {
	cycleId: string;
	execution: KeeperExecutionResult | null;
	input: RunTradeCycleInput;
	proposal: TradeProposal;
	riskDecision: RiskDecision;
	route: {
		target: string;
		tokenIn: string;
		tokenOut: string;
		amountIn: string;
		amountOutMinimum: string;
		quoteOut: string;
	} | null;
	timestamp: string;
}
