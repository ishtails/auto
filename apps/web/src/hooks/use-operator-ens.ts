"use client";

import type { CycleLogRecord } from "@auto/api/trade-types";
import { env } from "@auto/env/web";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
	type Address,
	createPublicClient,
	http,
	isAddress,
	type PublicClient,
} from "viem";
import { mainnet } from "viem/chains";
import { getEnsName, normalize } from "viem/ens";

const defaultMainnetHttp = mainnet.rpcUrls.default.http[0];

const isOperatorEnsDebug =
	typeof process !== "undefined" && process.env.NODE_ENV === "development";

function debugOperatorEns(message: string, payload?: Record<string, unknown>) {
	if (!isOperatorEnsDebug) {
		return;
	}
	if (payload) {
		console.log(`[operator-ens-debug] ${message}`, payload);
	} else {
		console.log(`[operator-ens-debug] ${message}`);
	}
}

let mainnetEnsClient: PublicClient | null = null;

function getMainnetEnsClient(): PublicClient {
	if (!mainnetEnsClient) {
		mainnetEnsClient = createPublicClient({
			chain: mainnet,
			transport: http(
				env.NEXT_PUBLIC_ETH_MAINNET_RPC_URL ?? defaultMainnetHttp
			),
		});
	}
	return mainnetEnsClient;
}

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
		if (!acc || typeof acc !== "object") {
			continue;
		}
		const a = acc as Record<string, unknown>;
		if (a.chainType === "solana") {
			continue;
		}
		if ("address" in a && typeof a.address === "string") {
			push(a.address);
		}
	}
	for (const w of wallets) {
		push(w.address);
	}

	debugOperatorEns(
		"L1 ENS candidates (order = user.wallet → linked EVM wallets → useWallets)",
		{
			addresses: out.map((a) => `${a.slice(0, 6)}…${a.slice(-4)}`),
			count: out.length,
			hint: "Wallet chain (e.g. Base Sepolia) is ignored — reads use Ethereum mainnet only.",
			usesCustomMainnetRpc: Boolean(env.NEXT_PUBLIC_ETH_MAINNET_RPC_URL),
			walletChainIrrelevant: true,
		}
	);

	return out;
}

async function tryEnsAvatarUrl(
	client: PublicClient,
	name: string
): Promise<string | null> {
	try {
		return (await client.getEnsAvatar({ name })) ?? null;
	} catch (error) {
		debugOperatorEns("getEnsAvatar failed (name still shown)", {
			error:
				error instanceof Error
					? { message: error.message, name: error.name }
					: String(error),
			name,
		});
		return null;
	}
}

/**
 * Resolve ENS **primary name** (reverse record) on Ethereum L1 for the first
 * linked / connected EVM address that has one set.
 *
 * **Not affected by the wallet’s connected chain** (e.g. Base Sepolia): all
 * reads go to **Ethereum mainnet** via HTTP. If resolution always fails in the
 * browser, set `NEXT_PUBLIC_ETH_MAINNET_RPC_URL` to an L1 HTTPS endpoint that
 * allows your origin (many public RPCs rate-limit or block browser `eth_call`).
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
			const client = getMainnetEnsClient();
			for (const walletAddress of candidates) {
				try {
					const primaryName = await getEnsName(client, {
						address: walletAddress as Address,
						strict: false,
					});
					if (!primaryName) {
						debugOperatorEns("getEnsName returned empty", {
							address: walletAddress,
						});
						continue;
					}
					let name: string;
					try {
						name = normalize(primaryName);
					} catch (error) {
						debugOperatorEns("normalize(primaryName) failed", {
							address: walletAddress,
							error:
								error instanceof Error
									? { message: error.message, name: error.name }
									: String(error),
							primaryName,
						});
						continue;
					}
					const avatarUrl = await tryEnsAvatarUrl(client, name);
					debugOperatorEns("resolved operator ENS", {
						address: walletAddress,
						avatarUrl: avatarUrl ?? "(none)",
						primaryName: name,
					});
					return { avatarUrl, primaryName: name };
				} catch (error) {
					debugOperatorEns("getEnsName threw for candidate", {
						address: walletAddress,
						error:
							error instanceof Error
								? { message: error.message, name: error.name }
								: String(error),
					});
				}
			}
			debugOperatorEns("no primary ENS found for any candidate", {
				candidateCount: candidates.length,
			});
			return null;
		},
		queryKey: ["operator-ens-profile", candidates.join(",")],
		retry: 2,
		staleTime: 60_000,
	});
}
