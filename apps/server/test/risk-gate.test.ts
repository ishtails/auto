import { describe, expect, it } from "bun:test";
import { evaluateRisk } from "../src/integrations/risk-gate";

const baseProposal = {
	action: "BUY" as const,
	tokenIn: "0x4200000000000000000000000000000000000006",
	tokenOut: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
	amountInWei: "100",
	reasoning: "test",
};

describe("evaluateRisk", () => {
	it("rejects amount above 10% drawdown", () => {
		const result = evaluateRisk(
			{ ...baseProposal, amountInWei: "200" },
			{
				vaultBalanceWei: 1_000n,
				allowedTokens: new Set([baseProposal.tokenIn.toLowerCase()]),
				maxDrawdownBps: 1_000n,
			}
		);
		expect(result.decision).toBe("REJECT");
	});

	it("approves valid proposal", () => {
		const result = evaluateRisk(baseProposal, {
			vaultBalanceWei: 10_000n,
			allowedTokens: new Set([baseProposal.tokenIn.toLowerCase()]),
			maxDrawdownBps: 1_000n,
		});
		expect(result.decision).toBe("APPROVE");
	});
});
