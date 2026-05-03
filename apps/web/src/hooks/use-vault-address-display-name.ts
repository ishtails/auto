"use client";

import { useEffect } from "react";
import { useAddressBaseBasename } from "@/hooks/use-address-base-basename";

type VaultBasenameFields = {
	agentBasename: string | null;
	vaultAddress: string | null;
} | null;

const isVaultBasenameUiDebug =
	typeof process !== "undefined" && process.env.NODE_ENV === "development";

/**
 * Basename to show next to the vault contract address: on-chain primary name when
 * resolvable, otherwise the profile-linked name from the API.
 */
export function useVaultAddressDisplayName(vault: VaultBasenameFields) {
	const basenameQuery = useAddressBaseBasename(vault?.vaultAddress);
	const merged = basenameQuery.data ?? vault?.agentBasename ?? null;

	useEffect(() => {
		if (!isVaultBasenameUiDebug) {
			return;
		}
		let reverseErrorMessage: string | null = null;
		const err = basenameQuery.error;
		if (err) {
			reverseErrorMessage = err instanceof Error ? err.message : String(err);
		}
		console.log("[vault-basename-ui] merge state", {
			apiAgentBasename: vault?.agentBasename ?? null,
			mergedLabelShownInUi: merged,
			reverseError: reverseErrorMessage,
			reverseFetchStatus: basenameQuery.fetchStatus,
			reverseStatus: basenameQuery.status,
			reverseValue: basenameQuery.data ?? null,
			vaultAddress: vault?.vaultAddress ?? null,
		});
	}, [
		basenameQuery.data,
		basenameQuery.error,
		basenameQuery.fetchStatus,
		basenameQuery.status,
		merged,
		vault?.agentBasename,
		vault?.vaultAddress,
	]);

	return merged;
}
