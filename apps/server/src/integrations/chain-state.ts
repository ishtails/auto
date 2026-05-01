import { USER_VAULT_ABI } from "@auto/contracts/factory-definitions";
import { createPublicClient, http } from "viem";

export class ChainStateClient {
	private readonly client;
	private readonly vaultAddress: `0x${string}`;

	constructor(rpcUrl: string, vaultAddress: string) {
		this.client = createPublicClient({
			transport: http(rpcUrl),
		});
		this.vaultAddress = vaultAddress as `0x${string}`;
	}

	getVaultBalance(tokenAddress: string): Promise<bigint> {
		return this.client.readContract({
			address: this.vaultAddress,
			abi: USER_VAULT_ABI,
			functionName: "getBalance",
			args: [tokenAddress as `0x${string}`],
		});
	}
}
