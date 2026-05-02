"use client";

import type {
	CycleLogRecord,
	RunTradeCycleOutput,
	runTradeCycleInputSchema,
} from "@auto/api/trade-types";
import { USER_VAULT_ABI } from "@auto/contracts/factory-definitions";
import { AddressWithCopy } from "@auto/ui/components/address";
import { Button } from "@auto/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@auto/ui/components/card";
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
import { getAccessToken, usePrivy, useWallets } from "@privy-io/react-auth";
import {
	type UseMutationResult,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import {
	Activity,
	ChevronLeft,
	Droplet,
	ExternalLink,
	MoreHorizontal,
	RefreshCw,
	ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
	createWalletClient,
	custom,
	formatEther,
	isAddress,
	parseEther,
} from "viem";
import { baseSepolia } from "viem/chains";
import type { z } from "zod";
import { orpc } from "@/utils/orpc";

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

interface ManualCycleActivity {
	at: string;
	cycleId: string;
	dryRun: boolean;
	maxSlippageBps: number;
	result: RunTradeCycleOutput;
	tradeSizeBps: number;
}

interface VaultProfileDefaults {
	maxSlippageBps: number;
	riskScore: number;
}

type RunTradeCycleVariables = z.input<typeof runTradeCycleInputSchema>;

const parseSseEvent = (
	block: string
): { event: string; data: string } | null => {
	const lines = block.split("\n");
	let event = "message";
	const dataLines: string[] = [];
	for (const line of lines) {
		if (line.startsWith("event:")) {
			event = line.slice("event:".length).trim();
			continue;
		}
		if (line.startsWith("data:")) {
			dataLines.push(line.slice("data:".length).trimStart());
		}
	}
	if (dataLines.length === 0) {
		return null;
	}
	return { event, data: dataLines.join("\n") };
};

async function streamVaultCycles({
	serverBase,
	vaultId,
	token,
	signal,
	onHistory,
	onCycle,
}: {
	serverBase: string;
	vaultId: string;
	token: string;
	signal: AbortSignal;
	onHistory: (records: CycleLogRecord[]) => void;
	onCycle: (record: CycleLogRecord) => void;
}): Promise<void> {
	const res = await fetch(
		`${serverBase}/sse/vaults/${vaultId}/cycles?limit=50`,
		{
			headers: { Authorization: `Bearer ${token}` },
			signal,
		}
	);

	if (!(res.ok && res.body)) {
		return;
	}

	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	for (;;) {
		const { value, done } = await reader.read();
		if (done) {
			return;
		}

		buffer += decoder.decode(value, { stream: true });

		let idx = buffer.indexOf("\n\n");
		while (idx !== -1) {
			const block = buffer.slice(0, idx);
			buffer = buffer.slice(idx + 2);
			idx = buffer.indexOf("\n\n");

			const evt = parseSseEvent(block);
			if (!evt) {
				continue;
			}

			if (evt.event === "history") {
				onHistory(JSON.parse(evt.data) as CycleLogRecord[]);
				continue;
			}

			if (evt.event === "cycle") {
				onCycle(JSON.parse(evt.data) as CycleLogRecord);
			}
		}
	}
}

interface VaultManualCycleSheetProps {
	balancesLoading: boolean;
	onOpenChange: (open: boolean) => void;
	onSuccessfulRun: (entry: ManualCycleActivity) => void;
	open: boolean;
	profile: VaultProfileDefaults | null;
	runTradeCycle: UseMutationResult<
		RunTradeCycleOutput,
		Error,
		RunTradeCycleVariables,
		unknown
	>;
	vaultAddress: string | null | undefined;
	vaultId: string;
	wethWeiBalance: bigint;
}

function VaultManualCycleSheet({
	open,
	onOpenChange,
	vaultId,
	profile,
	vaultAddress,
	wethWeiBalance,
	balancesLoading,
	runTradeCycle,
	onSuccessfulRun,
}: VaultManualCycleSheetProps) {
	const queryClient = useQueryClient();
	const [manualTradeSizeBps, setManualTradeSizeBps] = useState("50");
	const [manualMaxSlippageBps, setManualMaxSlippageBps] = useState("100");
	const [manualDryRun, setManualDryRun] = useState(false);
	const [lastTriggerResult, setLastTriggerResult] =
		useState<RunTradeCycleOutput | null>(null);
	const [lastTriggerError, setLastTriggerError] = useState<string | null>(null);

	const parsedTradeSizeBps = Number.parseInt(manualTradeSizeBps, 10);
	const estimatedAmountInWei = useMemo(() => {
		if (
			!Number.isFinite(parsedTradeSizeBps) ||
			parsedTradeSizeBps < 1 ||
			parsedTradeSizeBps > 10_000
		) {
			return BigInt(0);
		}
		return (wethWeiBalance * BigInt(parsedTradeSizeBps)) / BigInt(10_000);
	}, [parsedTradeSizeBps, wethWeiBalance]);

	useEffect(() => {
		if (open && profile) {
			setManualTradeSizeBps(String(profile.riskScore));
			const slip = Math.min(Math.max(1, profile.maxSlippageBps), 2000);
			setManualMaxSlippageBps(String(slip));
			setManualDryRun(false);
			setLastTriggerResult(null);
			setLastTriggerError(null);
		}
	}, [open, profile]);

	const submitManualTrigger = () => {
		setLastTriggerResult(null);
		setLastTriggerError(null);

		const tradeSizeBps = Number.parseInt(manualTradeSizeBps, 10);
		const maxSlip = Number.parseInt(manualMaxSlippageBps, 10);

		if (
			!Number.isFinite(tradeSizeBps) ||
			tradeSizeBps < 1 ||
			tradeSizeBps > 10_000
		) {
			toast.error("Trade size must be between 1 and 10,000 bps.");
			return;
		}
		if (!Number.isFinite(maxSlip) || maxSlip < 1 || maxSlip > 2000) {
			toast.error("Max slippage must be between 1 and 2,000 bps.");
			return;
		}

		const amountInWei =
			(wethWeiBalance * BigInt(tradeSizeBps)) / BigInt(10_000);
		if (amountInWei <= BigInt(0)) {
			toast.error(
				"No tradeable WETH at this trade size. Fund the vault or increase trade size."
			);
			return;
		}

		runTradeCycle.mutate(
			{
				vaultId,
				amountIn: amountInWei.toString(),
				maxSlippageBps: maxSlip,
				dryRun: manualDryRun,
			},
			{
				onSuccess: async (result) => {
					setLastTriggerResult(result);
					onSuccessfulRun({
						cycleId: result.cycleId,
						at: new Date().toISOString(),
						dryRun: manualDryRun,
						tradeSizeBps,
						maxSlippageBps: maxSlip,
						result,
					});
					if (result.decision === "APPROVE") {
						toast.success(
							manualDryRun
								? "Dry run approved (no tx)"
								: "Trade cycle executed",
							{
								description: result.txHash ?? result.reason ?? undefined,
							}
						);
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
					setLastTriggerError(error.message);
					toast.error(error.message);
				},
			}
		);
	};

	return (
		<Sheet onOpenChange={onOpenChange} open={open}>
			<SheetContent
				className="border-[#55433d] bg-[#1b1b1b] text-[#e2e2e2]"
				showCloseButton
				side="right"
			>
				<SheetHeader className="border-[#2a2a2a] border-b pb-4 text-left">
					<SheetTitle className="font-newsreader text-[#f5f5f2] text-xl">
						Manual trade cycle
					</SheetTitle>
					<SheetDescription className="font-manrope text-[#a38c85] text-sm">
						Uses vault WETH balance: trade size is a fraction of WETH (basis
						points). The server still proposes BUY / SELL / HOLD and risk checks
						before any transaction.
					</SheetDescription>
				</SheetHeader>
				<div className="flex flex-col gap-6 px-4 py-6">
					<div className="rounded-md border border-[#55433d] bg-[#131313] p-4">
						<p className="font-manrope text-[#a38c85] text-[10px] uppercase tracking-[0.08em]">
							Estimated input
						</p>
						<p className="mt-1 font-newsreader text-2xl text-[#f5f5f2]">
							{balancesLoading
								? "…"
								: `${formatEther(estimatedAmountInWei)} WETH`}
						</p>
						<p className="mt-2 font-manrope text-[#a38c85] text-xs">
							From vault WETH balance{" "}
							{balancesLoading ? "…" : `${formatEther(wethWeiBalance)} WETH`} ×
							trade size bps ÷ 10,000.
						</p>
					</div>
					<div className="grid gap-2">
						<Label
							className="font-manrope text-[#dbc1b9] text-xs"
							htmlFor="tradeSizeBps"
						>
							Trade size (basis points of WETH)
						</Label>
						<Input
							className="h-11 rounded-md border-[#55433d] bg-[#131313] font-manrope text-[#e2e2e2] text-sm"
							id="tradeSizeBps"
							inputMode="numeric"
							max={10_000}
							min={1}
							onChange={(e) => setManualTradeSizeBps(e.target.value)}
							type="number"
							value={manualTradeSizeBps}
						/>
						<p className="font-manrope text-[#a38c85] text-xs">
							100 bps = 1% of vault WETH. Default matches your agent profile
							(risk setting).
						</p>
					</div>
					<div className="grid gap-2">
						<Label
							className="font-manrope text-[#dbc1b9] text-xs"
							htmlFor="maxSlippageBps"
						>
							Max slippage (basis points)
						</Label>
						<Input
							className="h-11 rounded-md border-[#55433d] bg-[#131313] font-manrope text-[#e2e2e2] text-sm"
							id="maxSlippageBps"
							inputMode="numeric"
							max={2000}
							min={1}
							onChange={(e) => setManualMaxSlippageBps(e.target.value)}
							type="number"
							value={manualMaxSlippageBps}
						/>
						<p className="font-manrope text-[#a38c85] text-xs">
							Capped at 2,000 bps (20%) per API. Default from your vault
							profile.
						</p>
					</div>
					<div className="flex items-center gap-3">
						<input
							checked={manualDryRun}
							className="size-4 rounded border border-[#55433d] bg-[#131313] accent-[#d97757]"
							id="dryRun"
							onChange={(e) => setManualDryRun(e.target.checked)}
							type="checkbox"
						/>
						<Label
							className="cursor-pointer font-manrope text-[#dbc1b9] text-sm"
							htmlFor="dryRun"
						>
							Dry run (simulate — no on-chain execution)
						</Label>
					</div>
					<Button
						className="h-11 rounded-md bg-[#d97757] font-manrope text-[#1b1b1b] hover:bg-[#ffb59e]"
						disabled={
							runTradeCycle.isPending || !vaultAddress || balancesLoading
						}
						onClick={() => {
							submitManualTrigger();
						}}
						type="button"
					>
						{runTradeCycle.isPending ? "Running…" : "Run cycle"}
					</Button>
					{(lastTriggerResult || lastTriggerError) && (
						<div className="rounded-md border border-[#55433d] bg-[#131313] p-4">
							<p className="font-manrope text-[#a38c85] text-[10px] uppercase tracking-[0.08em]">
								Last response
							</p>
							{lastTriggerError ? (
								<p className="mt-2 font-manrope text-[#ffb59e] text-sm">
									{lastTriggerError}
								</p>
							) : (
								lastTriggerResult && (
									<dl className="mt-3 grid gap-2 font-manrope text-sm">
										<div className="flex justify-between gap-4">
											<dt className="text-[#a38c85]">Cycle ID</dt>
											<dd className="text-right text-[#e2e2e2]">
												{lastTriggerResult.cycleId}
											</dd>
										</div>
										<div className="flex justify-between gap-4">
											<dt className="text-[#a38c85]">Decision</dt>
											<dd className="text-right text-[#e2e2e2]">
												{lastTriggerResult.decision}
											</dd>
										</div>
										<div className="flex flex-col gap-1">
											<dt className="text-[#a38c85]">Reason</dt>
											<dd className="text-[#dbc1b9]">
												{lastTriggerResult.reason ?? "—"}
											</dd>
										</div>
										<div className="flex justify-between gap-4">
											<dt className="text-[#a38c85]">Tx hash</dt>
											<dd className="text-right">
												{lastTriggerResult.txHash ? (
													<a
														className="text-[#ffb59e] underline-offset-4 hover:underline"
														href={baseScanTxUrl(lastTriggerResult.txHash)}
														rel="noopener noreferrer"
														target="_blank"
													>
														View
													</a>
												) : (
													<span className="text-[#a38c85]">—</span>
												)}
											</dd>
										</div>
										<div className="flex flex-col gap-1">
											<dt className="text-[#a38c85]">Log pointer</dt>
											<dd className="break-all font-mono text-[#a38c85] text-xs">
												{lastTriggerResult.logPointer}
											</dd>
										</div>
									</dl>
								)
							)}
						</div>
					)}
				</div>
			</SheetContent>
		</Sheet>
	);
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
	tokenOut: `0x${string}`,
	wethWei: bigint,
	usdcWei: bigint
) {
	if (wethWei > BigInt(0)) {
		await walletClient.writeContract({
			chain: baseSepolia,
			account: walletAddress,
			address: vaultAddress,
			abi: USER_VAULT_ABI,
			functionName: "withdrawETH",
			args: [wethWei, walletAddress],
		});
	}
	if (usdcWei > BigInt(0)) {
		await walletClient.writeContract({
			chain: baseSepolia,
			account: walletAddress,
			address: vaultAddress,
			abi: USER_VAULT_ABI,
			functionName: "withdraw",
			args: [tokenOut, usdcWei, walletAddress],
		});
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
	const [activityLog, setActivityLog] = useState<CycleLogRecord[]>([]);

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

	const wethWeiBalance = BigInt(balances.data?.wethWei ?? "0");

	useEffect(() => {
		if (!(ready && authenticated)) {
			return;
		}

		const controller = new AbortController();
		const serverBase = process.env.NEXT_PUBLIC_SERVER_URL;
		if (!serverBase) {
			return () => {
				controller.abort();
			};
		}

		getAccessToken()
			.then((token) => {
				if (!token) {
					return;
				}
				return streamVaultCycles({
					serverBase,
					vaultId,
					token,
					signal: controller.signal,
					onHistory: (records) => setActivityLog(records),
					onCycle: (record) =>
						setActivityLog((prev) => [...prev, record].slice(-50)),
				});
			})
			.catch(() => {
				// Best-effort; if this fails, manual trigger still works.
			});

		return () => {
			controller.abort();
		};
	}, [authenticated, ready, vaultId]);

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

		const wallet = wallets[0] as PrivyWalletLike | undefined;
		const walletAddress = wallet?.address;
		if (!walletAddress) {
			toast.error("No wallet connected.");
			return;
		}

		const tokenOut = vault?.tokenOut;
		if (!tokenOut) {
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
			await withdrawVaultTokens(
				walletClient,
				vaultAddress as `0x${string}`,
				walletAddress as `0x${string}`,
				tokenOut as `0x${string}`,
				wethWei,
				usdcWei
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
					<div className="flex flex-wrap gap-3">
						<Button
							className="bg-[#d97757] font-manrope text-[#1b1b1b] hover:bg-[#ffb59e]"
							onClick={() => {
								window.open(
									BASE_SEPOLIA_FAUCET_URL,
									"_blank",
									"noopener,noreferrer"
								);
							}}
							type="button"
						>
							<Droplet className="h-4 w-4" />
							Fund Agent <ExternalLink className="h-4 w-4" />
						</Button>
						<Sheet
							onOpenChange={(open) => {
								setFundSheetOpen(open);
								if (open && primaryWallet?.address) {
									queryClient
										.invalidateQueries({
											queryKey: [
												"wallet-native-balance",
												primaryWallet.address,
											],
										})
										.catch(() => {
											/* balance refetch is best-effort */
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
										Send Base Sepolia ETH from your wallet. It is wrapped to
										WETH inside the vault via{" "}
										<code className="text-[#dbc1b9]">depositETH</code> (full gas
										limit for smart wallets).
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
													className={`h-4 w-4 ${nativeEthBalance.isFetching ? "animate-spin" : ""}`}
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
										<p className="mt-2 font-manrope text-[#a38c85] text-xs">
											Use the same wallet address you use with Privy. After the
											faucet confirms, return here and refresh if needed.
										</p>
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
												/* fundVault surfaces errors via toast */
											});
										}}
										type="button"
									>
										{isFunding ? "Depositing…" : "Deposit into vault"}
									</Button>
								</div>
							</SheetContent>
						</Sheet>
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
								<MoreHorizontal className="h-4 w-4" />
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
									<DropdownMenuItem
										className="font-manrope text-[#dbc1b9] hover:bg-[#2a2a2a]"
										onSelect={() => {
											setFundSheetOpen(true);
										}}
									>
										Fund vault
									</DropdownMenuItem>
									<DropdownMenuSeparator className="bg-[#2a2a2a]" />
									<DropdownMenuItem
										className="font-manrope text-[#dbc1b9] hover:bg-[#2a2a2a]"
										disabled={isWithdrawing || balances.isLoading}
										onSelect={() => {
											withdraw();
										}}
									>
										Withdraw
									</DropdownMenuItem>
								</DropdownMenuGroup>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</header>

				<div className="grid gap-6 md:grid-cols-3">
					<Card className="border-[#55433d] bg-[#1b1b1b]">
						<CardHeader className="pb-2">
							<CardTitle className="font-manrope text-[#a38c85] text-xs uppercase tracking-widest">
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
							<CardTitle className="font-manrope text-[#a38c85] text-xs uppercase tracking-widest">
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
							<CardTitle className="font-manrope text-[#a38c85] text-xs uppercase tracking-widest">
								Total Value (USD)
							</CardTitle>
						</CardHeader>
						<CardContent>
							<p className="font-newsreader text-3xl text-[#f5f5f2]">$ —</p>
						</CardContent>
					</Card>
				</div>

				<div className="mt-12 grid gap-6">
					<VaultManualCycleSheet
						balancesLoading={balances.isLoading}
						onOpenChange={setTriggerSheetOpen}
						onSuccessfulRun={() => undefined}
						open={triggerSheetOpen}
						profile={
							vault
								? {
										maxSlippageBps: vault.maxSlippageBps,
										riskScore: vault.riskScore,
									}
								: null
						}
						runTradeCycle={runTradeCycle}
						vaultAddress={vault?.vaultAddress}
						vaultId={vaultId}
						wethWeiBalance={wethWeiBalance}
					/>
					<Card className="border-[#55433d] bg-[#1b1b1b]">
						<CardHeader className="flex flex-row items-center justify-between border-[#2a2a2a] border-b pb-4">
							<CardTitle className="flex items-center gap-2 font-newsreader font-normal text-2xl text-[#f5f5f2]">
								<Activity className="h-5 w-5 text-[#ffb59e]" />
								Live Activity
							</CardTitle>
							<Button
								className="border-[#55433d] font-manrope text-[#dbc1b9] hover:bg-[#2a2a2a]"
								disabled={runTradeCycle.isPending || !vault?.vaultAddress}
								onClick={() => {
									setTriggerSheetOpen(true);
								}}
								variant="outline"
							>
								Trigger manually
							</Button>
						</CardHeader>
						<CardContent className="py-6">
							{activityLog.length === 0 ? (
								<p className="py-8 text-center font-manrope text-[#a38c85]">
									No cycles yet. Trigger a manual run, or wait for the agent to
									run a cycle.
								</p>
							) : (
								<ul className="flex flex-col gap-4">
									{activityLog.map((entry) => (
										<li
											className="rounded-md border border-[#2a2a2a] bg-[#131313] p-4 text-left"
											key={entry.cycleId}
										>
											<div className="flex flex-wrap items-center justify-between gap-2">
												<p className="font-manrope text-[#a38c85] text-xs">
													{new Date(entry.timestamp).toLocaleString()}
												</p>
												<p className="font-manrope text-[#dbc1b9] text-xs">
													{entry.input.dryRun ? "Dry run" : "Live"}
												</p>
											</div>
											<p className="mt-2 font-manrope text-[#f5f5f2] text-sm">
												<span className="text-[#a38c85]">Action:</span>{" "}
												{entry.proposal.action}
												{" · "}
												<span className="text-[#a38c85]">Decision:</span>{" "}
												{entry.riskDecision.decision}
												{" · "}
												<span className="text-[#a38c85]">Slippage:</span>{" "}
												{entry.input.maxSlippageBps ?? "—"} bps
											</p>
											<p className="mt-1 font-manrope text-[#a38c85] text-xs">
												<span className="text-[#a38c85]">Amount in:</span>{" "}
												{entry.input.amountIn
													? `${formatEther(BigInt(entry.input.amountIn))} WETH`
													: "auto"}
											</p>
											{entry.riskDecision.reason ? (
												<p className="mt-1 font-manrope text-[#a38c85] text-xs">
													{entry.riskDecision.reason}
												</p>
											) : null}
											{entry.execution?.txHash ? (
												<a
													className="mt-2 inline-flex font-manrope text-[#ffb59e] text-xs underline-offset-4 hover:underline"
													href={baseScanTxUrl(entry.execution.txHash)}
													rel="noopener noreferrer"
													target="_blank"
												>
													View transaction
												</a>
											) : null}
										</li>
									))}
								</ul>
							)}
						</CardContent>
					</Card>

					<div />
				</div>
			</div>
		</main>
	);
}
