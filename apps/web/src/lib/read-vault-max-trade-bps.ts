import { USER_VAULT_ABI } from "@auto/contracts/factory-definitions";
import { type Address, createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";

export const vaultMaxTradeBpsQueryKey = (vaultAddress: string) =>
	["vault-max-trade-bps", vaultAddress.toLowerCase()] as const;

/** Read `UserVault.maxTradeSizeBps` — client-side source of truth for risk UI. */
export async function readVaultMaxTradeSizeBps(
	vaultAddress: Address
): Promise<number> {
	const publicClient = createPublicClient({
		chain: baseSepolia,
		transport: http(),
	});
	const bps = await publicClient.readContract({
		abi: USER_VAULT_ABI,
		address: vaultAddress,
		functionName: "maxTradeSizeBps",
	});
	return Number(bps);
}
