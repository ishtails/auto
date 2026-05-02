"use client";

import { Button } from "@auto/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@auto/ui/components/card";
import { Activity, RefreshCcw } from "lucide-react";
import { formatEther } from "viem";
import { useVaultDetailContext } from "./vault-detail-context";

export function LiveActivityCard() {
	const { cycles, setTriggerSheetOpen, runTradeCycle, vault, baseScanTxUrl } =
		useVaultDetailContext();

	return (
		<Card className="border-[#55433d] bg-[#1b1b1b]">
			<CardHeader className="flex flex-row items-center justify-between border-[#2a2a2a] border-b pb-4">
				<CardTitle className="flex items-center gap-2 font-newsreader font-normal text-2xl text-[#f5f5f2]">
					<Activity className="size-5 text-[#ffb59e]" />
					Agent Log
				</CardTitle>
				<Button
					className="border-[#55433d] font-manrope text-[#dbc1b9] hover:bg-[#2a2a2a]"
					disabled={runTradeCycle.isPending || !vault?.vaultAddress}
					onClick={() => setTriggerSheetOpen(true)}
					variant="outline"
				>
					<RefreshCcw className="size-4" />
					Trigger manually
				</Button>
			</CardHeader>
			<CardContent className="py-6">
				{cycles.length === 0 ? (
					<p className="py-8 text-center font-manrope text-[#a38c85]">
						No cycles yet. Trigger a manual run, or wait for the agent to run a
						cycle.
					</p>
				) : (
					<ul className="flex flex-col gap-4">
						{cycles.map((entry) => (
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
	);
}
