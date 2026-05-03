"use client";

import { useQuery } from "@tanstack/react-query";
import { isAddress } from "viem";
import { readAddressBaseBasename } from "@/lib/read-address-base-basename";

/**
 * Client-side Basename primary name for a vault (Base Sepolia / ENSIP-19 via L1).
 */
export function useAddressBaseBasename(address: string | null | undefined) {
	const normalized = address?.trim() ?? "";
	const enabled = Boolean(normalized && isAddress(normalized));

	return useQuery({
		enabled,
		queryFn: () => readAddressBaseBasename(normalized),
		queryKey: ["address-base-basename", normalized.toLowerCase()],
		staleTime: 300_000,
	});
}
