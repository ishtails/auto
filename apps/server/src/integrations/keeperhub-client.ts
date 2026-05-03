import type { KeeperExecutionResult } from "@auto/api/trade-types";
import { integrationDebugLog } from "../router/debug";

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
		/** When set, execution and polling steps log under DEBUG run-trade-cycle. */
		cycleId?: string;
		functionArgs: string;
		functionName: string;
		network: string;
		value: string;
	}): Promise<KeeperExecutionResult> {
		integrationDebugLog(
			input.cycleId,
			"Keeper Hub",
			"POST /api/execute/contract-call",
			{
				contract: input.contractAddress,
				functionName: input.functionName,
				network: input.network,
			}
		);

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
			integrationDebugLog(
				input.cycleId,
				"Keeper Hub",
				"contract-call HTTP error",
				{
					status: response.status,
				}
			);
			return {
				executionId: "n/a",
				status: "failed",
				txHash: null,
				error: `keeperhub execute failed: ${response.status}`,
			};
		}

		const payload = (await response.json()) as ExecuteResponse;
		const executionId = payload.executionId ?? "unknown";
		integrationDebugLog(input.cycleId, "Keeper Hub", "contract-call accepted", {
			executionId,
		});
		return this.pollExecutionStatus(executionId, input.cycleId);
	}

	async pollExecutionStatus(
		executionId: string,
		cycleId?: string
	): Promise<KeeperExecutionResult> {
		integrationDebugLog(cycleId, "Keeper Hub", "polling execution status", {
			executionId,
		});
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
				integrationDebugLog(
					cycleId,
					"Keeper Hub",
					"GET execution status HTTP error",
					{
						attempt: attempt + 1,
						executionId,
						status: response.status,
					}
				);
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
				integrationDebugLog(
					cycleId,
					"Keeper Hub",
					"execution finished (failed)",
					{
						error: payload.error ?? null,
						executionId,
						txHash,
					}
				);
				return {
					executionId,
					status: "failed",
					txHash,
					error: payload.error ?? null,
				};
			}
			if (status === "completed" && txHash) {
				integrationDebugLog(
					cycleId,
					"Keeper Hub",
					"execution finished (completed)",
					{
						executionId,
						txHash,
					}
				);
				return {
					executionId,
					status: "completed",
					txHash,
					error: payload.error ?? null,
				};
			}

			await new Promise((resolve) => setTimeout(resolve, 1000));
		}

		integrationDebugLog(cycleId, "Keeper Hub", "polling timeout (no tx hash)", {
			executionId,
		});
		return {
			executionId,
			status: "failed",
			txHash: null,
			error: "keeperhub polling timeout (tx hash unavailable)",
		};
	}
}
