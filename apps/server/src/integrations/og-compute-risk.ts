import type { RiskDecision, TradeProposal } from "@auto/api/trade-types";
import { env } from "@auto/env/server";
import { integrationDebugLog } from "../router/debug";

const TRAILING_SLASH_RE = /\/$/;
const JSON_CODE_FENCE_RE = /^```(?:json)?\s*([\s\S]*?)```$/m;

const RISK_SYSTEM_PROMPT = `You are an independent risk auditor for an autonomous vault trading agent.
The primary LLM (Gemini) produced a JSON trade proposal. A deterministic rules engine already evaluated basic constraints.
Your job: verify the proposal is internally consistent, safe, and not obviously wrong or adversarial
(e.g. token addresses that do not match stated action, absurd amounts, contradictory reasoning).
Respond with ONLY a JSON object (no markdown): {"decision":"APPROVE"|"REJECT","reason":"<one short sentence>"}`;

const stripJsonFence = (text: string): string => {
	const trimmed = text.trim();
	const fence = JSON_CODE_FENCE_RE.exec(trimmed);
	if (fence?.[1]) {
		return fence[1].trim();
	}
	return trimmed;
};

/**
 * Secondary risk pass via **0G Compute Router** (OpenAI-compatible `/chat/completions`).
 * Audits Gemini's proposal after the deterministic gate passes.
 */
export async function verifyProposalWithOgComputeRouter(
	proposal: TradeProposal,
	deterministicRisk: RiskDecision,
	options?: { cycleId?: string }
): Promise<RiskDecision> {
	const cycleId = options?.cycleId ?? "risk";
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

	const userPayload = JSON.stringify({ proposal, deterministicRisk }, null, 0);

	const controller = new AbortController();
	const timeoutMs = 25_000;
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const body: Record<string, unknown> = {
			model: env.OG_COMPUTE_ROUTER_MODEL,
			messages: [
				{ content: RISK_SYSTEM_PROMPT, role: "system" },
				{
					content: `Audit this trade proposal and deterministic gate output:\n${userPayload}`,
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
			integrationDebugLog(cycleId, "0G Compute", "router error", {
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
				reason: "0G risk verifier returned non-JSON output",
			};
		}

		if (parsed.decision !== "APPROVE" && parsed.decision !== "REJECT") {
			return {
				decision: "REJECT",
				reason: "0G risk verifier JSON missing APPROVE/REJECT",
			};
		}

		const reason =
			typeof parsed.reason === "string" && parsed.reason.trim().length > 0
				? parsed.reason.trim()
				: "0G Compute risk verification";

		integrationDebugLog(cycleId, "0G Compute", "risk verdict", {
			decision: parsed.decision,
			reasonPreview: reason.slice(0, 200),
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

/** Lightweight reachability check for `/diagnostics` (OpenAI-style catalog). */
export async function pingOgComputeRouter(): Promise<boolean> {
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
