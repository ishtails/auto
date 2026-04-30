import { createPublicClient, http } from "viem";

const vaultAbi = [
	{
		type: "function",
		name: "getVaultBalance",
		stateMutability: "view",
		inputs: [{ name: "token", type: "address" }],
		outputs: [{ name: "", type: "uint256" }],
	},
] as const;

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
			abi: vaultAbi,
			functionName: "getVaultBalance",
			args: [tokenAddress as `0x${string}`],
		});
	}
}
