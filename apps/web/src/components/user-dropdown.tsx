"use client";

import { AddressWithCopy } from "@auto/ui/components/address";
import { Button } from "@auto/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@auto/ui/components/dropdown-menu";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { Droplet, ExternalLink, RefreshCw, UserIcon } from "lucide-react";
import Image from "next/image";
import { formatEther } from "viem";
import { useOperatorEnsProfile } from "@/hooks/use-operator-ens";
import { ENS_MANAGER_APP_URL } from "@/lib/ens-manager";

const baseScanAddressUrl = (address: string): string =>
	`https://sepolia.basescan.org/address/${address}`;

/** Coinbase Developer Platform — Base Sepolia testnet faucet */
const BASE_SEPOLIA_FAUCET_URL =
	"https://portal.cdp.coinbase.com/products/faucet" as const;

interface PrivyWalletLike {
	address?: string;
	getEthereumProvider: () => Promise<unknown>;
}

export function UserDropdown() {
	const { ready, authenticated, login, logout } = usePrivy();
	const { wallets } = useWallets();
	const wallet = wallets[0] as PrivyWalletLike | undefined;
	const walletAddress = wallet?.address ?? null;
	const operatorEns = useOperatorEnsProfile(walletAddress);

	const nativeEthBalance = useQuery({
		queryKey: ["wallet-native-balance", walletAddress ?? ""],
		enabled: Boolean(ready && authenticated && walletAddress && wallet),
		queryFn: async () => {
			const w = wallet as PrivyWalletLike;
			const provider = (await w.getEthereumProvider()) as {
				request: (args: {
					method: string;
					params?: unknown[];
				}) => Promise<string>;
			};
			const hex = await provider.request({
				method: "eth_getBalance",
				params: [w.address as string, "latest"],
			});
			return BigInt(hex);
		},
		refetchInterval: 20_000,
	});

	if (!ready) {
		return null;
	}

	if (!authenticated) {
		return (
			<Button
				className="h-9 rounded-md bg-[#d97757] font-manrope text-[#1b1b1b] hover:bg-[#ffb59e]"
				onClick={login}
			>
				Login
			</Button>
		);
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						className="h-9 rounded-md border border-[#55433d] bg-[#2a2a2a] font-manrope text-[#e2e2e2] hover:bg-[#333333]"
						variant="outline"
					/>
				}
			>
				<span className="flex max-w-[11rem] items-center gap-2">
					{operatorEns.data?.avatarUrl ? (
						<Image
							alt=""
							aria-hidden
							className="size-6 shrink-0 rounded-full object-cover"
							height={24}
							src={operatorEns.data.avatarUrl}
							unoptimized
							width={24}
						/>
					) : (
						<UserIcon className="h-4 w-4 shrink-0" />
					)}
					<span className="truncate font-manrope text-sm">
						{operatorEns.data?.primaryName ?? "Account"}
					</span>
				</span>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="end"
				className="w-72 border border-[#55433d] bg-[#1b1b1b] text-[#e2e2e2]"
				sideOffset={8}
			>
				<DropdownMenuGroup>
					<DropdownMenuLabel className="font-manrope text-[#a38c85] text-sm uppercase tracking-[0.08em]">
						Wallet
					</DropdownMenuLabel>
					<p className="px-2 font-manrope text-[#6b5d58] text-[10px] leading-snug">
						Primary ENS resolves on Ethereum; vaults execute on Base.
					</p>

					<div className="space-y-3 px-2 py-2">
						{walletAddress ? (
							<AddressWithCopy
								address={walletAddress}
								href={baseScanAddressUrl(walletAddress)}
							/>
						) : (
							<p className="font-manrope text-[#a38c85] text-sm">
								Wallet address unavailable.
							</p>
						)}
					</div>
				</DropdownMenuGroup>
				<DropdownMenuSeparator className="bg-[#2a2a2a]" />
				<a href={ENS_MANAGER_APP_URL} rel="noopener noreferrer" target="_blank">
					<DropdownMenuItem className="font-manrope text-[#dbc1b9] hover:bg-[#2a2a2a]">
						Register / manage ENS
						<ExternalLink className="h-4 w-4" />
					</DropdownMenuItem>
				</a>
				<DropdownMenuSeparator className="bg-[#2a2a2a]" />
				<DropdownMenuGroup>
					<DropdownMenuLabel className="font-manrope text-[#a38c85] text-sm uppercase tracking-[0.08em]">
						Balance
					</DropdownMenuLabel>
					<div className="flex items-center gap-2 px-2 py-2">
						<p className="min-w-0 flex-1 font-manrope text-[#f5f5f2] text-sm tabular-nums">
							{nativeEthBalance.isLoading
								? "…"
								: `${formatEther(nativeEthBalance.data ?? BigInt(0))} ETH`}
						</p>
						<button
							aria-label="Refresh balance"
							className="inline-flex shrink-0 rounded-md p-1.5 text-[#a38c85] transition-colors hover:bg-[#2a2a2a] hover:text-[#e2e2e2] disabled:pointer-events-none disabled:opacity-50"
							disabled={nativeEthBalance.isFetching}
							onClick={async () => {
								await nativeEthBalance.refetch();
							}}
							type="button"
						>
							<RefreshCw
								aria-hidden
								className={`h-4 w-4 ${nativeEthBalance.isFetching ? "animate-spin" : ""}`}
							/>
						</button>
					</div>
				</DropdownMenuGroup>
				<DropdownMenuSeparator className="bg-[#2a2a2a]" />
				<a
					href={BASE_SEPOLIA_FAUCET_URL}
					rel="noopener noreferrer"
					target="_blank"
				>
					<DropdownMenuItem className="font-manrope text-[#dbc1b9] hover:bg-[#2a2a2a]">
						<Droplet className="text-[#d97757]" />
						Faucet <ExternalLink className="h-4 w-4" />
					</DropdownMenuItem>
				</a>
				<DropdownMenuSeparator className="bg-[#2a2a2a]" />
				<DropdownMenuItem className="font-manrope text-[#dbc1b9] hover:bg-[#2a2a2a]">
					<button onClick={logout} type="button">
						Log out
					</button>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
