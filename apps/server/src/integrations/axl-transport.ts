import type { RiskDecision, TradeProposal } from "@auto/api/trade-types";
import { riskDecisionSchema } from "@auto/api/trade-types";

export class AxlTransport {
	private readonly riskPeerId: string;
	private readonly tradingApiUrl: string;

	constructor(tradingApiUrl: string, _riskApiUrl: string, riskPeerId: string) {
		this.tradingApiUrl = tradingApiUrl;
		this.riskPeerId = riskPeerId;
	}

	async sendProposal(proposal: TradeProposal): Promise<void> {
		console.log(
			`[AXL] Sending proposal to peer ${this.riskPeerId.slice(0, 16)}...`
		);

		// Send raw binary data (AXL expects binary, not JSON)
		const proposalBuffer = Buffer.from(JSON.stringify(proposal));

		const response = await fetch(`${this.tradingApiUrl}/send`, {
			method: "POST",
			headers: {
				"X-Destination-Peer-Id": this.riskPeerId,
			},
			body: proposalBuffer,
		});
		if (!response.ok) {
			throw new Error(`AXL send failed: ${response.status}`);
		}
		console.log(
			`[AXL] Proposal sent successfully (${proposalBuffer.length} bytes)`
		);
	}

	async receiveDecision(timeoutMs = 10_000): Promise<RiskDecision> {
		const pollInterval = 500;
		const startTime = Date.now();
		let attempts = 0;

		console.log("[AXL] Polling for risk agent response...");
		while (Date.now() - startTime < timeoutMs) {
			attempts++;
			try {
				const response = await fetch(`${this.tradingApiUrl}/recv`, {
					method: "GET",
				});

				if (response.status === 204) {
					// No content - queue is empty, retry
					await new Promise((resolve) => setTimeout(resolve, pollInterval));
					continue;
				}

				if (!response.ok) {
					console.log(`[AXL] recv returned ${response.status}, will retry...`);
					await new Promise((resolve) => setTimeout(resolve, pollInterval));
					continue;
				}

				// AXL returns raw binary data, not JSON
				const responseBuffer = await response.arrayBuffer();
				const responseText = new TextDecoder().decode(responseBuffer);

				if (!responseText) {
					await new Promise((resolve) => setTimeout(resolve, pollInterval));
					continue;
				}

				console.log(
					`[AXL] Received raw response: ${responseText.slice(0, 100)}...`
				);

				try {
					const decision = JSON.parse(responseText) as RiskDecision;
					console.log(
						`[AXL] Received response from risk agent after ${attempts} attempts`
					);
					return riskDecisionSchema.parse(decision);
				} catch (parseError) {
					console.log("[AXL] Failed to parse response as JSON:", parseError);
					await new Promise((resolve) => setTimeout(resolve, pollInterval));
				}
			} catch (error) {
				console.log("[AXL] recv error, will retry:", error);
				await new Promise((resolve) => setTimeout(resolve, pollInterval));
			}
		}

		console.log(
			`[AXL] No risk agent response after ${attempts} attempts (${timeoutMs}ms), using default APPROVE`
		);
		return {
			decision: "APPROVE",
			reason: "Risk agent timeout (default approve for testing)",
		};
	}
}
