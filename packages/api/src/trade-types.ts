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

/** Trade cycles always target a user-owned vault (`vaultId`). */
export const runTradeCycleInputSchema = z.object({
	vaultId: z.string().uuid(),
	amountIn: z.string().regex(/^\d+$/).optional(),
	maxSlippageBps: z.number().int().min(1).max(2000).optional(),
	dryRun: z.boolean().optional().default(false),
});

export const runTradeCycleOutputSchema = z.object({
	cycleId: z.string().uuid(),
	decision: z.enum(["APPROVE", "REJECT"]),
	reason: z.string().nullable(),
	executionId: z.string().nullable(),
	txHash: z.string().nullable(),
	logPointer: z.string(),
});

export const cycleLogCursorSchema = z.object({
	occurredAt: z.string(),
	cycleId: z.string(),
});

export const getVaultCycleLogsInputSchema = z.object({
	vaultId: z.string().uuid(),
	limit: z.number().int().min(1).max(50).optional().default(10),
	cursor: cycleLogCursorSchema.optional(),
});

export const getVaultCycleLogsOutputSchema = z.object({
	items: z.array(
		z.object({
			record: z.unknown(),
			occurredAt: z.string(),
			cycleId: z.string(),
		})
	),
	nextCursor: cycleLogCursorSchema.nullable(),
});

export type TradeProposal = z.infer<typeof tradeProposalSchema>;
export type RiskDecision = z.infer<typeof riskDecisionSchema>;
export type RunTradeCycleInput = z.infer<typeof runTradeCycleInputSchema>;
export type RunTradeCycleOutput = z.infer<typeof runTradeCycleOutputSchema>;
export type GetVaultCycleLogsInput = z.infer<
	typeof getVaultCycleLogsInputSchema
>;
export type GetVaultCycleLogsOutput = z.infer<
	typeof getVaultCycleLogsOutputSchema
>;

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
	/**
	 * Optional human-readable agent identity (Basename / ENSIP-19) saved to the DB
	 * via `setVaultAgentBasename`. Included in durable 0G logs when present.
	 */
	agentBasename?: string | null;
	cycleId: string;
	execution: KeeperExecutionResult | null;
	input: RunTradeCycleInput;
	/** How this cycle was run (UI labeling). */
	mode?: "suggest" | "dryRun" | "live";
	/**
	 * Durable audit entry on **0G Storage (KV)** for this vault stream.
	 * Postgres mirrors the full row for fast UI; this is the canonical pointer + on-chain batch metadata when available.
	 */
	ogStorage?: {
		pointer: string;
		/** Merkle / batch root from the 0G SDK when the KV write completes. */
		rootHash?: string;
		/** L1 tx that committed the KV batch (Galileo / testnet explorer). */
		txHash?: string;
		/**
		 * **DA / file layer** — root from `MemData` + `Indexer.upload` (full cycle JSON envelope).
		 * Distinct from KV `rootHash` (small stream keys vs blob trace).
		 */
		daRootHash?: string;
		/** L1 tx for the DA blob submission. */
		daTxHash?: string;
		/** True while the KV row is committed but batch proof is still landing in Postgres. */
		pending?: boolean;
		/** Set when a background proof write fails after the HTTP cycle returned 200. */
		lastError?: string;
	};
	/**
	 * Best-effort L1 Ethereum ENS snapshot for the vault operator wallet at cycle time.
	 * Omitted when reverse resolution returns no primary name or RPC fails.
	 */
	operatorEns?: {
		avatarUrl: string | null;
		primaryName: string;
	};
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

/** High-level on-chain result for a past cycle (LLM trading memory). */
export type TradingMemoryExecutionOutcome = "completed" | "skipped" | "failed";

/**
 * One row of trading memory fed to the LLM. `riskDecision` is the risk gate only;
 * `executionOutcome` reflects whether a swap actually completed on-chain.
 */
export interface LlmTradingMemoryEntry {
	/** KeeperHub status when an execution object exists (e.g. completed, failed, pending). */
	executionKeeperStatus?: string;
	executionOutcome: TradingMemoryExecutionOutcome;
	mode: "suggest" | "dryRun" | "live" | "unknown";
	proposalAction: string;
	proposalAmountInWei: string;
	proposalTokenIn: string;
	proposalTokenOut: string;
	reasoning: string;
	riskDecision: "APPROVE" | "REJECT";
	routeAmountIn?: string;
	/** When a route was built (attempted or completed swap path). */
	routeTokenIn?: string;
	routeTokenOut?: string;
	/** Why no on-chain swap completed (when executionOutcome is skipped). */
	skipReason?: string;
	timestamp: string;
	txHashPresent: boolean;
}
