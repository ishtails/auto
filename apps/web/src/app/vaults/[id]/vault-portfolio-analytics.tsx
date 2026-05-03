"use client";

import { isAllowlistTokenKey } from "@auto/api/token-dex-reference";
import type { GetVaultBalancesOutput } from "@auto/api/vault-types";
import { Card, CardContent } from "@auto/ui/components/card";
import {
	type ChartConfig,
	ChartContainer,
	ChartTooltip,
} from "@auto/ui/components/chart";
import { type ComponentProps, useMemo } from "react";
import { Pie, PieChart, type TooltipContentProps } from "recharts";
import { formatUnits } from "viem";
import { useDexscreenerUsdPrices } from "@/lib/dexscreener/use-dexscreener-usd-prices";

const PIE_COLORS: Record<string, string> = {
	WETH: "#d97757",
	USDC: "#4a90d9",
	RISE: "#5cb88a",
};

const pieColor = (key: string): string => PIE_COLORS[key] ?? "#6b7280";

const usdFormatter = new Intl.NumberFormat(undefined, {
	currency: "USD",
	maximumFractionDigits: 6,
	minimumFractionDigits: 6,
	style: "currency",
});

function chartWeight(wei: bigint, decimals: number): number {
	const hu = Number(formatUnits(wei, decimals));
	if (!Number.isFinite(hu) || hu <= 0) {
		return 0;
	}
	return hu;
}

interface PieRow {
	decimals: number;
	human: number;
	key: string;
	symbol: string;
	usd: number | null;
	wei: string;
	weight: number;
}

function buildPieRows(
	tokens: GetVaultBalancesOutput["tokens"],
	prices: Partial<Record<string, number | null>> | undefined
): Omit<PieRow, "weight">[] {
	return tokens
		.map((t) => {
			const human = chartWeight(BigInt(t.wei), t.decimals);
			const px = isAllowlistTokenKey(t.key) && prices ? prices[t.key] : null;
			const usd =
				px != null && Number.isFinite(px) && px > 0 ? human * px : null;
			return {
				decimals: t.decimals,
				human,
				key: t.key,
				symbol: t.symbol,
				usd,
				wei: t.wei,
			};
		})
		.filter((r) => r.human > 0);
}

