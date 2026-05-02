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

	// HOLD is an approved no-op (mirrors server deterministic risk gate)
	if (proposal.action === "HOLD") {
		if (amount !== 0n) {
			return { decision: "REJECT", reason: "HOLD requires amountInWei=0" };
		}
		return {
			decision: "APPROVE",
			reason: "HOLD — no trade",
		};
	}

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

		if (response.status === 204) {
			// No content - queue is empty
			return;
		}

		if (!response.ok) {
			console.log(`[RiskAgent] recv returned ${response.status}`);
			return;
		}

		// AXL returns raw binary data
		const responseBuffer = await response.arrayBuffer();
		const responseText = new TextDecoder().decode(responseBuffer);

		if (!responseText) {
			return;
		}

		console.log(
			`[RiskAgent] Received raw data: ${responseText.slice(0, 100)}...`
		);

		let proposal: TradeProposal;
		try {
			proposal = JSON.parse(responseText) as TradeProposal;
		} catch (parseError) {
			console.log("[RiskAgent] Failed to parse message as JSON:", parseError);
			return;
		}

		console.log("[RiskAgent] Received proposal:", proposal);

		// Evaluate risk
		const decision = evaluateRisk(proposal);
		console.log("[RiskAgent] Decision:", decision);

		// Send decision back to trading peer as raw binary
		console.log(
			`[RiskAgent] Sending decision to ${TRADING_PEER_ID.slice(0, 16)}...`
		);
		const decisionBuffer = Buffer.from(JSON.stringify(decision));

		const sendResponse = await fetch(`${RISK_AGENT_API_URL}/send`, {
			method: "POST",
			headers: {
				"X-Destination-Peer-Id": TRADING_PEER_ID,
			},
			body: decisionBuffer,
		});

		if (sendResponse.ok) {
			console.log(
				`[RiskAgent] Sent decision to trading peer (${decisionBuffer.length} bytes)`
			);
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
const pollInterval = setInterval(pollForProposals, 2000);

// Handle shutdown gracefully
process.on("SIGTERM", () => {
	console.log("[RiskAgent] SIGTERM received, shutting down...");
	clearInterval(pollInterval);
	process.exit(0);
});

process.on("SIGINT", () => {
	console.log("[RiskAgent] SIGINT received, shutting down...");
	clearInterval(pollInterval);
	process.exit(0);
});

// Keep running
console.log("[RiskAgent] Polling for proposals every 2s...");
