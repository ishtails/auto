#!/usr/bin/env bun
/**
 * Simple Risk Agent for AXL P2P Network
 * Listens for trade proposals and sends back risk decisions
 */

const RISK_AGENT_API_URL =
	process.env.RISK_AGENT_API_URL ?? "http://127.0.0.1:9012";
const TRADING_PEER_ID =
	process.env.TRADING_PEER_ID ??
	"e4c7639088e9d4c7336c5442be665d1e4b13bbecb05572667fec2d6ab9737e61";

interface TradeProposal {
	action: "BUY" | "SELL" | "HOLD";
	amountInWei: string;
	reasoning: string;
	tokenIn: string;
	tokenOut: string;
}

interface RiskDecision {
	decision: "APPROVE" | "REJECT";
	reason: string;
}

// Simple risk evaluation (mirror of your deterministic risk logic)
function evaluateRisk(proposal: TradeProposal): RiskDecision {
	const amount = BigInt(proposal.amountInWei);

	// Reject HOLD actions
	if (proposal.action === "HOLD") {
		return { decision: "REJECT", reason: "HOLD action - no trade needed" };
	}

	// Reject if amount is 0
	if (amount <= 0n) {
		return { decision: "REJECT", reason: "amount must be positive" };
	}

	// Approve otherwise (in production, add more checks)
	return { decision: "APPROVE", reason: "Within risk parameters" };
}

async function pollForProposals() {
	try {
		const response = await fetch(`${RISK_AGENT_API_URL}/recv`, {
			method: "GET",
		});

		if (!response.ok) {
			if (response.status !== 204) {
				console.log(`[RiskAgent] recv returned ${response.status}`);
			}
			return;
		}

		const payload = (await response.json()) as { message?: TradeProposal } | null;

		if (!payload || !payload.message) {
			return;
		}

		const proposal = payload.message;
		console.log("[RiskAgent] Received proposal:", proposal);

		// Evaluate risk
		const decision = evaluateRisk(proposal);
		console.log("[RiskAgent] Decision:", decision);

		// Send decision back to trading peer
		const sendResponse = await fetch(`${RISK_AGENT_API_URL}/send`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"X-Destination-Peer-Id": TRADING_PEER_ID,
			},
			body: JSON.stringify(decision),
		});

		if (sendResponse.ok) {
			console.log("[RiskAgent] Sent decision to trading peer");
		} else {
			console.log(
				`[RiskAgent] Failed to send decision: ${sendResponse.status}`
			);
		}
	} catch (error) {
		console.error("[RiskAgent] Error polling:", error);
	}
}

console.log("[RiskAgent] Starting...");
console.log(`[RiskAgent] API URL: ${RISK_AGENT_API_URL}`);
console.log(`[RiskAgent] Trading peer: ${TRADING_PEER_ID}`);

// Poll every 2 seconds
setInterval(pollForProposals, 2000);

// Keep running
console.log("[RiskAgent] Polling for proposals every 2s...");
