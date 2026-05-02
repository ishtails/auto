"use client";

import type {
	CycleLogRecord,
	RunTradeCycleOutput,
	runTradeCycleInputSchema,
} from "@auto/api/trade-types";
import type { vaultSchema } from "@auto/api/vault-types";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import { createContext, useContext } from "react";
import type { z } from "zod";

export type VaultListItem = z.infer<typeof vaultSchema>;

export interface VaultBalances {
	usdcWei: string;
	wethWei: string;
}

export type RunTradeCycleVariables = z.input<typeof runTradeCycleInputSchema>;

export interface VaultDetailContextValue {
	balances: UseQueryResult<VaultBalances, Error>;
	baseScanAddressUrl: (address: string) => string;
	baseScanTxUrl: (txHash: string) => string;

	cycles: CycleLogRecord[];

	faucetUrl: string;
	fetchMoreCycles?: () => void;

	fundSheetOpen: boolean;
	hasMoreCycles?: boolean;
	isFetchingMoreCycles?: boolean;
	nativeEthBalance: UseQueryResult<bigint, Error>;

	onFundVault: () => void;
	onWithdraw: () => void;

	runTradeCycle: UseMutationResult<
		RunTradeCycleOutput,
		Error,
		RunTradeCycleVariables,
		unknown
	>;
	setFundSheetOpen: (open: boolean) => void;
	setTriggerSheetOpen: (open: boolean) => void;

	triggerSheetOpen: boolean;
	vault: VaultListItem | null;
	vaultId: string;
	wethWeiBalance: bigint;
}

const VaultDetailContext = createContext<VaultDetailContextValue | null>(null);

export function VaultDetailProvider({
	value,
	children,
}: {
	value: VaultDetailContextValue;
	children: React.ReactNode;
}) {
	return (
		<VaultDetailContext.Provider value={value}>
			{children}
		</VaultDetailContext.Provider>
	);
}

export function useVaultDetailContext(): VaultDetailContextValue {
	const ctx = useContext(VaultDetailContext);
	if (!ctx) {
		throw new Error(
			"useVaultDetailContext must be used within VaultDetailProvider"
		);
	}
	return ctx;
}
