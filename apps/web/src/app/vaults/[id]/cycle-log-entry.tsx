"use client";

import type { CycleLogRecord } from "@auto/api/trade-types";
import { env } from "@auto/env/web";
import { ExternalLink } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

const TRAILING_SLASH_RE = /\/$/;

function OgDurableLogBlock({
	og,
}: {
	og: NonNullable<CycleLogRecord["ogStorage"]>;
}) {
	const storageScanBase =
		env.NEXT_PUBLIC_OG_STORAGE_EXPLORER_URL ??
		"https://storagescan-galileo.0g.ai";
	const txPrefix = env.NEXT_PUBLIC_OG_CHAIN_TX_URL_PREFIX?.replace(
		TRAILING_SLASH_RE,
		""
	);

	let daTxLine: ReactNode = null;
	if (og.daTxHash) {
		if (txPrefix) {
			daTxLine = (
				<a
					className="inline-flex items-center gap-1 text-[#c8d9f5] underline-offset-4 hover:underline"
					href={`${txPrefix}/${og.daTxHash}`}
					rel="noopener noreferrer"
					target="_blank"
					title="View DA blob submission transaction on the 0G network"
				>
					DA blob tx
					<ExternalLink aria-hidden className="size-3 opacity-80" />
				</a>
			);
		} else {
			daTxLine = (
				<span className="break-all font-mono text-[#a38c85]">
					DA tx {og.daTxHash}
				</span>
			);
		}
	}

	let txLine: ReactNode = null;
	if (og.txHash) {
		if (txPrefix) {
			txLine = (
				<a
					className="inline-flex items-center gap-1 text-[#ffb59e] underline-offset-4 hover:underline"
					href={`${txPrefix}/${og.txHash}`}
					rel="noopener noreferrer"
					target="_blank"
					title="View batch transaction on the 0G network"
				>
					View batch tx
					<ExternalLink aria-hidden className="size-3 opacity-80" />
				</a>
			);
		} else {
			txLine = (
				<span className="break-all font-mono text-[#a38c85]">
					Batch tx hash {og.txHash}
				</span>
			);
		}
	}

	return (
		<dl>
			<dt className="text-[#8cb4ff] text-[10px] uppercase tracking-[0.08em]">
				Audit trail · 0G Storage
			</dt>
			<dd className="mt-1 space-y-1.5 text-[#c8d9f5] text-xs leading-relaxed">
				<p>
					<span className="font-manrope text-[#6b5d58] text-[10px] uppercase tracking-wide">
						Stream pointer
					</span>
					<span className="mt-0.5 block break-all font-mono opacity-95">
						{og.pointer}
					</span>
				</p>
				{og.rootHash ? (
					<p>
						<span className="font-manrope text-[#6b5d58] text-[10px] uppercase tracking-wide">
							KV batch root
						</span>
						<span className="mt-0.5 block break-all font-mono text-[#a38c85]">
							{og.rootHash}
						</span>
					</p>
				) : null}
				{og.daRootHash ? (
					<p>
						<span className="font-manrope text-[#6b5d58] text-[10px] uppercase tracking-wide">
							DA trace root
						</span>
						<span className="mt-0.5 block break-all font-mono text-[#a38c85]">
							{og.daRootHash}
						</span>
					</p>
				) : null}
				<div className="flex flex-wrap gap-x-3 gap-y-1 font-manrope">
					{og.pending && !(og.txHash || og.rootHash) ? (
						<span className="text-[#a38c85]">Batch proof still syncing…</span>
					) : null}
					{og.lastError ? (
						<span className="text-[#ff8a80]">
							Couldn’t finish audit write: {og.lastError}
						</span>
					) : null}
					{daTxLine}
					{txLine}
					<a
						className="inline-flex items-center gap-1 text-[#8cb4ff] underline-offset-4 hover:underline"
						href={storageScanBase}
						rel="noopener noreferrer"
						target="_blank"
						title="Open 0G Storage Scan explorer"
					>
						0G Storage Scan
						<ExternalLink aria-hidden className="size-3 opacity-80" />
					</a>
				</div>
			</dd>
		</dl>
	);
}

import { useMemo, useState } from "react";
import { formatEther } from "viem";

const TRUNCATE_REASONING_AT = 220;

const truncate = (value: string, maxLen: number): string =>
	value.length > maxLen ? `${value.slice(0, Math.max(0, maxLen - 1))}…` : value;

const MOCK_RISK_REASON = "Mock risk agent approval";

/** Proposes BUY / SELL / HOLD from market + vault context. */
const STRATEGY_AGENT = "Strategy agent";
/** Deterministic checks + 0G Compute validation of the proposal. */
const RISK_AGENT = "Risk agent";

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

