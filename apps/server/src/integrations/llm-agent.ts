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

	async generateProposal(
		input: LlmStateInput,
		memory?: {
			action: string;
			reasoning: string;
			timestamp: string;
			status: string;
		}[],
		marketContext?: string,
		userSystemPrompt?: string
	): Promise<TradeProposal> {
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

		// Build memory context if available
		let memoryContext = "";
		if (memory && memory.length > 0) {
			memoryContext = [
				"",
				"=== YOUR TRADING MEMORY (Last 5 Trades) ===",
				...memory.map(
					(m, i) =>
						`${i + 1}. [${m.timestamp}] Action: ${m.action} | Status: ${m.status} | Reasoning: ${m.reasoning}`
				),
				"",
				"INSTRUCTIONS: Learn from your past trades. If your last trade failed due to slippage, be more conservative. If you just bought 5 minutes ago, consider holding. Use this history to make better decisions.",
				"=== END MEMORY ===",
			].join("\n");
		}

		const systemGuidance = [
			userSystemPrompt ? "=== USER INSTRUCTIONS ===" : undefined,
			userSystemPrompt ? userSystemPrompt.trim() : undefined,
			userSystemPrompt ? "=== END USER INSTRUCTIONS ===" : undefined,
			"",
			"OPERATIONAL INSTRUCTIONS:",
			"- If MARKET CONTEXT is provided, use it to ground your action (trend, momentum, volume imbalance).",
			"- If MARKET CONTEXT is missing/unavailable, proceed using on-chain state + memory; mention uncertainty in reasoning.",
			"- Use MEMORY to avoid repeating recent mistakes and to avoid over-trading back-to-back.",
			"- Prefer HOLD when data is weak, contradictory, or liquidity/volume looks unhealthy.",
		]
			.filter(
				(line): line is string => typeof line === "string" && line.length > 0
			)
			.join("\n");

		const prompt = [
			"You are an autonomous trading agent with memory. Return strict JSON only.",
			"",
			systemGuidance,
			"",
			"TRADING RULES:",
			`- tokenIn=${input.tokenIn} is the token the vault CURRENTLY HOLDS (what we SELL)`,
			`- tokenOut=${input.tokenOut} is the token the vault WANTS TO ACQUIRE (what we BUY)`,
			"- Action BUY means: Buy more tokenOut by spending tokenIn",
			"- Action SELL means: Sell tokenIn to acquire tokenOut",
			"- Action HOLD means: Do nothing",
			"",
			`vaultBalanceWei=${input.vaultBalanceWei.toString()}`,
			`tokenIn=${input.tokenIn} (vault holds this - SELL)`,
			`tokenOut=${input.tokenOut} (vault wants this - BUY)`,
			`amountInWei=${input.amountInWei.toString()}`,
			`priceHint=${input.priceHint ?? "unknown"}`,
			marketContext ? "" : undefined,
			marketContext ? "=== MARKET CONTEXT (REAL-TIME) ===" : undefined,
			marketContext ? marketContext : undefined,
			marketContext ? "=== END MARKET CONTEXT ===" : undefined,
			memoryContext,
			"",
			`schema={"action":"BUY|SELL|HOLD","tokenIn":"0x...","tokenOut":"0x...","amountInWei":"uint","reasoning":"string"}`,
			"",
			"CRITICAL: Use the exact tokenIn and tokenOut addresses provided above. Do NOT swap them.",
		]
			.filter((line): line is string => typeof line === "string")
			.join("\n");

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
