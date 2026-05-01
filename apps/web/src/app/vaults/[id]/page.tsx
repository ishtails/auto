"use client";

import { USER_VAULT_ABI } from "@auto/contracts/factory-definitions";
import { Button } from "@auto/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@auto/ui/components/card";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, ChevronLeft, Info, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { createWalletClient, custom, isAddress } from "viem";
import { orpc } from "@/utils/orpc";

const truncateAddress = (address: string): string =>
	`${address.slice(0, 6)}...${address.slice(-4)}`;

const baseScanAddressUrl = (address: string): string =>
	`https://sepolia.basescan.org/address/${address}`;

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

export default function VaultDetailPage() {
	const params = useParams();
	const vaultId = params.id as string;
	const { authenticated, login, ready } = usePrivy();
	const { wallets } = useWallets();
	const queryClient = useQueryClient();
	const [isWithdrawing, setIsWithdrawing] = useState(false);

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

	const runTradeCycle = useMutation(orpc.runTradeCycle.mutationOptions());

	if (!ready) {
		return null;
	}

	if (!authenticated) {
		return (
			<div className="flex min-h-screen flex-col items-center justify-center bg-[#131313] px-6 text-[#e2e2e2]">
				<ShieldCheck className="mb-6 h-16 w-16 text-[#d97757]" />
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

	const withdraw = async () => {
		const vaultAddress = vault?.vaultAddress;
		if (!(vaultAddress && isAddress(vaultAddress))) {
			toast.error("Vault address not available yet.");
			return;
		}

		const wallet = wallets[0] as PrivyWalletLike | undefined;
		const walletAddress = wallet?.address;
		if (!walletAddress) {
			toast.error("No wallet connected.");
			return;
		}

		const tokenIn = vault?.tokenIn;
		const tokenOut = vault?.tokenOut;
		if (!(tokenIn && tokenOut)) {
			toast.error("Vault tokens are not available.");
			return;
		}

		const wethWei = BigInt(balances.data?.wethWei ?? "0");
		const usdcWei = BigInt(balances.data?.usdcWei ?? "0");
		if (wethWei === BigInt(0) && usdcWei === BigInt(0)) {
			toast.message("No balance to withdraw.");
			return;
		}

		setIsWithdrawing(true);
		try {
			const walletClient = await getPrivyWalletClient(wallet);

			const withdrawToken = async (token: string, amount: bigint) => {
				if (amount === BigInt(0)) {
					return;
				}
				await walletClient.writeContract({
					chain: null,
					address: vaultAddress,
					abi: USER_VAULT_ABI,
					functionName: "withdraw",
					args: [
						token as `0x${string}`,
						amount,
						walletAddress as `0x${string}`,
					],
				});
			};

			await withdrawToken(tokenIn, wethWei);
			await withdrawToken(tokenOut, usdcWei);

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

	const runCycle = () => {
		runTradeCycle.mutate(
			{ vaultId, dryRun: false },
			{
				onSuccess: async (result) => {
					if (result.decision === "APPROVE") {
						toast.success("Trade cycle executed", {
							description: result.txHash ?? undefined,
						});
					} else {
						toast.message("Trade cycle rejected", {
							description: result.reason ?? undefined,
						});
					}
					await queryClient.invalidateQueries({
						queryKey: orpc.getVaultBalancesByVaultId.queryOptions({
							input: { vaultId },
						}).queryKey,
					});
				},
				onError: (error) => {
					toast.error(error.message);
				},
			}
		);
	};

	return (
		<main className="min-h-screen bg-[#131313] text-[#e2e2e2]">
			<div className="mx-auto w-full max-w-[1000px] px-6 py-12 md:px-10 md:py-16">
				<Link
					className="mb-8 flex items-center gap-2 font-manrope text-[#a38c85] text-sm transition-colors hover:text-[#f5f5f2]"
					href="/vaults"
				>
					<ChevronLeft className="h-4 w-4" />
					Back to Dashboard
				</Link>

				<header className="mb-12 flex items-end justify-between border-[#55433d] border-b pb-8">
					<div>
						<span className="font-manrope text-[#d97757] text-xs uppercase tracking-[0.2em]">
							{vault?.status ? `Vault ${vault.status}` : "Vault"}
						</span>
						<h1 className="mt-2 font-newsreader text-5xl text-[#f5f5f2] italic">
							{vault?.name || "Vault"}
						</h1>
						<p className="mt-2 font-manrope text-[#a38c85] text-sm">
							ID: {vaultId}
						</p>
					</div>
					<div className="flex gap-3">
						<Button
							className="border-[#55433d] text-[#dbc1b9] hover:bg-[#2a2a2a]"
							disabled={runTradeCycle.isPending || !vault?.vaultAddress}
							onClick={runCycle}
							variant="outline"
						>
							Run cycle
						</Button>
						<Button
							className="bg-[#d97757] text-[#1b1b1b] hover:bg-[#ffb59e]"
							disabled={isWithdrawing || balances.isLoading}
							onClick={withdraw}
						>
							Withdraw
						</Button>
					</div>
				</header>

				<div className="grid gap-6 md:grid-cols-3">
					<Card className="border-[#55433d] bg-[#1b1b1b]">
						<CardHeader className="pb-2">
							<CardTitle className="font-manrope text-[#a38c85] text-xs uppercase tracking-[0.1em]">
								WETH Balance
							</CardTitle>
						</CardHeader>
						<CardContent>
							<p className="font-newsreader text-3xl text-[#f5f5f2]">
								{balances.data?.wethWei
									? (Number(balances.data.wethWei) / 1e18).toFixed(4)
									: "0.0000"}
							</p>
						</CardContent>
					</Card>

					<Card className="border-[#55433d] bg-[#1b1b1b]">
						<CardHeader className="pb-2">
							<CardTitle className="font-manrope text-[#a38c85] text-xs uppercase tracking-[0.1em]">
								USDC Balance
							</CardTitle>
						</CardHeader>
						<CardContent>
							<p className="font-newsreader text-3xl text-[#f5f5f2]">
								{balances.data?.usdcWei
									? (Number(balances.data.usdcWei) / 1e6).toFixed(2)
									: "0.00"}
							</p>
						</CardContent>
					</Card>

					<Card className="border-[#55433d] bg-[#1b1b1b]">
						<CardHeader className="pb-2">
							<CardTitle className="font-manrope text-[#a38c85] text-xs uppercase tracking-[0.1em]">
								Total Value (USD)
							</CardTitle>
						</CardHeader>
						<CardContent>
							<p className="font-newsreader text-3xl text-[#f5f5f2]">$ —</p>
						</CardContent>
					</Card>
				</div>

				<div className="mt-12 grid gap-6 md:grid-cols-[2fr_1fr]">
					<Card className="border-[#55433d] bg-[#1b1b1b]">
						<CardHeader className="flex flex-row items-center justify-between border-[#2a2a2a] border-b pb-4">
							<CardTitle className="flex items-center gap-2 font-newsreader font-normal text-2xl text-[#f5f5f2]">
								<Activity className="h-5 w-5 text-[#ffb59e]" />
								Recent Activity
							</CardTitle>
						</CardHeader>
						<CardContent className="py-12 text-center">
							<p className="font-manrope text-[#a38c85]">
								No recent trades detected.
							</p>
						</CardContent>
					</Card>

					<Card className="border-[#55433d] bg-[#1b1b1b]">
						<CardHeader className="border-[#2a2a2a] border-b pb-4">
							<CardTitle className="flex items-center gap-2 font-newsreader font-normal text-[#f5f5f2] text-xl">
								<Info className="h-4 w-4 text-[#d97757]" />
								Vault Info
							</CardTitle>
						</CardHeader>
						<CardContent className="grid gap-4 pt-4">
							<div className="grid gap-1">
								<span className="font-manrope text-[#a38c85] text-[10px] uppercase">
									Address
								</span>
								{vault?.vaultAddress ? (
									<a
										className="break-all font-mono text-[#dbc1b9] text-xs underline decoration-[#55433d] underline-offset-4 hover:text-[#f5f5f2]"
										href={baseScanAddressUrl(vault.vaultAddress)}
										rel="noopener"
										target="_blank"
									>
										{truncateAddress(vault.vaultAddress)}
									</a>
								) : (
									<span className="text-[#a38c85] text-xs">
										Deploying… (address pending)
									</span>
								)}
							</div>
							<div className="grid gap-1">
								<span className="font-manrope text-[#a38c85] text-[10px] uppercase">
									Network
								</span>
								<span className="text-[#dbc1b9] text-xs">Base Sepolia</span>
							</div>
							<div className="grid gap-1">
								<span className="font-manrope text-[#a38c85] text-[10px] uppercase">
									Created
								</span>
								<span className="text-[#dbc1b9] text-xs">May 1, 2026</span>
							</div>
						</CardContent>
					</Card>
				</div>
			</div>
		</main>
	);
}
