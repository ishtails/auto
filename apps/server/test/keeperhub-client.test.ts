import { describe, expect, it, mock } from "bun:test";
import { KeeperHubClient } from "../src/integrations/keeperhub-client";

describe("KeeperHubClient", () => {
	it("submits and polls to completed status", async () => {
		const fetchMock = mock(
			async (_url: string) =>
				new Response(
					JSON.stringify({ executionId: "exec-1", status: "pending" }),
					{ status: 200 }
				)
		);

		let callCount = 0;
		(globalThis as { fetch: typeof fetch }).fetch = ((url: string) => {
			callCount += 1;
			if (url.includes("/status")) {
				return new Response(
					JSON.stringify({
						status: callCount > 2 ? "completed" : "pending",
						transactionHash: "0xabc",
					}),
					{ status: 200 }
				);
			}
			return fetchMock(url);
		}) as typeof fetch;

		const client = new KeeperHubClient("https://keeperhub.example", "key");
		const result = await client.executeContractCall({
			abi: "[]",
			contractAddress: "0x123",
			functionArgs: "[]",
			functionName: "executeTrade",
			network: "base",
			value: "0",
		});

		expect(result.status).toBe("completed");
		expect(result.txHash).toBe("0xabc");
	});
});
