import { z } from "zod";

export const prepareVaultDeploymentSchema = z.object({
	maxTradeSizeBps: z.number().int().min(1).max(10_000),
});

export const prepareVaultDeploymentOutputSchema = z.object({
	defaults: z.object({
		chainId: z.number().int(),
		factoryAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
		swapRouterAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
		tokenIn: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
		tokenOut: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
	}),
	signedConfigHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
	typedData: z.object({
		domain: z.object({
			name: z.string(),
			version: z.string(),
			chainId: z.number().int(),
			verifyingContract: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
		}),
		types: z.record(
			z.string(),
			z.array(z.object({ name: z.string(), type: z.string() }))
		),
		primaryType: z.string(),
		message: z.record(z.string(), z.unknown()),
	}),
});

export const createVaultDeploymentSchema = z.object({
	name: z.string().min(1).max(100),
	geminiSystemPrompt: z.string().min(1),
	executorEnabled: z.boolean().optional(),
	maxTradeBps: z.number().int().min(1).max(10_000),
	maxSlippageBps: z.number().int().min(1).max(10_000),
	tokenIn: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
	tokenOut: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
	signedConfigHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
	ownerSignature: z.string().startsWith("0x"),
	factoryAddress: z
		.string()
		.regex(/^0x[a-fA-F0-9]{40}$/)
		.optional(),
});

export type CreateVaultDeploymentInput = z.infer<
	typeof createVaultDeploymentSchema
>;

export const getVaultDeploymentSchema = z.object({
	deploymentId: z.string().uuid(),
});

export const getVaultDeploymentOutputSchema = z.object({
	deploymentId: z.string().uuid(),
	vaultId: z.string().uuid(),
	status: z.string(),
	txHash: z.string().nullable(),
	error: z.string().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export const getVaultBalancesSchema = z.object({
	vaultId: z.string().uuid(),
});

export const vaultTokenBalanceRowSchema = z.object({
	address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
	decimals: z.number().int().min(0).max(36),
	isHub: z.boolean(),
	key: z.string(),
	symbol: z.string(),
	wei: z.string().regex(/^\d+$/),
});

export const getVaultBalancesOutputSchema = z.object({
	hubTokenKey: z.string(),
	tokens: z.array(vaultTokenBalanceRowSchema),
	/** Legacy fields: hub (WETH) and USDC balances for sizing and older clients. */
	usdcWei: z.string().regex(/^\d+$/),
	wethWei: z.string().regex(/^\d+$/),
});

export type VaultTokenBalanceRow = z.infer<typeof vaultTokenBalanceRowSchema>;
export type GetVaultBalancesOutput = z.infer<
	typeof getVaultBalancesOutputSchema
>;

export const vaultSchema = z.object({
	id: z.string().uuid(),
	name: z.string(),
	status: z.string(),
	riskScore: z.number(),
	/** Agent profile max slippage in basis points (1 bps = 0.01%). */
	maxSlippageBps: z.number().int(),
	/** Live execution: cycles may swap on-chain when risk approves. */
	executorEnabled: z.boolean(),
	vaultAddress: z.string().nullable(),
	tokenIn: z.string().nullable(),
	tokenOut: z.string().nullable(),
	/** 0 = schedule off. Otherwise seconds between automated cycles. */
	scheduleCadenceSeconds: z.number().int(),
	/** ISO 8601 UTC when the next scheduled cycle runs, or null if off. */
	scheduleNextRunAt: z.string().nullable(),
});

export const listVaultsOutputSchema = z.array(vaultSchema);

export const setVaultExecutorEnabledSchema = z.object({
	vaultId: z.string().uuid(),
	executorEnabled: z.boolean(),
});

export const setVaultScheduleSchema = z.object({
	vaultId: z.string().uuid(),
	/** 0 turns schedule off. Otherwise must be a preset from `SCHEDULE_CADENCE_SECONDS`. */
	scheduleCadenceSeconds: z.number().int().min(0),
	/**
	 * Optional first run instant in UTC (ISO 8601). Client should send
	 * `new Date(localPick).toISOString()` so wall-clock is normalized to UTC.
	 * Ignored when `scheduleCadenceSeconds` is 0.
	 */
	firstRunAtUtc: z.string().min(1).optional(),
});

export const setVaultScheduleOutputSchema = z.object({
	ok: z.literal(true),
	scheduleNextRunAt: z.string().nullable(),
});

export const getVaultAgentProfileInputSchema = z.object({
	vaultId: z.string().uuid(),
});

export const vaultAgentProfileOutputSchema = z.object({
	geminiSystemPrompt: z.string(),
	maxSlippageBps: z.number().int(),
	/** Same as `listVaults` `riskScore`: max trade size in basis points. */
	maxTradeBps: z.number().int(),
	name: z.string(),
	tokenIn: z.string(),
	tokenOut: z.string(),
});

export const updateVaultAgentSettingsSchema = z.object({
	geminiSystemPrompt: z.string().min(1).max(24_000),
	maxSlippageBps: z.number().int().min(1).max(2000),
	maxTradeBps: z.number().int().min(1).max(10_000),
	name: z.string().min(1).max(100),
	tokenIn: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
	tokenOut: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
	vaultId: z.string().uuid(),
});

export const updateVaultAgentSettingsOutputSchema = z.object({
	ok: z.literal(true),
});
