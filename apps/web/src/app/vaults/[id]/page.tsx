"use client";

import { USER_VAULT_ABI } from "@auto/contracts/factory-definitions";
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
import { Input } from "@auto/ui/components/input";
import { Label } from "@auto/ui/components/label";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@auto/ui/components/sheet";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ChevronLeft,
	Droplet,
	ExternalLink,
	MoreHorizontal,
	RefreshCcw,
	RefreshCw,
	ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
	createWalletClient,
	custom,
	formatEther,
	isAddress,
	parseEther,
} from "viem";
import { baseSepolia } from "viem/chains";
import { orpc } from "@/utils/orpc";
import { LiveActivityCard } from "./live-activity-card";
import { ManualCycleSheet } from "./manual-cycle-sheet";
import { useVaultCycleFeed } from "./use-vault-cycle-feed";
import { VaultDetailProvider } from "./vault-detail-context";
import { VaultPortfolioAnalytics } from "./vault-portfolio-analytics";

const baseScanAddressUrl = (address: string): string =>
	`https://sepolia.basescan.org/address/${address}`;

const baseScanTxUrl = (txHash: string): string =>
	`https://sepolia.basescan.org/tx/${txHash}`;

/** Coinbase Developer Platform — Base Sepolia testnet faucet */
const BASE_SEPOLIA_FAUCET_URL =
	"https://portal.cdp.coinbase.com/products/faucet" as const;

interface PrivyWalletLike {
	address?: string;
	getEthereumProvider: () => Promise<unknown>;
}

const getPrivyWalletClient = async (wallet: PrivyWalletLike) => {
	const provider = await wallet.getEthereumProvider();
	return createWalletClient({
		account: wallet.address as `0x${string}`,
		transport: custom(provider as Parameters<typeof custom>[0]),
	});
};

async function withdrawVaultTokens(
	walletClient: Awaited<ReturnType<typeof getPrivyWalletClient>>,
	vaultAddress: `0x${string}`,
	walletAddress: `0x${string}`,
	tokenRows: readonly {
		address: `0x${string}`;
		isHub: boolean;
		wei: bigint;
	}[]
) {
	for (const row of tokenRows) {
		if (row.wei === BigInt(0)) {
			continue;
		}
		if (row.isHub) {
			await walletClient.writeContract({
				chain: baseSepolia,
				account: walletAddress,
				address: vaultAddress,
				abi: USER_VAULT_ABI,
				functionName: "withdrawETH",
				args: [row.wei, walletAddress],
			});
		} else {
			await walletClient.writeContract({
				chain: baseSepolia,
				account: walletAddress,
				address: vaultAddress,
				abi: USER_VAULT_ABI,
				functionName: "withdraw",
				args: [row.address, row.wei, walletAddress],
			});
		}
	}
}

