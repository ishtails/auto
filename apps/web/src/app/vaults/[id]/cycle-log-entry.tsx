"use client";

import type { CycleLogRecord } from "@auto/api/trade-types";
import { useMemo, useState } from "react";
import { formatEther } from "viem";

const TRUNCATE_REASONING_AT = 220;

const truncate = (value: string, maxLen: number): string =>
	value.length > maxLen ? `${value.slice(0, Math.max(0, maxLen - 1))}…` : value;

export function CycleLogEntry({
	entry,
	baseScanTxUrl,
}: {
	entry: CycleLogRecord;
	baseScanTxUrl: (txHash: string) => string;
}) {
	const [isExpanded, setIsExpanded] = useState(false);
	const reasoning = entry.proposal.reasoning;

	const displayReasoning = useMemo(() => {
		if (!reasoning) {
			return null;
		}
		if (isExpanded) {
			return reasoning;
		}
		return truncate(reasoning, TRUNCATE_REASONING_AT);
	}, [isExpanded, reasoning]);

	const shouldShowToggle =
		Boolean(reasoning) && reasoning.length > TRUNCATE_REASONING_AT;

	return (
		<li className="rounded-md border border-[#2a2a2a] bg-[#131313] p-4 text-left">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<p className="font-manrope text-[#a38c85] text-xs">
					{new Date(entry.timestamp).toLocaleString()}
				</p>
				<p className="font-manrope text-[#dbc1b9] text-xs">
					{entry.input.dryRun ? "Dry run" : "Live"}
				</p>
			</div>
			<p className="mt-2 font-manrope text-[#f5f5f2] text-sm">
				<span className="text-[#a38c85]">Action:</span> {entry.proposal.action}
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
			{displayReasoning ? (
				<div className="mt-2">
					<p className="font-manrope text-[#a38c85] text-xs">
						<span className="text-[#a38c85]">Gemini:</span> {displayReasoning}
					</p>
					{shouldShowToggle ? (
						<button
							className="mt-1 font-manrope text-[#ffb59e] text-xs underline-offset-4 hover:underline"
							onClick={() => setIsExpanded((prev) => !prev)}
							type="button"
						>
							{isExpanded ? "Show less" : "Show more"}
						</button>
					) : null}
				</div>
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
	);
}
