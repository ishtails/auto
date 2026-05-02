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
	autopilot: z.boolean().optional(),
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

export const getVaultBalancesOutputSchema = z.object({
	wethWei: z.string().regex(/^\d+$/),
	usdcWei: z.string().regex(/^\d+$/),
});

export const vaultSchema = z.object({
	id: z.string().uuid(),
	name: z.string(),
	status: z.string(),
	riskScore: z.number(),
	/** Agent profile max slippage in basis points (1 bps = 0.01%). */
	maxSlippageBps: z.number().int(),
	autopilot: z.boolean(),
	vaultAddress: z.string().nullable(),
	tokenIn: z.string().nullable(),
	tokenOut: z.string().nullable(),
});

export const listVaultsOutputSchema = z.array(vaultSchema);

export const setVaultAutopilotSchema = z.object({
	vaultId: z.string().uuid(),
	autopilot: z.boolean(),
});
