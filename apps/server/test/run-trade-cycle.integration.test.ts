import { describe, expect, it } from "bun:test";
import type { IntegrationServices } from "@auto/api/context";
import { appRouter } from "@auto/api/routers/index";

const getHandler = () => (appRouter.runTradeCycle as any)["~orpc"].handler;

describe("runTradeCycle integration (mocked services)", () => {
	it("returns execution payload when approved", async () => {
		const services: IntegrationServices = {
			getState: async () => ({
				requestedAmountInWei: 100n,
				vaultBalanceWei: 1_000n,
				priceHint: "ok",
			}),
			generateProposal: async () => ({
				action: "BUY",
				tokenIn: "0x4200000000000000000000000000000000000006",
				tokenOut: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
				amountInWei: "100",
				reasoning: "test",
			}),
			evaluateRisk: async () => ({ decision: "APPROVE", reason: "ok" }),
			sendToRiskAgent: async () => ({ decision: "APPROVE", reason: "ok" }),
			buildRoute: async () => ({
				target: "0x6fF5693b99212Da76ad316178A184AB56D299b43",
				tokenIn: "0x4200000000000000000000000000000000000006",
				amountIn: 100n,
				calldata: "0xabc",
				value: 0n,
				amountOutMinimum: 95n,
				quoteOut: 100n,
			}),
			executeVaultTrade: async () => ({
				executionId: "exec-1",
				status: "completed",
				txHash: "0xhash",
				error: null,
			}),
			logCycle: async () => "stream:cycle",
			getDiagnostics: async () => ({
				ok: true,
				keeperhub: true,
				axl: true,
				og: true,
			}),
		};

		const result = await getHandler()({
			context: { services },
			input: { amountIn: "100", maxSlippageBps: 100, dryRun: false },
		});

		expect(result.executionId).toBe("exec-1");
		expect(result.txHash).toBe("0xhash");
	});

	it("halts execution path when rejected", async () => {
		let executed = false;
		const services: IntegrationServices = {
			getState: async () => ({
				requestedAmountInWei: 100n,
				vaultBalanceWei: 1_000n,
				priceHint: "ok",
			}),
			generateProposal: async () => ({
				action: "BUY",
				tokenIn: "0x4200000000000000000000000000000000000006",
				tokenOut: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
				amountInWei: "100",
				reasoning: "test",
			}),
			evaluateRisk: async () => ({ decision: "REJECT", reason: "cap" }),
			sendToRiskAgent: async () => ({ decision: "APPROVE", reason: "ok" }),
			buildRoute: () => {
				executed = true;
				throw new Error("should not build route");
			},
			executeVaultTrade: () => {
				executed = true;
				throw new Error("should not execute");
			},
			logCycle: async () => "stream:cycle",
			getDiagnostics: async () => ({
				ok: true,
				keeperhub: true,
				axl: true,
				og: true,
			}),
		};

		const result = await getHandler()({
			context: { services },
			input: { amountIn: "100", maxSlippageBps: 100, dryRun: false },
		});

		expect(executed).toBe(false);
		expect(result.executionId).toBeNull();
		expect(result.decision).toBe("REJECT");
	});
});
