import type { KeeperExecutionResult } from "@auto/api/trade-types";

interface ExecuteResponse {
	executionId?: string;
	status?: string;
}

interface StatusResponse {
	error?: string;
	status?: string;
	transactionHash?: string;
}

export class KeeperHubClient {
	private readonly apiKey: string;
	private readonly baseUrl: string;

	constructor(baseUrl: string, apiKey: string) {
		this.baseUrl = baseUrl;
		this.apiKey = apiKey;
	}

	private headers() {
		return {
			Authorization: `Bearer ${this.apiKey}`,
			"content-type": "application/json",
		};
	}

	async executeContractCall(input: {
		abi: string;
		contractAddress: string;
		functionArgs: string;
		functionName: string;
		network: string;
		value: string;
	}): Promise<KeeperExecutionResult> {
		const response = await fetch(`${this.baseUrl}/api/execute/contract-call`, {
			method: "POST",
			headers: this.headers(),
			body: JSON.stringify({
				abi: input.abi,
				contractAddress: input.contractAddress,
				functionArgs: input.functionArgs,
				functionName: input.functionName,
				gasLimitMultiplier: "1.2",
				network: input.network,
				value: input.value,
			}),
		});

		if (!response.ok) {
			return {
				executionId: "n/a",
				status: "failed",
				txHash: null,
				error: `keeperhub execute failed: ${response.status}`,
			};
		}

		const payload = (await response.json()) as ExecuteResponse;
		const executionId = payload.executionId ?? "unknown";
		return this.pollExecutionStatus(executionId);
	}

	async pollExecutionStatus(
		executionId: string
	): Promise<KeeperExecutionResult> {
		for (let attempt = 0; attempt < 20; attempt++) {
			const response = await fetch(
				`${this.baseUrl}/api/execute/${executionId}/status`,
				{
					headers: this.headers(),
				}
			);

			if (!response.ok) {
				return {
					executionId,
					status: "failed",
					txHash: null,
					error: `keeperhub status failed: ${response.status}`,
				};
			}

			const payload = (await response.json()) as StatusResponse;
			const status = payload.status?.toLowerCase();
			if (status === "completed" || status === "failed") {
				return {
					executionId,
					status: status as "completed" | "failed",
					txHash: payload.transactionHash ?? null,
					error: payload.error ?? null,
				};
			}

			await new Promise((resolve) => setTimeout(resolve, 1000));
		}

		return {
			executionId,
			status: "failed",
			txHash: null,
			error: "keeperhub polling timeout",
		};
	}
}
