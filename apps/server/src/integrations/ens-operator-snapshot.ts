import type { CycleLogRecord } from "@auto/api/trade-types";
import { env } from "@auto/env/server";
import { type Address, createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import { normalize } from "viem/ens";

const defaultMainnetHttp = mainnet.rpcUrls.default.http[0];

const ensPublicClient = createPublicClient({
	chain: mainnet,
	transport: http(env.ETH_MAINNET_RPC_URL ?? defaultMainnetHttp),
});

export async function trySnapshotOperatorEns(
	walletAddress: Address
): Promise<CycleLogRecord["operatorEns"] | undefined> {
	try {
		const primaryName = await ensPublicClient.getEnsName({
			address: walletAddress,
		});
		if (!primaryName) {
			return;
		}
		const name = normalize(primaryName);
		const avatarUrl = (await ensPublicClient.getEnsAvatar({ name })) ?? null;
		return { avatarUrl, primaryName: name };
	} catch {
		return;
	}
}
