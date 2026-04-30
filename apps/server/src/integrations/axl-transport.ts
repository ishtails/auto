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

	async receiveDecision(): Promise<RiskDecision> {
		const response = await fetch(`${this.tradingApiUrl}/recv`, {
			method: "GET",
		});
		if (!response.ok) {
			throw new Error(`AXL recv failed: ${response.status}`);
		}
		const payload = (await response.json()) as AxlRecvResponse;
		return riskDecisionSchema.parse(payload.message);
	}
}
