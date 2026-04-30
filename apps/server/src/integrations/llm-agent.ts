import type { TradeProposal } from "@auto/api/trade-types";
import { tradeProposalSchema } from "@auto/api/trade-types";
import type { Schema } from "@google/genai";
import { GoogleGenAI, Type } from "@google/genai";

export interface LlmStateInput {
	amountInWei: bigint;
	priceHint?: string;
	tokenIn: string;
	tokenOut: string;
	vaultBalanceWei: bigint;
}

export class LlmAgent {
	private readonly ai: GoogleGenAI;
	private readonly model: string;
	private readonly mockMode: boolean;
	private readonly responseSchema: Schema = {
		type: Type.OBJECT,
		properties: {
			action: { type: Type.STRING, enum: ["BUY", "SELL", "HOLD"] },
			tokenIn: { type: Type.STRING },
			tokenOut: { type: Type.STRING },
			amountInWei: { type: Type.STRING },
			reasoning: { type: Type.STRING },
		},
		required: ["action", "tokenIn", "tokenOut", "amountInWei", "reasoning"],
	};

	constructor(model: string, apiKey: string, mockMode = false) {
		this.model = model;
		this.mockMode = mockMode;
		this.ai = new GoogleGenAI({ apiKey });
	}

	async generateProposal(input: LlmStateInput): Promise<TradeProposal> {
		// Mock mode: return predefined response without calling Gemini
		if (this.mockMode) {
			console.log("[LLM] Mock mode enabled, returning predefined response");
			return {
				action: "BUY",
				tokenIn: input.tokenIn,
				tokenOut: input.tokenOut,
				amountInWei: input.amountInWei.toString(),
				reasoning: "Mock LLM response for testing - executing strategic trade",
			};
		}

		const prompt = [
			"You are a trading agent. Return strict JSON only.",
			`vaultBalanceWei=${input.vaultBalanceWei.toString()}`,
			`tokenIn=${input.tokenIn}`,
			`tokenOut=${input.tokenOut}`,
			`amountInWei=${input.amountInWei.toString()}`,
			`priceHint=${input.priceHint ?? "unknown"}`,
			`schema={"action":"BUY|SELL|HOLD","tokenIn":"0x...","tokenOut":"0x...","amountInWei":"uint","reasoning":"string"}`,
		].join("\n");

		const response = await this.ai.models.generateContent({
			model: this.model,
			contents: prompt,
			config: {
				temperature: 0,
				responseMimeType: "application/json",
				responseSchema: this.responseSchema,
			},
		});

		const text = response.text?.trim();
		if (!text) {
			throw new Error("Gemini returned empty response.");
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			throw new Error("Gemini returned invalid JSON.");
		}

		return tradeProposalSchema.parse(parsed);
	}
}
