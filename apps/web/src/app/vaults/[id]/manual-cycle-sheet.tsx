"use client";

import type {
	RunTradeCycleOutput,
	runTradeCycleInputSchema,
} from "@auto/api/trade-types";
import { Button } from "@auto/ui/components/button";
import { Input } from "@auto/ui/components/input";
import { Label } from "@auto/ui/components/label";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@auto/ui/components/sheet";
import { Toggle } from "@auto/ui/components/toggle";
import {
	type UseQueryResult,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { Circle, ExternalLink } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { type Address, formatEther, isAddress } from "viem";
import type { z } from "zod";
import {
	readVaultMaxTradeSizeBps,
	vaultMaxTradeBpsQueryKey,
} from "@/lib/read-vault-max-trade-bps";
import { orpc } from "@/utils/orpc";
import { useVaultDetailContext } from "./vault-detail-context";

type RunTradeCycleVariables = z.input<typeof runTradeCycleInputSchema>;

function manualCycleOnChainBpsViolationMessage(args: {
	onChainQuery: UseQueryResult<number, Error>;
	size: number;
	vaultAddr: string | null | undefined;
}): string | null {
	if (!(args.vaultAddr && isAddress(args.vaultAddr))) {
		return null;
	}
	if (args.onChainQuery.isPending) {
		return "Reading on-chain max trade size… try again in a moment.";
	}
	const cap = args.onChainQuery.data;
	if (args.onChainQuery.isError || cap === undefined) {
		return "Could not read max trade size from the vault contract. Check the network and try again.";
	}
	if (args.size > cap) {
		return `Trade size (${args.size} bps) exceeds on-chain vault max (${cap} bps).`;
	}
	return null;
}

export function ManualCycleSheet() {
	const {
		vaultId,
		vault,
		balances,
		wethWeiBalance,
		runTradeCycle,
		triggerSheetOpen,
		setTriggerSheetOpen,
		baseScanTxUrl,
	} = useVaultDetailContext();

	const queryClient = useQueryClient();
	const vaultAddr = vault?.vaultAddress;
	const onChainMaxTradeBps = useQuery({
		enabled: Boolean(triggerSheetOpen && vaultAddr && isAddress(vaultAddr)),
		queryFn: () => readVaultMaxTradeSizeBps(vaultAddr as Address),
		queryKey: vaultAddr
			? vaultMaxTradeBpsQueryKey(vaultAddr)
			: ["vault-max-trade-bps", "manual-none"],
	});
	const [tradeSizeBps, setTradeSizeBps] = useState("50");
	const [maxSlippageBps, setMaxSlippageBps] = useState("100");
	const [dryRun, setDryRun] = useState(false);
	const [lastResult, setLastResult] = useState<RunTradeCycleOutput | null>(
		null
	);
	const [lastError, setLastError] = useState<string | null>(null);
	const [lastErrorReason, setLastErrorReason] = useState<string | null>(null);
	const executorEnabled = Boolean(vault?.executorEnabled);

	const executionStatus = (() => {
		if (!lastResult) {
			return "—";
		}
		if (dryRun) {
			return "Paper trade (no execution)";
		}
		if (!executorEnabled) {
			return "Suggest-only (no on-chain execution)";
		}
		if (lastResult.txHash) {
			return "Submitted on-chain";
		}
		if (lastResult.decision === "REJECT") {
			return "Not executed (rejected)";
		}
		return "No on-chain trade (e.g. HOLD or analysis-only)";
	})();

	const parsedTradeSizeBps = Number.parseInt(tradeSizeBps, 10);
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
		if (!(triggerSheetOpen && vault)) {
			return;
		}
		const cap =
			typeof onChainMaxTradeBps.data === "number"
				? onChainMaxTradeBps.data
				: vault.riskScore;
		const initial = Math.min(Math.max(1, vault.riskScore), cap);
		setTradeSizeBps(String(initial));
		const slip = Math.min(Math.max(1, vault.maxSlippageBps), 2000);
		setMaxSlippageBps(String(slip));
		setDryRun(false);
		setLastResult(null);
		setLastError(null);
		setLastErrorReason(null);
	}, [onChainMaxTradeBps.data, triggerSheetOpen, vault]);

	const submit = () => {
		setLastResult(null);
		setLastError(null);
		setLastErrorReason(null);

		const size = Number.parseInt(tradeSizeBps, 10);
		const slip = Number.parseInt(maxSlippageBps, 10);

		if (!Number.isFinite(size) || size < 1 || size > 10_000) {
			toast.error("Trade size must be between 1 and 10,000 bps.");
			return;
		}
		if (!Number.isFinite(slip) || slip < 1 || slip > 2000) {
			toast.error("Max slippage must be between 1 and 2,000 bps.");
			return;
		}

		const chainMsg = manualCycleOnChainBpsViolationMessage({
			onChainQuery: onChainMaxTradeBps,
			size,
			vaultAddr,
		});
		if (chainMsg) {
			toast.error(chainMsg);
			return;
		}

		const amountInWei = (wethWeiBalance * BigInt(size)) / BigInt(10_000);
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
				maxSlippageBps: slip,
				dryRun,
			} satisfies RunTradeCycleVariables,
			{
				onSuccess: async (result) => {
					setLastResult(result);
					await queryClient.invalidateQueries({
						queryKey: orpc.getVaultBalancesByVaultId.queryOptions({
							input: { vaultId },
						}).queryKey,
					});
					await queryClient.invalidateQueries({
						queryKey: ["vault-cycle-logs", vaultId],
					});
				},
				onError: (error) => {
					setLastError(error.message);
					// Best-effort: extract server-provided reason when oRPC surfaces it.
					const maybeAny = error as unknown as { data?: { reason?: string } };
					setLastErrorReason(maybeAny.data?.reason ?? null);
					toast.error(error.message);
				},
			}
		);
	};

	return (
		<Sheet onOpenChange={setTriggerSheetOpen} open={triggerSheetOpen}>
			<SheetContent
				className="flex h-full max-h-screen w-full flex-col gap-0 overflow-hidden border-[#55433d] bg-[#1b1b1b] text-[#e2e2e2] sm:max-w-lg"
				showCloseButton
				side="right"
			>
				<SheetHeader className="shrink-0 border-[#2a2a2a] border-b pb-4 text-left">
					<SheetTitle className="font-newsreader text-[#f5f5f2] text-xl">
						Manual run
					</SheetTitle>
					<SheetDescription className="font-manrope text-[#a38c85] text-sm">
						Ask your agent for a fresh recommendation. If executor (live) mode
						is on, the agent may execute the trade on-chain.
					</SheetDescription>
				</SheetHeader>

				<div className="flex min-h-0 flex-1 flex-col">
					<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-5 pb-10">
						<div className="flex flex-col gap-6">
							<div className="rounded-md border border-[#55433d] bg-[#131313] p-4">
								<p className="font-manrope text-[#a38c85] text-[10px] uppercase tracking-[0.08em]">
									Executor
								</p>
								<p className="mt-1 font-manrope text-[#f5f5f2] text-sm">
									{vault?.executorEnabled
										? "On — can execute"
										: "Off — suggestions only"}
								</p>
								<p className="mt-2 font-manrope text-[#a38c85] text-sm">
									When executor is off, this will never place a trade. You’ll
									just get the agent’s analysis.
								</p>
							</div>

							<div className="rounded-md border border-[#55433d] bg-[#131313] p-4">
								<p className="font-manrope text-[#a38c85] text-[10px] uppercase tracking-[0.08em]">
									Estimated trade size
								</p>
								<p className="mt-1 font-newsreader text-2xl text-[#f5f5f2]">
									{balances.isLoading
										? "…"
										: `${formatEther(estimatedAmountInWei)} WETH`}
								</p>
								<p className="mt-2 font-manrope text-[#a38c85] text-sm">
									Based on your vault balance:{" "}
									{balances.isLoading
										? "…"
										: `${formatEther(wethWeiBalance)} WETH`}
									.
								</p>
							</div>

							<div className="grid gap-2">
								<Label
									className="font-manrope text-[#dbc1b9] text-sm"
									htmlFor="tradeSizeBps"
								>
									How much to use (percent)
								</Label>
								<Input
									className="h-11 rounded-md border-[#55433d] bg-[#131313] font-manrope text-[#e2e2e2] text-sm"
									id="tradeSizeBps"
									inputMode="numeric"
									max={10_000}
									min={1}
									onChange={(e) => setTradeSizeBps(e.target.value)}
									type="number"
									value={tradeSizeBps}
								/>
								<p className="font-manrope text-[#a38c85] text-sm">
									100 bps = 1%. Start small while testing.
								</p>
							</div>

							<div className="grid gap-2">
								<Label
									className="font-manrope text-[#dbc1b9] text-sm"
									htmlFor="maxSlippageBps"
								>
									Price slippage limit (bps)
								</Label>
								<Input
									className="h-11 rounded-md border-[#55433d] bg-[#131313] font-manrope text-[#e2e2e2] text-sm"
									id="maxSlippageBps"
									inputMode="numeric"
									max={2000}
									min={1}
									onChange={(e) => setMaxSlippageBps(e.target.value)}
									type="number"
									value={maxSlippageBps}
								/>
							</div>

							{executorEnabled && (
								<div className="flex items-center justify-between">
									<Toggle
										aria-label="Toggle preview-only mode"
										className="border border-[#55433d] bg-[#131313] font-manrope text-[#dbc1b9] text-sm data-[state=on]:bg-[#2a2a2a]"
										onPressedChange={setDryRun}
										pressed={dryRun}
										variant="outline"
									>
										<Circle className="mr-1 size-3 group-aria-pressed/toggle:fill-foreground" />
										Paper Trade (No Execution)
									</Toggle>
								</div>
							)}

							<Button
								className="h-11 rounded-md bg-[#d97757] font-manrope text-[#1b1b1b] hover:bg-[#ffb59e]"
								disabled={
									runTradeCycle.isPending ||
									!vault?.vaultAddress ||
									balances.isLoading
								}
								onClick={submit}
								type="button"
							>
								{runTradeCycle.isPending ? "Thinking…" : "Get recommendation"}
							</Button>

							{(lastResult || lastError) && (
								<div className="rounded-md border border-[#55433d] bg-[#131313] p-4">
									<p className="font-manrope text-[#a38c85] text-[10px] uppercase tracking-[0.08em]">
										Last response
									</p>
									{lastError ? (
										<div className="mt-2 grid gap-2 bg-red-500">
											<p className="font-manrope text-[#ffb59e] text-sm">
												{lastError}
											</p>
											{lastErrorReason ? (
												<pre className="font-manrope text-[#a38c85] text-sm">
													{JSON.stringify(lastErrorReason, null, 2)}
												</pre>
											) : null}
										</div>
									) : (
										lastResult && (
											<dl className="mt-3 grid gap-2 font-manrope text-sm">
												<div className="flex justify-between gap-4">
													<dt className="text-[#a38c85]">Cycle ID</dt>
													<dd className="text-right text-[#e2e2e2]">
														{lastResult.cycleId}
													</dd>
												</div>
												<div className="flex justify-between gap-4">
													<dt className="text-[#a38c85]">Execution</dt>
													<dd className="text-right text-[#e2e2e2]">
														{executionStatus}
													</dd>
												</div>
												<div className="flex justify-between gap-4">
													<dt className="text-[#a38c85]">Decision</dt>
													<dd className="text-right text-[#e2e2e2]">
														{lastResult.decision}
													</dd>
												</div>
												<div className="flex flex-col gap-1">
													<dt className="text-[#a38c85]">Reason</dt>
													<dd className="text-[#dbc1b9]">
														{lastResult.reason ?? "—"}
													</dd>
												</div>
												<div className="flex justify-between gap-4">
													<dt className="text-[#a38c85]">View Tx</dt>
													<dd className="text-right">
														{lastResult.txHash ? (
															<a
																className="flex items-center gap-1 text-[#ffb59e] underline-offset-4 hover:underline"
																href={baseScanTxUrl(lastResult.txHash)}
																rel="noopener noreferrer"
																target="_blank"
															>
																BaseScan{" "}
																<ExternalLink
																	aria-hidden
																	className="size-3.5 opacity-80"
																/>
															</a>
														) : (
															<span className="text-[#a38c85]">—</span>
														)}
													</dd>
												</div>
												<div className="flex flex-col gap-1">
													<dt className="text-[#a38c85]">Execution ID</dt>
													<dd className="break-all font-mono text-[#a38c85] text-sm">
														{lastResult.executionId ?? "—"}
													</dd>
												</div>
											</dl>
										)
									)}
								</div>
							)}
						</div>
					</div>
				</div>
			</SheetContent>
		</Sheet>
	);
}
