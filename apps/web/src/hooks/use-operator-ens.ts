"use client";

import type { CycleLogRecord } from "@auto/api/trade-types";
import { env } from "@auto/env/web";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { type Address, createPublicClient, http, isAddress } from "viem";
import { mainnet } from "viem/chains";
import { normalize } from "viem/ens";

const defaultMainnetHttp = mainnet.rpcUrls.default.http[0];

const ensPublicClient = createPublicClient({
	chain: mainnet,
	transport: http(env.NEXT_PUBLIC_ETH_MAINNET_RPC_URL ?? defaultMainnetHttp),
});

export type OperatorEnsProfile = NonNullable<CycleLogRecord["operatorEns"]>;

/** Minimal Privy user shape for collecting EVM addresses (avoid tight SDK coupling). */
type PrivyUserLike =
	| {
			wallet?: { address?: string };
			linkedAccounts?: readonly unknown[];
	  }
	| null
	| undefined;

function orderedCandidateAddresses(
	user: PrivyUserLike,
	wallets: readonly { address?: string }[]
): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	const push = (raw?: string | null) => {
		if (!(raw && isAddress(raw))) {
			return;
		}
		const lower = raw.toLowerCase();
		if (seen.has(lower)) {
			return;
		}
		seen.add(lower);
		out.push(raw);
	};

	push(user?.wallet?.address);
	for (const acc of user?.linkedAccounts ?? []) {
		if (acc && typeof acc === "object" && "address" in acc) {
			push((acc as { address?: string }).address);
		}
	}
	for (const w of wallets) {
		push(w.address);
	}
	return out;
}

/**
 * Resolve ENS **primary name** (reverse record) on Ethereum L1 for the first
 * linked / connected EVM address that has one set.
 *
 * Owning a name (e.g. `ishtails.eth`) is not enough — the name must be set as
 * primary for that address in [ENS](https://app.ens.domains).
 */
export function useOperatorEnsProfile(
	user: PrivyUserLike,
	wallets: readonly { address?: string }[]
) {
	const candidates = useMemo(
		() => orderedCandidateAddresses(user, wallets),
		[user, wallets]
	);

	return useQuery({
		enabled: candidates.length > 0,
		queryFn: async (): Promise<OperatorEnsProfile | null> => {
			for (const walletAddress of candidates) {
				try {
					const primaryName = await ensPublicClient.getEnsName({
						address: walletAddress as Address,
					});
					if (!primaryName) {
						continue;
					}
					const name = normalize(primaryName);
					const avatarUrl =
						(await ensPublicClient.getEnsAvatar({ name })) ?? null;
					return { avatarUrl, primaryName: name };
				} catch {
					// Ignore ENS/RPC errors for this address; try the next candidate.
				}
			}
			return null;
		},
		queryKey: ["operator-ens-profile", candidates.join(",")],
		staleTime: 300_000,
	});
}