function runPillForMode(mode: CycleLogRecord["mode"] | undefined): string {
	if (mode === "suggest") {
		return "Suggestion";
	}
	if (mode === "dryRun") {
		return "Paper trade";
	}
	return "Live run";
}

function outcomeBlock(entry: CycleLogRecord): {
	accentClass: string;
	headline: string;
	subline: string | null;
} {
	const approved = entry.riskDecision.decision === "APPROVE";
	const hasTx = Boolean(entry.execution?.txHash);
	const action = entry.proposal.action;
	const mode = entry.mode ?? "live";

	if (!approved) {
		return {
			accentClass: "border-l-4 border-l-[#c45c4a]",
			headline: "Stopped",
			subline: null,
		};
	}
	if (hasTx) {
		return {
			accentClass: "border-l-4 border-l-[#5cb88a]",
			headline: "Traded",
			subline: null,
		};
	}
	if (action === "HOLD") {
		return {
			accentClass: "border-l-4 border-l-[#d97757]",
			headline: "Held",
			subline: null,
		};
	}
	if (mode === "dryRun") {
		return {
			accentClass: "border-l-4 border-l-[#9b87f5]",
			headline: "Paper run",
			subline: null,
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
			subline: null,
		};
	}
	return {
		accentClass: "border-l-4 border-l-[#6b5d58]",
		headline: "No trade",
		subline: null,
	};
}

function getCyclePresentation(entry: CycleLogRecord): {
	headline: string;
	subline: string | null;
	runPill: string;
	agentMove: string;
	safeguardsStatus: "cleared" | "blocked";
	sizingLine: string | null;
	slippageLine: string | null;
	riskDetail: ReactNode;
	accentClass: string;
} {
	const approved = entry.riskDecision.decision === "APPROVE";
	const action = entry.proposal.action;
	const mode = entry.mode ?? "live";
	const { accentClass, headline, subline } = outcomeBlock(entry);
	const runPill = runPillForMode(mode);

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
	const slippageLine = action !== "HOLD" && slip ? `Up to ~${slip} slip` : null;

	const sizingLine = entry.input.amountIn
		? `~${formatEther(BigInt(entry.input.amountIn))} WETH`
		: null;

	return {
		accentClass,
		agentMove: agentMovePlainEnglish(action),
		headline,
		riskDetail,
		runPill,
		safeguardsStatus: approved ? "cleared" : "blocked",
		sizingLine,
		slippageLine,
		subline,
	};
}

