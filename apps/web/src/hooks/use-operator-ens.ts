"use client";

import type { CycleLogRecord } from "@auto/api/trade-types";
import { env } from "@auto/env/web";
import { useQuery } from "@tanstack/react-query";
import { type Address, createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import { normalize } from "viem/ens";

const defaultMainnetHttp = mainnet.rpcUrls.default.http[0];

const ensPublicClient = createPublicClient({
	chain: mainnet,
	transport: http(env.NEXT_PUBLIC_ETH_MAINNET_RPC_URL ?? defaultMainnetHttp),
});

export type OperatorEnsProfile = NonNullable<CycleLogRecord["operatorEns"]>;

export function useOperatorEnsProfile(
	walletAddress: string | null | undefined
) {
	return useQuery({
		enabled: Boolean(walletAddress),
		queryFn: async (): Promise<OperatorEnsProfile | null> => {
			try {
				const address = walletAddress as Address;
				const primaryName = await ensPublicClient.getEnsName({ address });
				if (!primaryName) {
					return null;
				}
				const name = normalize(primaryName);
				const avatarUrl =
					(await ensPublicClient.getEnsAvatar({ name })) ?? null;
				return { avatarUrl, primaryName: name };
			} catch {
				return null;
			}
		},
		queryKey: ["operator-ens-profile", walletAddress ?? ""],
		staleTime: 300_000,
	});
}
