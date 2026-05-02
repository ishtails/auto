import type { TradeProposal } from "@auto/api/trade-types";
import { tradeProposalSchema } from "@auto/api/trade-types";
import type { Schema } from "@google/genai";
import { GoogleGenAI, Type } from "@google/genai";

export interface LlmStateInput {
	allowlistLines: string[];
	/** Max spend from WETH hub slice (wei) for trades that spend WETH. */
	amountInWei: bigint;
	hubTokenAddress: string;
	mockTokenOut: string;
	portfolioSummary: string;
	priceHint?: string;
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

	private normalizeAndValidateProposal(
		parsed: TradeProposal,
		allowlist: Set<string>
	): TradeProposal {
		const tokenIn = parsed.tokenIn.toLowerCase();
		const tokenOut = parsed.tokenOut.toLowerCase();
		if (!allowlist.has(tokenIn)) {
			throw new Error(`LLM tokenIn not on allowlist: ${parsed.tokenIn}`);
		}
		if (!allowlist.has(tokenOut)) {
			throw new Error(`LLM tokenOut not on allowlist: ${parsed.tokenOut}`);
		}

		if (parsed.action === "HOLD") {
			return {
				...parsed,
				amountInWei: "0",
				tokenIn,
				tokenOut,
			};
		}

		return {
			...parsed,
			tokenIn,
			tokenOut,
		};
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
		userSystemPrompt?: string,
		allowlist?: Set<string>
	): Promise<TradeProposal> {
		const allow = allowlist ?? new Set<string>();

		if (this.mockMode) {
			console.log("[LLM] Mock mode enabled, returning predefined response");
			return this.normalizeAndValidateProposal(
				{
					action: "BUY",
					amountInWei: input.amountInWei.toString(),
					reasoning:
						"Mock LLM: strategic BUY from WETH hub into USDC for integration tests",
					tokenIn: input.hubTokenAddress,
					tokenOut: input.mockTokenOut,
				},
				allow
			);
		}

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
				"INSTRUCTIONS: Learn from your past trades. If your last trade failed due to slippage, be more conservative. If you just bought recently, consider holding. Use this history to make better decisions.",
				"=== END MEMORY ===",
			].join("\n");
		}

		const systemGuidance = [
			userSystemPrompt ? "=== USER INSTRUCTIONS ===" : undefined,
			userSystemPrompt ? userSystemPrompt.trim() : undefined,
			userSystemPrompt ? "=== END USER INSTRUCTIONS ===" : undefined,
			"",
			"ROLE: You are a multi-asset fund manager on Base Sepolia. You rotate among the allowlisted testnet tokens, using WETH as the liquidity hub.",
			"",
			"HARD RULES:",
			"- tokenIn and tokenOut MUST be copied EXACTLY from the ALLOWLIST testnet addresses (case-insensitive ok in JSON; use valid 0x addresses).",
			"- Never invent, substitute, or mainnet-swap addresses: execution is ONLY on testnet addresses listed.",
			"- MARKET CONTEXT is from Base MAINNET for price/liquidity signal only; it is NOT executable.",
			"",
			"ACTION SEMANTICS (exact-input swap):",
			"- BUY: acquire tokenOut by spending tokenIn (you choose direction, e.g. WETH → alt or stable → WETH).",
			"- SELL: spend tokenIn to receive tokenOut (same mechanics; name reflects risk-off vs risk-on intent).",
			'- HOLD: no swap. Set amountInWei to "0". tokenIn/tokenOut should still be valid allowlist addresses (e.g. hub vs a target you considered).',
			"",
			"SIZING:",
			`- When spending the hub token (WETH), prefer amountInWei <= maxSpendFromHubWei=${input.amountInWei.toString()}.`,
			"- When spending a non-hub token, use an amount consistent with that token's balance in PORTFOLIO (do not exceed what the vault likely holds).",
			"",
			"DECISION STYLE:",
			"- Use MAINNET reference data for momentum, volume, liquidity health; prefer HOLD when data is weak or contradictory.",
			"- Diversify: do not fixate on a single alt every cycle if memory and signals suggest rotation.",
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
			"=== ALLOWLIST (testnet execution addresses; ONLY these may appear as tokenIn/tokenOut) ===",
			...input.allowlistLines,
			"=== END ALLOWLIST ===",
			"",
			"=== PORTFOLIO (vault balances, Base Sepolia) ===",
			input.portfolioSummary,
			"=== END PORTFOLIO ===",
			"",
			`hubTokenAddress(WETH)=${input.hubTokenAddress}`,
			`maxSpendFromHubWei=${input.amountInWei.toString()}`,
			`priceHint=${input.priceHint ?? "unknown"}`,
			marketContext ? "" : undefined,
			marketContext ? marketContext : undefined,
			memoryContext,
			"",
			`schema={"action":"BUY|SELL|HOLD","tokenIn":"0x...","tokenOut":"0x...","amountInWei":"uint string","reasoning":"string"}`,
			"",
			'CRITICAL: For HOLD, amountInWei must be exactly "0".',
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

		let parsedRaw: unknown;
		try {
			parsedRaw = JSON.parse(text);
		} catch {
			throw new Error("Gemini returned invalid JSON.");
		}

		const parsed = tradeProposalSchema.parse(parsedRaw);
		return this.normalizeAndValidateProposal(parsed, allow);
	}
}