export function CycleLogEntry({
	entry,
	baseScanTxUrl,
	emphasizeEnter = false,
}: {
	entry: CycleLogRecord;
	baseScanTxUrl: (txHash: string) => string;
	/** When true, play a short entrance motion (new live / paginated row). */
	emphasizeEnter?: boolean;
}) {
	const reduceMotion = useReducedMotion();
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

	const playEnter = Boolean(emphasizeEnter && !reduceMotion);

	return (
		<motion.li
			animate={{ opacity: 1, scale: 1, y: 0 }}
			className={`rounded-lg border border-[#2a2a2a] bg-[#131313] py-4 pr-4 pl-5 text-left ${presentation.accentClass}`}
			initial={playEnter ? { opacity: 0, scale: 0.985, y: -14 } : false}
			layout
			transition={{
				type: "spring",
				stiffness: 420,
				damping: 32,
				layout: { duration: 0.22 },
			}}
		>
			{/* Meta: id, run mode, time — pipeline runs below in order */}
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<p className="font-manrope text-[#a38c85] text-[10px] uppercase tracking-[0.08em]">
						Cycle ID
					</p>
					<p
						className="mt-1 select-all break-all font-mono text-[#ffb59e] text-sm leading-snug"
						title={entry.cycleId}
					>
						{entry.cycleId}
					</p>
				</div>
				<div className="flex shrink-0 flex-col items-end gap-2 text-right">
					<span className="rounded-md border border-[#55433d] bg-[#1b1b1b] px-2.5 py-1 font-manrope text-[#dbc1b9] text-sm">
						{presentation.runPill}
					</span>
					<p className="font-manrope text-[#6b5d58] text-xs leading-snug">
						<span className="text-[#a38c85] text-[10px] uppercase tracking-wide">
							Ran at{" "}
						</span>
						<time dateTime={entry.timestamp}>
							{new Date(entry.timestamp).toLocaleString(undefined, {
								dateStyle: "medium",
								timeStyle: "short",
							})}
						</time>
					</p>
				</div>
			</div>

			{/* ① Strategy agent */}
			<section
				aria-labelledby={`strategy-${entry.cycleId}`}
				className="mt-5 rounded-lg border border-[#2f2f2f] bg-[#161616] px-3 py-3"
			>
				<h3
					className="font-newsreader text-[#f0ebe6] text-base leading-snug"
					id={`strategy-${entry.cycleId}`}
				>
					<span className="mr-2 font-manrope text-[#8cb4ff] text-xs tabular-nums">
						1
					</span>
					{STRATEGY_AGENT}
				</h3>
				<dl className="mt-3 space-y-2.5 font-manrope text-sm">
					<div>
						<dt className="text-[#a38c85] text-[10px] uppercase tracking-[0.08em]">
							Recommendation
						</dt>
						<dd className="mt-0.5 text-[#e8e4df]">{presentation.agentMove}</dd>
					</div>
					{presentation.sizingLine ? (
						<div>
							<dt className="text-[#a38c85] text-[10px] uppercase tracking-[0.08em]">
								Trade size
							</dt>
							<dd className="mt-0.5 text-[#dbc1b9]">
								{presentation.sizingLine}
							</dd>
						</div>
					) : null}
					{presentation.slippageLine ? (
						<div>
							<dt className="text-[#a38c85] text-[10px] uppercase tracking-[0.08em]">
								Slippage cap
							</dt>
							<dd className="mt-0.5 text-[#dbc1b9]">
								{presentation.slippageLine}
							</dd>
						</div>
					) : null}
				</dl>
				{displayReasoning ? (
					<div className="mt-3 border-[#2a2a2a] border-t pt-3">
						<p className="font-manrope text-[#a38c85] text-[10px] uppercase tracking-[0.08em]">
							Reasoning
						</p>
						<p className="mt-2 font-manrope text-[#dbc1b9] text-sm leading-relaxed">
							{displayReasoning}
						</p>
						{shouldShowToggle ? (
							<button
								className="mt-2 font-manrope text-[#ffb59e] text-sm underline-offset-4 hover:underline"
								onClick={() => setIsExpanded((prev) => !prev)}
								type="button"
							>
								{isExpanded ? "Less" : "More"}
							</button>
						) : null}
					</div>
				) : null}
			</section>

			{/* ② Risk agent — validates proposal */}
			<section
				aria-labelledby={`risk-${entry.cycleId}`}
				className="mt-4 rounded-lg border border-[#2f2f2f] bg-[#161616] px-3 py-3"
			>
				<h3
					className="font-newsreader text-[#f0ebe6] text-base leading-snug"
					id={`risk-${entry.cycleId}`}
				>
					<span className="mr-2 font-manrope text-[#ffb59e] text-xs tabular-nums">
						2
					</span>
					{RISK_AGENT}
				</h3>
				<dl className="mt-3 font-manrope text-sm">
					<div>
						<dt className="text-[#a38c85] text-[10px] uppercase tracking-[0.08em]">
							Verdict
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
									? "Passed"
									: "Did not pass"}
							</span>
						</dd>
					</div>
				</dl>
				{presentation.riskDetail ? (
					<div className="mt-3 border-[#2a2a2a] border-t pt-3">
						<p className="font-manrope text-[#a38c85] text-[10px] uppercase tracking-[0.08em]">
							{presentation.safeguardsStatus === "blocked" ? "Detail" : "Note"}
						</p>
						<div className="mt-1">{presentation.riskDetail}</div>
					</div>
				) : null}
			</section>

			{/* Outcome */}
			<div className="mt-5 border-[#2a2a2a] border-t pt-4">
				<h3 className="font-newsreader text-[#f5f5f2] text-xl leading-snug">
					{presentation.headline}
				</h3>
				{presentation.subline ? (
					<p className="mt-1 max-w-prose font-manrope text-[#a38c85] text-sm leading-relaxed">
						{presentation.subline}
					</p>
				) : null}
			</div>

			{entry.execution?.txHash ? (
				<div className="mt-4">
					<a
						className="inline-flex items-center gap-1.5 font-manrope text-[#ffb59e] text-sm underline-offset-4 hover:underline"
						href={baseScanTxUrl(entry.execution.txHash)}
						rel="noopener noreferrer"
						target="_blank"
						title="Open swap transaction on BaseScan"
					>
						View swap on BaseScan
						<ExternalLink aria-hidden className="size-3.5 opacity-80" />
					</a>
				</div>
			) : null}

			{entry.ogStorage ? (
				<div className="mt-5 border-[#2a2a2a] border-t pt-4 font-manrope text-sm">
					<OgDurableLogBlock og={entry.ogStorage} />
				</div>
			) : null}
		</motion.li>
	);
}
