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
		// We want to return a tx hash when possible, because the UI expects a
		// linkable transaction for "live" (non-dry-run) executions.
		for (let attempt = 0; attempt < 60; attempt++) {
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
			const txHash = payload.transactionHash ?? null;
			if (status === "failed") {
				return {
					executionId,
					status: "failed",
					txHash,
					error: payload.error ?? null,
				};
			}
			if (status === "completed" && txHash) {
				return {
					executionId,
					status: "completed",
					txHash,
					error: payload.error ?? null,
				};
			}

			await new Promise((resolve) => setTimeout(resolve, 1000));
		}

		return {
			executionId,
			status: "failed",
			txHash: null,
			error: "keeperhub polling timeout (tx hash unavailable)",
		};
	}
}