export default function VaultDetailPage() {
	const params = useParams();
	const vaultId = params.id as string;
	const { authenticated, login, ready } = usePrivy();
	const { wallets } = useWallets();
	const queryClient = useQueryClient();

	const [isWithdrawing, setIsWithdrawing] = useState(false);
	const [fundAmountEth, setFundAmountEth] = useState("0.01");
	const [isFunding, setIsFunding] = useState(false);
	const [fundSheetOpen, setFundSheetOpen] = useState(false);
	const [triggerSheetOpen, setTriggerSheetOpen] = useState(false);

	const primaryWallet = wallets[0] as PrivyWalletLike | undefined;

	const vaults = useQuery(orpc.listVaults.queryOptions());
	const vault = vaults.data?.find((v) => v.id === vaultId) ?? null;

	const balances = useQuery(
		orpc.getVaultBalancesByVaultId.queryOptions({
			input: { vaultId },
			query: {
				enabled: authenticated,
			},
		})
	);

	const wethWeiBalance = BigInt(balances.data?.wethWei ?? "0");

	const nativeEthBalance = useQuery({
		queryKey: ["wallet-native-balance", primaryWallet?.address ?? ""],
		enabled: Boolean(ready && authenticated && primaryWallet?.address),
		queryFn: async () => {
			const w = primaryWallet as PrivyWalletLike;
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

	const runTradeCycle = useMutation(orpc.runTradeCycle.mutationOptions());
	const setVaultAutopilot = useMutation(
		orpc.setVaultAutopilot.mutationOptions()
	);

	const cycleFeed = useVaultCycleFeed({
		vaultId,
		enabled: Boolean(ready && authenticated),
	});

	if (!ready) {
		return null;
	}

	if (!authenticated) {
		return (
			<div className="flex min-h-screen flex-col items-center justify-center bg-[#131313] px-6 text-[#e2e2e2]">
				<ShieldCheck className="mb-6 size-16 text-[#d97757]" />
				<h1 className="mb-2 font-newsreader text-4xl text-[#f5f5f2] italic">
					Authentication Required
				</h1>
				<p className="mb-8 max-w-md text-center font-manrope text-[#dbc1b9]">
					Please log in to view your vault details.
				</p>
				<Button
					className="h-11 rounded-md bg-[#d97757] px-8 font-manrope text-[#1b1b1b] hover:bg-[#ffb59e]"
					onClick={login}
				>
					Login to auto.eth
				</Button>
			</div>
		);
	}

	const fundVault = async () => {
		const vaultAddress = vault?.vaultAddress;
		if (!(vaultAddress && isAddress(vaultAddress))) {
			toast.error("Vault address not available yet.");
			return;
		}

		const wallet = primaryWallet;
		if (!wallet?.address) {
			toast.error("No wallet connected.");
			return;
		}

		let value: bigint;
		try {
			value = parseEther(fundAmountEth || "0");
		} catch {
			toast.error("Invalid amount.");
			return;
		}
		if (value <= BigInt(0)) {
			toast.error("Amount must be greater than zero.");
			return;
		}

		setIsFunding(true);
		try {
			const walletClient = await getPrivyWalletClient(wallet);
			await walletClient.writeContract({
				chain: baseSepolia,
				account: wallet.address as `0x${string}`,
				address: vaultAddress,
				abi: USER_VAULT_ABI,
				functionName: "depositETH",
				args: [],
				value,
			});
			toast.success("ETH deposited; vault holds WETH.");
			await queryClient.invalidateQueries({
				queryKey: orpc.getVaultBalancesByVaultId.queryOptions({
					input: { vaultId },
				}).queryKey,
			});
			await queryClient.invalidateQueries({
				queryKey: ["wallet-native-balance", wallet.address],
			});
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			toast.error(message);
		} finally {
			setIsFunding(false);
		}
	};

	const withdraw = async () => {
		const vaultAddress = vault?.vaultAddress;
		if (!(vaultAddress && isAddress(vaultAddress))) {
			toast.error("Vault address not available yet.");
			return;
		}

		const wallet = primaryWallet;
		const walletAddress = wallet?.address;
		if (!(wallet && walletAddress)) {
			toast.error("No wallet connected.");
			return;
		}

		const tokenRows =
			balances.data?.tokens
				.filter((t) => isAddress(t.address))
				.map((t) => ({
					address: t.address as `0x${string}`,
					isHub: t.isHub,
					wei: BigInt(t.wei),
				})) ?? [];

		if (!tokenRows.some((r) => r.wei > BigInt(0))) {
			toast.message("No balance to withdraw.");
			return;
		}

		setIsWithdrawing(true);
		try {
			const walletClient = await getPrivyWalletClient(wallet);
			await withdrawVaultTokens(
				walletClient,
				vaultAddress as `0x${string}`,
				walletAddress as `0x${string}`,
				tokenRows
			);

			toast.success("Withdraw submitted.");
			await queryClient.invalidateQueries({
				queryKey: orpc.getVaultBalancesByVaultId.queryOptions({
					input: { vaultId },
				}).queryKey,
			});
			await queryClient.invalidateQueries({
				queryKey: orpc.listVaults.queryOptions().queryKey,
			});
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			toast.error(message);
		} finally {
			setIsWithdrawing(false);
		}
	};

	return (
		<VaultDetailProvider
			value={{
				vaultId,
				vault,
				balances,
				wethWeiBalance,
				nativeEthBalance,
				runTradeCycle,
				fundSheetOpen,
				setFundSheetOpen,
				triggerSheetOpen,
				setTriggerSheetOpen,
				onFundVault: () => {
					setFundSheetOpen(true);
				},
				onWithdraw: () => {
					withdraw().catch(() => {
						/* errors surfaced via toast */
					});
				},
				faucetUrl: BASE_SEPOLIA_FAUCET_URL,
				baseScanAddressUrl,
				baseScanTxUrl,
				cycles: cycleFeed.cycles,
				fetchMoreCycles: cycleFeed.fetchNextPage,
				hasMoreCycles: cycleFeed.hasNextPage,
				isFetchingMoreCycles: cycleFeed.isFetchingNextPage,
			}}
		>
			<main className="min-h-screen bg-[#131313] text-[#e2e2e2]">
				<div className="mx-auto w-full max-w-6xl px-6 py-12 md:px-10 md:py-16">
					<Link
						className="mb-8 flex items-center gap-2 font-manrope text-[#a38c85] text-sm transition-colors hover:text-[#f5f5f2]"
						href="/vaults"
					>
						<ChevronLeft className="size-4" />
						Back to Dashboard
					</Link>

					<header className="mb-12 flex items-end justify-between border-[#55433d] border-b pb-8">
						<div>
							<h1 className="mt-2 font-newsreader text-5xl text-[#f5f5f2] italic">
								{vault?.name || "Agent"}
							</h1>
							<div className="mt-3">
								{vault?.vaultAddress ? (
									<AddressWithCopy
										address={vault.vaultAddress}
										className="justify-start"
										href={baseScanAddressUrl(vault.vaultAddress)}
									/>
								) : (
									<p className="font-manrope text-[#a38c85] text-sm">
										Deploying… (address pending)
									</p>
								)}
							</div>
						</div>

						<div className="flex flex-wrap items-center gap-3">
							<Button
								className="border-[#55433d] font-manrope text-[#dbc1b9] hover:bg-[#2a2a2a]"
								onClick={() => {
									window.open(
										BASE_SEPOLIA_FAUCET_URL,
										"_blank",
										"noopener,noreferrer"
									);
								}}
								type="button"
								variant="outline"
							>
								<Droplet className="size-4" />
								Get WETH (faucet) <ExternalLink className="size-4" />
							</Button>

							<Button
								className="border-[#55433d] font-manrope text-[#dbc1b9] hover:bg-[#2a2a2a]"
								disabled={!vault || setVaultAutopilot.isPending}
								onClick={() => {
									if (!vault) {
										return;
									}
									const next = !vault.autopilot;
									setVaultAutopilot
										.mutateAsync({ vaultId, autopilot: next })
										.then(() => {
											toast.success(
												next
													? "Autopilot enabled (agent can execute)"
													: "Autopilot disabled (suggestions only)"
											);
											return queryClient.invalidateQueries({
												queryKey: orpc.listVaults.queryOptions().queryKey,
											});
										})
										.catch(() => {
											/* errors surfaced via toast */
										});
								}}
								type="button"
								variant={vault?.autopilot ? "destructive" : "outline"}
							>
								<ShieldCheck className="size-4" />
								Autopilot: {vault?.autopilot ? "ON" : "OFF"}
							</Button>

							<Button
								className="bg-[#d97757] px-5 font-manrope text-[#1b1b1b] shadow-[0_0_0_1px_rgba(217,119,87,0.35)] hover:bg-[#ffb59e]"
								disabled={
									runTradeCycle.isPending ||
									!vault?.vaultAddress ||
									vault.status !== "active"
								}
								onClick={() => {
									setTriggerSheetOpen(true);
								}}
								type="button"
							>
								<RefreshCcw className="size-4" />
								Run trade cycle
							</Button>

							<DropdownMenu>
								<DropdownMenuTrigger
									render={
										<Button
											className="border-[#55433d] text-[#dbc1b9] hover:bg-[#2a2a2a]"
											size="icon"
											variant="outline"
										/>
									}
								>
									<MoreHorizontal className="size-4" />
									<span className="sr-only">More actions</span>
								</DropdownMenuTrigger>
								<DropdownMenuContent
									align="end"
									className="w-56 border border-[#55433d] bg-[#1b1b1b] text-[#e2e2e2]"
									sideOffset={8}
								>
									<DropdownMenuGroup>
										<DropdownMenuLabel className="font-manrope text-[#a38c85] text-xs uppercase tracking-[0.08em]">
											Actions
										</DropdownMenuLabel>
										<DropdownMenuSeparator className="bg-[#2a2a2a]" />
										<DropdownMenuItem
											className="font-manrope text-[#dbc1b9] hover:bg-[#2a2a2a]"
											disabled={isWithdrawing || balances.isLoading}
											onSelect={() => {
												withdraw().catch(() => {
													/* errors surfaced via toast */
												});
											}}
										>
											Withdraw
										</DropdownMenuItem>
									</DropdownMenuGroup>
								</DropdownMenuContent>
							</DropdownMenu>
						</div>
					</header>

					<Sheet
						onOpenChange={(open) => {
							setFundSheetOpen(open);
							if (open && primaryWallet?.address) {
								queryClient
									.invalidateQueries({
										queryKey: ["wallet-native-balance", primaryWallet.address],
									})
									.catch(() => {
										/* best-effort */
									});
							}
						}}
						open={fundSheetOpen}
					>
						<SheetContent
							className="border-[#55433d] bg-[#1b1b1b] text-[#e2e2e2]"
							showCloseButton
							side="right"
						>
							<SheetHeader className="border-[#2a2a2a] border-b pb-4 text-left">
								<SheetTitle className="font-newsreader text-[#f5f5f2] text-xl">
									Fund vault
								</SheetTitle>
								<SheetDescription className="font-manrope text-[#a38c85] text-sm">
									Send Base Sepolia ETH from your wallet. It is wrapped to WETH
									inside the vault via{" "}
									<code className="text-[#dbc1b9]">depositETH</code>.
								</SheetDescription>
							</SheetHeader>
							<div className="flex flex-col gap-6 px-4 py-6">
								<div className="rounded-md border border-[#55433d] bg-[#131313] p-4">
									<p className="font-manrope text-[#a38c85] text-[10px] uppercase tracking-[0.08em]">
										Your wallet (native ETH)
									</p>
									<div className="mt-1 flex items-center gap-2">
										<p className="font-newsreader text-3xl text-[#f5f5f2]">
											{nativeEthBalance.isLoading
												? "…"
												: `${formatEther(nativeEthBalance.data ?? BigInt(0))} ETH`}
										</p>
										<button
											aria-label="Refresh wallet balance"
											className="inline-flex rounded-md p-2 text-[#a38c85] transition-colors hover:bg-[#1b1b1b] hover:text-[#e2e2e2] disabled:pointer-events-none disabled:opacity-50"
											disabled={nativeEthBalance.isFetching}
											onClick={async () => {
												await nativeEthBalance.refetch();
											}}
											type="button"
										>
											<RefreshCw
												aria-hidden
												className={`size-4 ${nativeEthBalance.isFetching ? "animate-spin" : ""}`}
											/>
										</button>
									</div>
									<a
										className="mt-3 inline-flex font-manrope text-[#ffb59e] text-sm underline-offset-4 hover:underline"
										href={BASE_SEPOLIA_FAUCET_URL}
										rel="noopener noreferrer"
										target="_blank"
									>
										Get testnet ETH — Coinbase Base Sepolia faucet
									</a>
								</div>
								<div className="grid gap-2">
									<Label
										className="font-manrope text-[#dbc1b9] text-xs"
										htmlFor="fundEth"
									>
										Amount to deposit (ETH)
									</Label>
									<Input
										className="h-11 rounded-md border-[#55433d] bg-[#131313] font-manrope text-[#e2e2e2] text-sm"
										id="fundEth"
										min="0"
										onChange={(e) => setFundAmountEth(e.target.value)}
										placeholder="0.01"
										step="any"
										type="number"
										value={fundAmountEth}
									/>
								</div>
								<Button
									className="h-11 rounded-md bg-[#d97757] font-manrope text-[#1b1b1b] hover:bg-[#ffb59e]"
									disabled={
										isFunding ||
										!vault?.vaultAddress ||
										vault.status !== "active"
									}
									onClick={() => {
										fundVault().catch(() => {
											/* errors surfaced via toast */
										});
									}}
									type="button"
								>
									{isFunding ? "Depositing…" : "Deposit into vault"}
								</Button>
							</div>
						</SheetContent>
					</Sheet>

					<VaultPortfolioAnalytics
						balances={balances.data}
						isLoading={balances.isLoading}
					/>

					<div className="mt-12 grid gap-6">
						<ManualCycleSheet />
						<LiveActivityCard />
						<div />
					</div>
				</div>
			</main>
		</VaultDetailProvider>
	);
}
