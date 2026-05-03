"use client";

import type { CycleLogRecord } from "@auto/api/trade-types";
import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { formatEther } from "viem";

const TRUNCATE_REASONING_AT = 220;

const truncate = (value: string, maxLen: number): string =>
	value.length > maxLen ? `${value.slice(0, Math.max(0, maxLen - 1))}…` : value;

const MOCK_RISK_REASON = "Mock risk agent approval";

function slippagePercentLabel(bps: number | undefined): string | null {
	if (bps === undefined || !Number.isFinite(bps)) {
		return null;
	}
	const pct = bps / 100;
	if (pct === Math.floor(pct)) {
		return `${pct}%`;
	}
	return `${pct.toFixed(2)}%`;
}

function agentMovePlainEnglish(
	action: CycleLogRecord["proposal"]["action"]
): string {
	switch (action) {
		case "HOLD":
			return "Hold — no trade";
		case "BUY":
			return "Buy with hub WETH";
		case "SELL":
			return "Sell into hub";
		default:
			return action;
	}
}

/** Turn stiff server copy into short, friendly text when we recognize it. */
function softenRiskReason(raw: string): string {
	const t = raw.trim();
	if (t.includes("HOLD — approved no-op")) {
		return "Pausing is allowed — no funds moved.";
	}
	if (t.includes("within deterministic risk constraints")) {
		return "Passed your vault checks.";
	}
	if (t.startsWith("deterministic=REJECT")) {
		return "Blocked by vault rules.";
	}
	return t;
}

function runPillForMode(mode: CycleLogRecord["mode"] | undefined): {
	runPill: string;
	runPillHint: string | null;
} {
	if (mode === "suggest") {
		return {
			runPill: "Suggestion",
			runPillHint: "Autopilot off — advice only, no auto trade.",
		};
	}
	if (mode === "dryRun") {
		return {
			runPill: "Paper trade",
			runPillHint: "Preview only; nothing on-chain.",
		};
	}
	return {
		runPill: "Live run",
		runPillHint: "Autopilot can execute on-chain when enabled.",
	};
}

function outcomeBlock(entry: CycleLogRecord): {
	accentClass: string;
	headline: string;
	subline: string;
} {
	const approved = entry.riskDecision.decision === "APPROVE";
	const hasTx = Boolean(entry.execution?.txHash);
	const action = entry.proposal.action;
	const mode = entry.mode ?? "live";

	if (!approved) {
		return {
			accentClass: "border-l-4 border-l-[#c45c4a]",
			headline: "Stopped",
			subline: "Safeguards said no — nothing executed.",
		};
	}
	if (hasTx) {
		return {
			accentClass: "border-l-4 border-l-[#5cb88a]",
			headline: "Traded",
			subline: "Swap confirmed on-chain.",
		};
	}
	if (action === "HOLD") {
		return {
			accentClass: "border-l-4 border-l-[#d97757]",
			headline: "Held",
			subline: "No trade — balances unchanged.",
		};
	}
	if (mode === "dryRun") {
		return {
			accentClass: "border-l-4 border-l-[#9b87f5]",
			headline: "Paper run",
			subline: "Nothing sent on-chain.",
		};
	}
	if (mode === "suggest") {
		let headline: string;
		if (action === "BUY") {
			headline = "Suggested buy";
		} else if (action === "SELL") {
			headline = "Suggested sell";
		} else {
			headline = "Suggestion";
		}
		return {
			accentClass: "border-l-4 border-l-[#4a90d9]",
			headline,
			subline: "Not executed — autopilot was off.",
		};
	}
	return {
		accentClass: "border-l-4 border-l-[#6b5d58]",
		headline: "No trade",
		subline: "Run finished without a swap.",
	};
}

function getCyclePresentation(entry: CycleLogRecord): {
	headline: string;
	subline: string;
	runPill: string;
	runPillHint: string | null;
	agentMove: string;
	safeguardsStatus: "cleared" | "blocked";
	safeguardsLine: string;
	sizingLine: string | null;
	slippageLine: string | null;
	riskDetail: ReactNode;
	accentClass: string;
} {
	const approved = entry.riskDecision.decision === "APPROVE";
	const action = entry.proposal.action;
	const mode = entry.mode ?? "live";
	const { accentClass, headline, subline } = outcomeBlock(entry);
	const { runPill, runPillHint } = runPillForMode(mode);

	const rawRisk = entry.riskDecision.reason?.trim() ?? "";
	const hideMock = rawRisk === MOCK_RISK_REASON;
	const showRiskText = Boolean(rawRisk) && !hideMock;

	let riskDetail: ReactNode = null;
	if (!approved) {
		riskDetail = (
			<p className="font-manrope text-[#e8c4be] text-sm leading-relaxed">
				{softenRiskReason(rawRisk || "Didn’t pass checks.")}
			</p>
		);
	} else if (showRiskText) {
		riskDetail = (
			<p className="font-manrope text-[#dbc1b9] text-sm leading-relaxed">
				{softenRiskReason(rawRisk)}
			</p>
		);
	}

	const slip = slippagePercentLabel(entry.input.maxSlippageBps);
	const slippageLine =
		action !== "HOLD" && slip ? `Slippage cap ~${slip}.` : null;

	const sizingLine = entry.input.amountIn
		? `~${formatEther(BigInt(entry.input.amountIn))} WETH considered.`
		: "Sized from vault settings.";

	return {
		accentClass,
		agentMove: agentMovePlainEnglish(action),
		headline,
		riskDetail,
		runPill,
		runPillHint,
		safeguardsLine: approved ? "Looks good." : "Didn’t pass.",
		safeguardsStatus: approved ? "cleared" : "blocked",
		sizingLine,
		slippageLine,
		subline,
	};
}