function portfolioChartPanel(input: {
	chartConfig: ChartConfig;
	chartData: { fill: string; key: string; name: string; value: number }[];
	isLoading: boolean;
	totalWeight: number;
	valueDisplay: "usd" | "units";
}) {
	const { chartConfig, chartData, isLoading, totalWeight, valueDisplay } =
		input;

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
			className="aspect-square min-h-[200px] w-full max-w-[300px] [&>div]:aspect-square"
			config={chartConfig}
			initialDimension={{ height: 300, width: 300 }}
		>
			<PieChart>
				<ChartTooltip
					content={
						((props: TooltipContentProps<number, string>) => {
							const { active, payload } = props;
							if (!(active && payload?.length)) {
								return null;
							}
							const item = payload[0];
							const v = Number(item?.value);
							const display =
								valueDisplay === "usd"
									? usdFormatter.format(v)
									: v.toLocaleString(undefined, { maximumFractionDigits: 8 });
							const label =
								typeof item?.name === "string" || typeof item?.name === "number"
									? String(item.name)
									: "";
							return (
								<div
									className="rounded-lg border border-[#55433d] bg-[#1b1b1b] px-2.5 py-1.5 font-manrope text-[#e2e2e2] text-sm shadow-xl"
									style={{ outline: "none" }}
								>
									<div className="flex items-center justify-between gap-4">
										<span className="text-[#a38c85]">{label}</span>
										<span className="font-mono text-[#f5f5f2] tabular-nums">
											{display}
										</span>
									</div>
								</div>
							);
						}) as ComponentProps<typeof ChartTooltip>["content"]
					}
					cursor={false}
				/>
				<Pie
					cx="50%"
					cy="50%"
					data={chartData}
					dataKey="value"
					innerRadius={60}
					nameKey="name"
					outerRadius={100}
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

	const tokenKeysForPrices = useMemo(() => tokens.map((t) => t.key), [tokens]);

	const priceQuery = useDexscreenerUsdPrices(tokenKeysForPrices, {
		enabled: Boolean(balances?.tokens.length) && !isLoading,
	});

	const chartPending = isLoading || priceQuery.isPending;

	const { pieRows, useUsdPie, totalUsd } = useMemo(() => {
		const base = buildPieRows(tokens, priceQuery.data);
		const allPriced =
			base.length > 0 &&
			base.every((r) => r.usd != null && (r.usd as number) > 0);
		const useUsd = priceQuery.isSuccess && !priceQuery.isError && allPriced;
		const weighted: PieRow[] = base.map((r) => ({
			...r,
			weight: useUsd ? (r.usd as number) : r.human,
		}));
		const usdSum = useUsd
			? weighted.reduce((s, r) => s + (r.usd as number), 0)
			: null;
		return {
			pieRows: weighted,
			totalUsd: usdSum,
			useUsdPie: useUsd,
		};
	}, [tokens, priceQuery.data, priceQuery.isError, priceQuery.isSuccess]);

	const nonZeroCount = tokens.filter((t) => BigInt(t.wei) > BigInt(0)).length;

	const totalWeight = pieRows.reduce((s, r) => s + r.weight, 0);

	const chartConfig: ChartConfig = {
		value: {
			label: useUsdPie ? "USD (DexScreener / Base)" : "Token amount",
		},
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
			<CardContent>
				<div className="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
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
							{(() => {
								if (
									!(
										hub &&
										isAllowlistTokenKey(hub.key) &&
										priceQuery.data?.[hub.key] != null &&
										!chartPending
									)
								) {
									return null;
								}
								const px = priceQuery.data[hub.key] as number;
								return (
									<p className="mt-1 font-manrope text-[#6b5d58] text-sm">
										≈{" "}
										{usdFormatter.format(
											chartWeight(BigInt(hub.wei), hub.decimals) * px
										)}{" "}
										<span className="text-[#55433d]">ref. USD</span>
									</p>
								);
							})()}
						</div>

						<div>
							<p className="mb-3 font-manrope text-[#a38c85] text-[10px] uppercase tracking-[0.08em]">
								Assets
							</p>
							<ul className="space-y-2">
								{assets.map((t) => {
									const zero = BigInt(t.wei) === BigInt(0);
									const px =
										isAllowlistTokenKey(t.key) && priceQuery.data
											? priceQuery.data[t.key]
											: null;
									const human = chartWeight(BigInt(t.wei), t.decimals);
									const estUsd =
										!zero &&
										px != null &&
										Number.isFinite(px) &&
										px > 0 &&
										!chartPending
											? human * px
											: null;
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
												className={`shrink-0 text-right font-mono text-sm tabular-nums ${zero ? "text-[#55433d]" : "text-[#f5f5f2]"}`}
											>
												{isLoading ? (
													"…"
												) : (
													<>
														<span className="block">
															{formatTokenAmount(t.wei, t.decimals)} {t.symbol}
														</span>
														{estUsd == null || estUsd <= 0 ? null : (
															<span className="block font-manrope text-[#6b5d58] text-sm">
																≈ {usdFormatter.format(estUsd)}
															</span>
														)}
													</>
												)}
											</span>
										</li>
									);
								})}
							</ul>
						</div>

						<p className="font-manrope text-[#55433d] text-sm">
							{isLoading
								? "Loading balances…"
								: `${nonZeroCount} of ${tokens.length} tracked tokens on-chain`}
							{useUsdPie && totalUsd != null && totalUsd > 0 ? (
								<>
									{" "}
									· Est. total ≈ {usdFormatter.format(totalUsd)}{" "}
									<span className="text-[#55433d]">(mainnet ref.)</span>
								</>
							) : null}
						</p>
					</div>

					<div className="flex shrink-0 flex-col items-center gap-3 lg:w-[240px]">
						<div
							aria-label={
								useUsdPie
									? "Portfolio mix by USD value"
									: "Portfolio mix by token amount"
							}
							className="w-full max-w-[300px]"
							role="img"
						>
							{portfolioChartPanel({
								chartConfig,
								chartData,
								isLoading: chartPending,
								totalWeight,
								valueDisplay: useUsdPie ? "usd" : "units",
							})}
						</div>
						{!chartPending && totalWeight > 0 && pieRows.length > 1 ? (
							<ul className="w-full space-y-1.5">
								{pieRows.map((row) => (
									<li
										className="flex items-center justify-between gap-2 font-manrope text-[#a38c85] text-sm"
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
