import { describe, expect, it } from "bun:test";
import { LlmAgent } from "../src/integrations/llm-agent";

describe("LlmAgent", () => {
	it("parses valid JSON response", async () => {
		const agent = new LlmAgent("gemini-1.5-flash", "test");
		(agent as any).ai = {
			models: {
				generateContent: async () => ({
					text: JSON.stringify({
						action: "BUY",
						tokenIn: "0x4200000000000000000000000000000000000006",
						tokenOut: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
						amountInWei: "1000",
						reasoning: "test",
					}),
				}),
			},
		};

		const proposal = await agent.generateProposal({
			vaultBalanceWei: 10_000n,
			tokenIn: "0x4200000000000000000000000000000000000006",
			tokenOut: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
			amountInWei: 1000n,
		});

		expect(proposal.action).toBe("BUY");
	});

	it("rejects malformed JSON", async () => {
		const agent = new LlmAgent("gemini-1.5-flash", "test");
		(agent as any).ai = {
			models: {
				generateContent: async () => ({
					text: "not-json",
				}),
			},
		};

		await expect(
			agent.generateProposal({
				vaultBalanceWei: 10_000n,
				tokenIn: "0x4200000000000000000000000000000000000006",
				tokenOut: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
				amountInWei: 1000n,
			})
		).rejects.toThrow("Gemini returned invalid JSON.");
	});
});
