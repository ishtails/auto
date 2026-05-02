"use client";

import type { GetVaultBalancesOutput } from "@auto/api/vault-types";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@auto/ui/components/card";
import {
	type ChartConfig,
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "@auto/ui/components/chart";
import { Pie, PieChart } from "recharts";
import { formatUnits } from "viem";

const PIE_COLORS: Record<string, string> = {
	WETH: "#d97757",
	USDC: "#4a90d9",
	RISE: "#5cb88a",
};

const pieColor = (key: string): string => PIE_COLORS[key] ?? "#6b7280";

function chartWeight(wei: bigint, decimals: number): number {
	const hu = Number(formatUnits(wei, decimals));
	if (!Number.isFinite(hu) || hu <= 0) {
		return 0;
	}
	return hu;
}

function portfolioChartPanel(input: {
	chartConfig: ChartConfig;
	chartData: { fill: string; key: string; name: string; value: number }[];
	isLoading: boolean;
	totalWeight: number;
}) {
	const { chartConfig, chartData, isLoading, totalWeight } = input;
	if (isLoading) {
		return (
			<div className="mx-auto aspect-square max-h-[220px] min-h-[200px] w-full animate-pulse rounded-full bg-[#2a2a2a]" />
		);
	}
	if (totalWeight <= 0) {
		return (
			<div
				aria-hidden
				className="mx-auto aspect-square max-h-[220px] min-h-[200px] w-full rounded-full border-2 border-[#2a2a2a] border-dashed"
			/>
		);
	}
	return (
		<ChartContainer
			className="aspect-square min-h-[200px] w-full max-w-[220px] [&>div]:aspect-square"
			config={chartConfig}
			initialDimension={{ height: 220, width: 220 }}
		>
			<PieChart>
				<ChartTooltip
					content={
						<ChartTooltipContent
							className="border-[#55433d] bg-[#1b1b1b] text-[#e2e2e2]"
							hideLabel
							nameKey="key"
						/>
					}
				/>
				<Pie
					cx="50%"
					cy="50%"
					data={chartData}
					dataKey="value"
					innerRadius={52}
					nameKey="name"
					outerRadius={78}
					stroke="transparent"
				/>
			</PieChart>
		</ChartContainer>
	);
}

function formatTokenAmount(wei: string, decimals: number): string {
	try {
		const b = BigInt(wei);
		const s = formatUnits(b, decimals);
		const n = Number(s);
		if (!Number.isFinite(n)) {
			return s;
		}
		if (n === 0) {
			return "0";
		}
		if (n >= 1) {
			return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
		}
		return n.toLocaleString(undefined, { maximumSignificantDigits: 6 });
	} catch {
		return "—";
	}
}

export interface VaultPortfolioAnalyticsProps {
	balances: GetVaultBalancesOutput | undefined;
	isLoading: boolean;
}

export function VaultPortfolioAnalytics({
	balances,
	isLoading,
}: VaultPortfolioAnalyticsProps) {
	const tokens = balances?.tokens ?? [];
	const hub = tokens.find((t) => t.isHub);
	const assets = tokens
		.filter((t) => !t.isHub)
		.sort((a, b) => a.key.localeCompare(b.key));

	const nonZeroCount = tokens.filter((t) => BigInt(t.wei) > BigInt(0)).length;

	const pieRows = tokens
		.map((t) => ({
			key: t.key,
			symbol: t.symbol,
			weight: chartWeight(BigInt(t.wei), t.decimals),
		}))
		.filter((r) => r.weight > 0);

	const totalWeight = pieRows.reduce((s, r) => s + r.weight, 0);

	const chartConfig: ChartConfig = {
		value: { label: "Amount (raw units, not USD)" },
		...Object.fromEntries(
			pieRows.map((row) => [
				row.key,
				{ color: pieColor(row.key), label: row.symbol },
			])
		),
	};

	const chartData = pieRows.map((row) => ({
		fill: `var(--color-${row.key})`,
		key: row.key,
		name: row.symbol,
		value: row.weight,
	}));

	return (
		<Card className="border-[#55433d] bg-[#1b1b1b]">
			<CardHeader className="pb-2">
				<CardTitle className="font-manrope text-[#a38c85] text-xs uppercase tracking-widest">
					Portfolio analytics
				</CardTitle>
				<p className="font-manrope text-[#6b5d58] text-xs leading-relaxed">
					Hub balance is trade-sized in cycles; other rows are allowlisted
					assets. Chart uses raw token amounts (not USD).
				</p>
			</CardHeader>
			<CardContent>
				<div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
					<div className="min-w-0 flex-1 space-y-6">
						<div>
							<p className="font-manrope text-[#a38c85] text-[10px] uppercase tracking-[0.08em]">
								{hub?.symbol ?? "Hub"} (primary)
							</p>
							<p className="mt-1 font-newsreader text-4xl text-[#f5f5f2]">
								{isLoading || !hub
									? "…"
									: `${formatTokenAmount(hub.wei, hub.decimals)} ${hub.symbol}`}
							</p>
						</div>

						<div>
							<p className="mb-3 font-manrope text-[#a38c85] text-[10px] uppercase tracking-[0.08em]">
								Assets
							</p>
							<ul className="space-y-2">
								{assets.map((t) => {
									const zero = BigInt(t.wei) === BigInt(0);
									return (
										<li
											className="flex items-baseline justify-between gap-4 border-[#2a2a2a] border-b pb-2 last:border-b-0"
											key={t.key}
										>
											<span
												className={`font-manrope text-sm ${zero ? "text-[#6b5d58]" : "text-[#dbc1b9]"}`}
											>
												<span
													aria-hidden
													className="mr-2 inline-block size-2 rounded-full"
													style={{ backgroundColor: pieColor(t.key) }}
												/>
												{t.symbol}
											</span>
											<span
												className={`shrink-0 font-mono text-sm tabular-nums ${zero ? "text-[#55433d]" : "text-[#f5f5f2]"}`}
											>
												{isLoading
													? "…"
													: `${formatTokenAmount(t.wei, t.decimals)} ${t.symbol}`}
											</span>
										</li>
									);
								})}
							</ul>
						</div>

						<p className="font-manrope text-[#55433d] text-xs">
							{isLoading
								? "Loading balances…"
								: `${nonZeroCount} of ${tokens.length} tracked tokens on-chain`}
						</p>
					</div>

					<div className="flex shrink-0 flex-col items-center gap-3 lg:w-[240px]">
						<div
							aria-label="Portfolio mix by token amount"
							className="w-full max-w-[220px]"
							role="img"
						>
							{portfolioChartPanel({
								chartConfig,
								chartData,
								isLoading,
								totalWeight,
							})}
						</div>
						{!isLoading && totalWeight > 0 && pieRows.length > 1 ? (
							<ul className="w-full space-y-1.5">
								{pieRows.map((row) => (
									<li
										className="flex items-center justify-between gap-2 font-manrope text-[#a38c85] text-xs"
										key={row.key}
									>
										<span className="flex items-center gap-1.5">
											<span
												aria-hidden
												className="size-2 rounded-full"
												style={{ backgroundColor: pieColor(row.key) }}
											/>
											{row.symbol}
										</span>
										<span className="tabular-nums">
											{((row.weight / totalWeight) * 100).toFixed(1)}%
										</span>
									</li>
								))}
							</ul>
						) : null}
					</div>
				</div>
			</CardContent>
		</Card>
	);
}