export function CycleLogEntry({
	entry,
	baseScanTxUrl,
}: {
	entry: CycleLogRecord;
	baseScanTxUrl: (txHash: string) => string;
}) {
	const [isExpanded, setIsExpanded] = useState(false);
	const reasoning = entry.proposal.reasoning;

	const presentation = useMemo(() => getCyclePresentation(entry), [entry]);

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
		<li
			className={`rounded-lg border border-[#2a2a2a] bg-[#131313] py-4 pr-4 pl-5 text-left ${presentation.accentClass}`}
		>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<p
						className="mt-0.5 select-all break-all font-mono text-[#ffb59e] text-xs leading-snug"
						title={entry.cycleId}
					>
						ID: {entry.cycleId}
					</p>
					<h3 className="mt-3 font-newsreader text-[#f5f5f2] text-xl leading-snug">
						{presentation.headline}
					</h3>
					<p className="mt-1 max-w-prose font-manrope text-[#a38c85] text-sm leading-relaxed">
						{presentation.subline}
					</p>
				</div>
				<div className="flex shrink-0 flex-col items-end gap-1">
					<span className="rounded-md border border-[#55433d] bg-[#1b1b1b] px-2.5 py-1 font-manrope text-[#dbc1b9] text-xs">
						{presentation.runPill}
					</span>
				</div>
			</div>

			{presentation.runPillHint ? (
				<p className="mt-3 font-manrope text-[#6b5d58] text-xs leading-relaxed">
					{presentation.runPillHint}
				</p>
			) : null}

			<dl className="mt-5 grid gap-3 border-[#2a2a2a] border-t pt-4 font-manrope text-sm">
				<div>
					<dt className="text-[#a38c85] text-[10px] uppercase tracking-[0.08em]">
						Move
					</dt>
					<dd className="mt-0.5 text-[#e2e2e2]">{presentation.agentMove}</dd>
				</div>
				<div>
					<dt className="text-[#a38c85] text-[10px] uppercase tracking-[0.08em]">
						Safeguards
					</dt>
					<dd className="mt-0.5 text-[#e2e2e2]">
						<span
							className={
								presentation.safeguardsStatus === "cleared"
									? "text-[#b8e0c8]"
									: "text-[#e8a598]"
							}
						>
							{presentation.safeguardsStatus === "cleared"
								? "Cleared"
								: "Blocked"}
						</span>
						<span className="text-[#6b5d58]"> · </span>
						<span className="text-[#dbc1b9]">
							{presentation.safeguardsLine}
						</span>
					</dd>
				</div>
				{presentation.sizingLine ? (
					<div>
						<dt className="text-[#a38c85] text-[10px] uppercase tracking-[0.08em]">
							Size
						</dt>
						<dd className="mt-0.5 text-[#dbc1b9]">{presentation.sizingLine}</dd>
					</div>
				) : null}
				{presentation.slippageLine ? (
					<div>
						<dt className="text-[#a38c85] text-[10px] uppercase tracking-[0.08em]">
							Slippage
						</dt>
						<dd className="mt-0.5 text-[#dbc1b9]">
							{presentation.slippageLine}
						</dd>
					</div>
				) : null}
			</dl>

			{presentation.riskDetail ? (
				<div className="mt-4 rounded-md border border-[#2a2a2a] bg-[#1b1b1b]/80 px-3 py-3">
					<p className="font-manrope text-[#a38c85] text-[10px] uppercase tracking-[0.08em]">
						{presentation.safeguardsStatus === "blocked" ? "Why" : "Note"}
					</p>
					<div className="mt-1">{presentation.riskDetail}</div>
				</div>
			) : null}

			{displayReasoning ? (
				<div className="mt-4 border-[#2a2a2a] border-t pt-4">
					<p className="font-manrope text-[#a38c85] text-[10px] uppercase tracking-[0.08em]">
						Reasoning
					</p>
					<p className="mt-2 font-manrope text-[#dbc1b9] text-sm leading-relaxed">
						{displayReasoning}
					</p>
					{shouldShowToggle ? (
						<button
							className="mt-2 font-manrope text-[#ffb59e] text-xs underline-offset-4 hover:underline"
							onClick={() => setIsExpanded((prev) => !prev)}
							type="button"
						>
							{isExpanded ? "Less" : "More"}
						</button>
					) : null}
				</div>
			) : null}

			{entry.execution?.txHash ? (
				<div className="flex justify-between">
					<a
						className="mt-4 inline-flex items-center gap-1.5 font-manrope text-[#ffb59e] text-sm underline-offset-4 hover:underline"
						href={baseScanTxUrl(entry.execution.txHash)}
						rel="noopener noreferrer"
						target="_blank"
					>
						BaseScan
						<ExternalLink aria-hidden className="size-3.5 opacity-80" />
					</a>

					<p className="mt-4 text-right font-manrope text-[#6b5d58] text-xs">
						{new Date(entry.timestamp).toLocaleString(undefined, {
							dateStyle: "medium",
							timeStyle: "short",
						})}
					</p>
				</div>
			) : (
				<p className="mt-4 text-right font-manrope text-[#6b5d58] text-xs">
					{new Date(entry.timestamp).toLocaleString(undefined, {
						dateStyle: "medium",
						timeStyle: "short",
					})}
				</p>
			)}
		</li>
	);
}
