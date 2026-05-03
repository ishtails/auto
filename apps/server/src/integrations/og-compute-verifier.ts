/**
 * **0G Compute verifier stage** — standalone module for hackathon demos.
 * Runs a bounded **0G Compute Router** inference pass with **trading memory** and **proposal**
 * as separate, explicit inputs (same memory shape Gemini uses).
 *
 * @see https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/overview
 */
import type {
	LlmTradingMemoryEntry,
	RiskDecision,
	TradeProposal,
} from "@auto/api/trade-types";
import { env } from "@auto/env/server";
import { integrationDebugLog } from "../router/debug";

export const OG_COMPUTE_VERIFIER_STAGE_ID =
	"0g-compute-router:verifier-v1" as const;

const TRAILING_SLASH_RE = /\/$/;
const JSON_CODE_FENCE_RE = /^```(?:json)?\s*([\s\S]*?)```$/m;

const VERIFIER_SYSTEM_PROMPT = `You are the **verifier** stage of an autonomous vault trading agent pipeline.
Inference runs on **0G Compute** (OpenAI-compatible Router), not on the primary proposal model.

You receive two separate JSON payloads from the app:
1) **TRADING_MEMORY** — structured summaries of recent cycles (same data the primary LLM used for context).
2) **PROPOSAL_AND_GATE** — the primary model's JSON trade proposal plus the deterministic rules-engine verdict.

Your job: check internal consistency, safety, and obvious issues (bad addresses, absurd sizing, reasoning that contradicts memory or the gate).
Respond with ONLY a JSON object (no markdown): {"decision":"APPROVE"|"REJECT","reason":"<one short sentence>"}`;

const stripJsonFence = (text: string): string => {
	const trimmed = text.trim();
	const fence = JSON_CODE_FENCE_RE.exec(trimmed);
	if (fence?.[1]) {
		return fence[1].trim();
	}
	return trimmed;
};

export interface OgComputeVerifierInput {
	cycleId?: string;
	deterministicRisk: RiskDecision;
	proposal: TradeProposal;
	/** Same entries as fed to Gemini — explicit verifier input for demos. */
	tradingMemory: LlmTradingMemoryEntry[];
}

export async function runOgComputeVerifierStage(
	input: OgComputeVerifierInput
): Promise<RiskDecision> {
	const cycleId = input.cycleId ?? "verifier";
	const apiKey = env.OG_COMPUTE_ROUTER_API_KEY?.trim();
	if (!apiKey) {
		return {
			decision: "REJECT",
			reason:
				"0G Compute Router API key missing — set OG_COMPUTE_ROUTER_API_KEY or use MOCK_RISK_AGENT=true for local dev",
		};
	}

	const baseUrl = env.OG_COMPUTE_ROUTER_URL.replace(TRAILING_SLASH_RE, "");
	const url = `${baseUrl}/chat/completions`;

	const memoryPayload = JSON.stringify(input.tradingMemory, null, 0);
	const proposalPayload = JSON.stringify(
		{
			deterministicRisk: input.deterministicRisk,
			proposal: input.proposal,
		},
		null,
		0
	);

	const controller = new AbortController();
	const timeoutMs = 25_000;
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	try {
		integrationDebugLog(cycleId, "0G Compute", "verifier stage start", {
			stageId: OG_COMPUTE_VERIFIER_STAGE_ID,
			memoryEntries: input.tradingMemory.length,
		});

		const body: Record<string, unknown> = {
			model: env.OG_COMPUTE_ROUTER_MODEL,
			messages: [
				{ content: VERIFIER_SYSTEM_PROMPT, role: "system" },
				{
					content: [
						"=== TRADING_MEMORY (structured; same source as primary LLM) ===",
						memoryPayload,
						"",
						"=== PROPOSAL_AND_GATE ===",
						proposalPayload,
					].join("\n"),
					role: "user",
				},
			],
			temperature: 0,
		};
		if (env.OG_COMPUTE_ROUTER_JSON_MODE) {
			body.response_format = { type: "json_object" };
		}

		const res = await fetch(url, {
			body: JSON.stringify(body),
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			method: "POST",
			signal: controller.signal,
		});

		if (!res.ok) {
			const text = await res.text().catch(() => "");
			integrationDebugLog(cycleId, "0G Compute", "verifier router error", {
				bodyPreview: text.slice(0, 400),
				status: res.status,
			});
			return {
				decision: "REJECT",
				reason: `0G Compute Router HTTP ${res.status}: ${text.slice(0, 180)}`,
			};
		}

		const data = (await res.json()) as {
			choices?: Array<{ message?: { content?: string } }>;
		};
		const raw = data.choices?.[0]?.message?.content;
		if (!raw) {
			return {
				decision: "REJECT",
				reason: "0G Compute Router returned empty completion",
			};
		}

		let parsed: { decision?: string; reason?: string };
		try {
			parsed = JSON.parse(stripJsonFence(raw)) as {
				decision?: string;
				reason?: string;
			};
		} catch {
			return {
				decision: "REJECT",
				reason: "0G Compute verifier returned non-JSON output",
			};
		}

		if (parsed.decision !== "APPROVE" && parsed.decision !== "REJECT") {
			return {
				decision: "REJECT",
				reason: "0G Compute verifier JSON missing APPROVE/REJECT",
			};
		}

		const reason =
			typeof parsed.reason === "string" && parsed.reason.trim().length > 0
				? parsed.reason.trim()
				: "0G Compute verification";

		integrationDebugLog(cycleId, "0G Compute", "verifier stage verdict", {
			decision: parsed.decision,
			reasonPreview: reason.slice(0, 200),
			stageId: OG_COMPUTE_VERIFIER_STAGE_ID,
		});

		return {
			decision: parsed.decision,
			reason,
		};
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		return {
			decision: "REJECT",
			reason: `0G Compute Router request failed: ${msg}`,
		};
	} finally {
		clearTimeout(timeout);
	}
}

/** Reachability for `/diagnostics` (OpenAI-style model catalog). */
export async function pingOgComputeVerifierRouter(): Promise<boolean> {
	const apiKey = env.OG_COMPUTE_ROUTER_API_KEY?.trim();
	if (!apiKey) {
		return false;
	}
	const baseUrl = env.OG_COMPUTE_ROUTER_URL.replace(TRAILING_SLASH_RE, "");
	try {
		const res = await fetch(`${baseUrl}/models`, {
			headers: { Authorization: `Bearer ${apiKey}` },
			method: "GET",
			signal: AbortSignal.timeout(8000),
		});
		return res.ok;
	} catch {
		return false;
	}
}
