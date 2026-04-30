import type { RiskDecision, TradeProposal } from "@auto/api/trade-types";
import { riskDecisionSchema } from "@auto/api/trade-types";

interface AxlRecvResponse {
	message?: unknown;
}

export class AxlTransport {
	private readonly riskPeerId: string;
	private readonly tradingApiUrl: string;

	constructor(tradingApiUrl: string, _riskApiUrl: string, riskPeerId: string) {
		this.tradingApiUrl = tradingApiUrl;
		this.riskPeerId = riskPeerId;
	}

	async sendProposal(proposal: TradeProposal): Promise<void> {
		const response = await fetch(`${this.tradingApiUrl}/send`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"X-Destination-Peer-Id": this.riskPeerId,
			},
			body: JSON.stringify(proposal),
		});
		if (!response.ok) {
			throw new Error(`AXL send failed: ${response.status}`);
		}
	}

	async receiveDecision(timeoutMs = 5000): Promise<RiskDecision> {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

		try {
			const response = await fetch(`${this.tradingApiUrl}/recv`, {
				method: "GET",
				signal: controller.signal,
			});
			clearTimeout(timeoutId);

			if (!response.ok) {
				console.log(
					`[AXL] recv returned ${response.status}, using default REJECT`
				);
				return {
					decision: "REJECT",
					reason: `AXL recv failed: ${response.status}`,
				};
			}

			const payload = (await response.json()) as AxlRecvResponse | null;
			console.log("[AXL] recv payload:", payload);

			if (!payload?.message) {
				console.log(
					"[AXL] No message received, using default APPROVE for testing"
				);
				return {
					decision: "APPROVE",
					reason: "No risk agent response (default approve for testing)",
				};
			}

			return riskDecisionSchema.parse(payload.message);
		} catch (error) {
			clearTimeout(timeoutId);
			if (error instanceof Error && error.name === "AbortError") {
				console.log("[AXL] recv timeout, using default APPROVE for testing");
				return {
					decision: "APPROVE",
					reason: "Risk agent timeout (default approve for testing)",
				};
			}
			throw error;
		}
	}
}
