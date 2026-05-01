"use client";

import { Button } from "@auto/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@auto/ui/components/card";
import { Checkbox } from "@auto/ui/components/checkbox";
import { Input } from "@auto/ui/components/input";
import { Label } from "@auto/ui/components/label";
import { usePrivy } from "@privy-io/react-auth";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	ArrowRightLeft,
	CircleDot,
	LoaderCircle,
	SendHorizontal,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import logo from "@/assets/logo-dark.svg";
import { orpc } from "@/utils/orpc";

const WETH_DECIMALS = 18;
const USDC_DECIMALS = 6;

export default function Home() {
	const [amountInEth, setAmountInEth] = useState("0.0005");
	const [maxSlippageBps, setMaxSlippageBps] = useState("100");
	const [dryRun, setDryRun] = useState(false);

	const healthCheck = useQuery(orpc.healthCheck.queryOptions());
	const integrationDiagnostics = useQuery(
		orpc.integrationDiagnostics.queryOptions()
	);
	const vaultBalances = useQuery(orpc.vaultBalances.queryOptions());
	const runTradeCycle = useMutation(orpc.runTradeCycle.mutationOptions());

	const status = useMemo(() => {
		if (healthCheck.isLoading) {
			return { label: "checking", color: "#a38c85" };
		}
		if (!healthCheck.data) {
			return { label: "offline", color: "#ffb4ab" };
		}
		return { label: "online", color: "#83d99c" };
	}, [healthCheck.data, healthCheck.isLoading]);

	const parsedAmountInWei = useMemo(() => {
		try {
			return parseUnits(amountInEth || "0", WETH_DECIMALS).toString();
		} catch {
			return null;
		}
	}, [amountInEth]);

	const canSubmit =
		Boolean(parsedAmountInWei) &&
		maxSlippageBps.length > 0 &&
		!runTradeCycle.isPending &&
		Number.isFinite(Number(maxSlippageBps));

	const onSubmit = () => {
		if (!parsedAmountInWei) {
			return;
		}
		runTradeCycle.mutate({
			amountIn: parsedAmountInWei,
			maxSlippageBps: Number(maxSlippageBps),
			dryRun,
		});
	};

	const result = runTradeCycle.data;
	const txLink = result?.txHash
		? `https://sepolia.basescan.org/tx/${result.txHash}`
		: null;

	const diag = integrationDiagnostics.data;
	const diagItems = [
		{ key: "keeperhub", label: "KeeperHub", ok: diag?.keeperhub ?? false },
		{ key: "axl", label: "AXL", ok: diag?.axl ?? false },
		{ key: "og", label: "0G", ok: diag?.og ?? false },
	] as const;

	const formattedWethBalance = vaultBalances.data
		? Number(
				formatUnits(BigInt(vaultBalances.data.wethWei), WETH_DECIMALS)
			).toFixed(6)
		: "—";
	const formattedUsdcBalance = vaultBalances.data
		? Number(
				formatUnits(BigInt(vaultBalances.data.usdcWei), USDC_DECIMALS)
			).toFixed(2)
		: "—";

	const { ready, authenticated, login, logout } = usePrivy();

	return (
		<main className="min-h-screen bg-[#131313] text-[#e2e2e2]">
			<div className="mx-auto grid w-full max-w-[1200px] gap-10 px-6 py-12 md:px-10 md:py-16">
				<header className="border-[#55433d] border-b pb-8">
					<div className="mb-6 flex items-center justify-between">
						<div className="flex items-center gap-3">
							<Image
								alt="auto.eth"
								className="size-16 rounded-sm bg-muted"
								height={96}
								priority
								src={logo}
								unoptimized
								width={32}
							/>
							<p className="font-(family-name:--font-newsreader) text-4xl text-[#f5f5f2] italic">
								auto.eth
							</p>
						</div>
						<div className="flex items-center gap-4">
							<div className="inline-flex items-center gap-2 rounded-full border border-[#55433d] bg-[#1f1f1f] px-3 py-1.5">
								<CircleDot className="h-3.5 w-3.5" color={status.color} />
								<span className="font-manrope text-[#dbc1b9] text-xs uppercase tracking-[0.08em]">
									API {status.label}
								</span>
							</div>

							{ready && (
								<div className="flex items-center gap-3">
									{authenticated ? (
										<div className="flex items-center gap-3">
											<Link href="/vaults">
												<Button className="h-9 rounded-md border border-[#55433d] bg-[#2a2a2a] text-[#e2e2e2] hover:bg-[#333333]">
													My Agents
												</Button>
											</Link>
											<Button
												className="h-9 rounded-md border-[#55433d] text-[#dbc1b9] hover:bg-[#ffb4ab] hover:text-[#1b1b1b]"
												onClick={logout}
												variant="outline"
											>
												Logout
											</Button>
										</div>
									) : (
										<Button
											className="h-9 rounded-md bg-[#d97757] text-[#1b1b1b] hover:bg-[#ffb59e]"
											onClick={login}
										>
											Login
										</Button>
									)}
								</div>
							)}
						</div>
					</div>
					<h1 className="font-(family-name:--font-newsreader) max-w-4xl text-4xl text-[#f5f5f2] leading-tight md:text-6xl">
						Single-cycle trade execution
					</h1>
					<p className="mt-4 max-w-2xl font-manrope text-[#dbc1b9] text-base leading-relaxed">
						Manual trigger for the deterministic agent pipeline with live vault
						state and execution feedback.
					</p>
				</header>

				<section className="grid gap-6 md:grid-cols-[1.35fr_1fr]">
					<Card className="rounded-lg border border-[#55433d] bg-[#1b1b1b] text-[#e2e2e2] ring-0">
						<CardHeader className="px-6 pt-6">
							<CardTitle className="font-(family-name:--font-newsreader) flex items-center gap-3 font-normal text-2xl text-[#f5f5f2]">
								<ArrowRightLeft className="h-4 w-4 text-[#ffb59e]" />
								Run Trade Cycle
							</CardTitle>
						</CardHeader>
						<CardContent className="grid gap-5 px-6 pb-6">
							<div className="grid gap-2">
								<Label
									className="font-manrope text-[#dbc1b9] text-xs uppercase tracking-[0.08em]"
									htmlFor="amountEth"
								>
									Amount In (WETH)
								</Label>
								<Input
									className="h-11 rounded-md border-[#55433d] bg-[#131313] px-3 font-manrope text-[#e2e2e2] text-sm placeholder:text-[#a38c85] focus-visible:border-[#d97757]"
									id="amountEth"
									onChange={(event) => setAmountInEth(event.target.value)}
									placeholder="0.0005"
									type="number"
									value={amountInEth}
								/>
							</div>

							<div className="grid gap-2">
								<Label
									className="font-manrope text-[#dbc1b9] text-xs uppercase tracking-[0.08em]"
									htmlFor="slippageBps"
								>
									Max Slippage (bps)
								</Label>
								<Input
									className="h-11 rounded-md border-[#55433d] bg-[#131313] px-3 font-manrope text-[#e2e2e2] text-sm placeholder:text-[#a38c85] focus-visible:border-[#d97757]"
									id="slippageBps"
									max="2000"
									min="1"
									onChange={(event) => setMaxSlippageBps(event.target.value)}
									type="number"
									value={maxSlippageBps}
								/>
							</div>

							<div className="flex items-center gap-3">
								<Checkbox
									checked={dryRun}
									className="rounded-[4px] border-[#55433d] data-checked:bg-[#d97757] data-checked:text-[#1b1b1b]"
									id="dryRun"
									onCheckedChange={(checked) => setDryRun(Boolean(checked))}
								/>
								<Label
									className="font-manrope text-[#dbc1b9] text-sm"
									htmlFor="dryRun"
								>
									Dry run (skip execution)
								</Label>
							</div>

							<Button
								className="h-11 rounded-md bg-[#d97757] font-manrope text-[#1b1b1b] text-sm hover:bg-[#ffb59e]"
								disabled={!canSubmit}
								onClick={onSubmit}
								type="button"
							>
								{runTradeCycle.isPending ? (
									<>
										<LoaderCircle className="h-4 w-4 animate-spin" />
										Executing...
									</>
								) : (
									<>
										<SendHorizontal className="h-4 w-4" />
										Run Cycle
									</>
								)}
							</Button>
						</CardContent>
					</Card>

					<Card className="rounded-lg border border-[#55433d] bg-[#1b1b1b] text-[#e2e2e2] ring-0">
						<CardHeader className="px-6 pt-6">
							<CardTitle className="font-(family-name:--font-newsreader) font-normal text-2xl text-[#f5f5f2]">
								Vault Snapshot
							</CardTitle>
						</CardHeader>
						<CardContent className="grid gap-4 px-6 pb-6">
							<div className="flex items-center justify-between border-[#2a2a2a] border-b pb-2">
								<span className="font-manrope text-[#dbc1b9] text-sm">
									WETH Balance
								</span>
								<span className="font-manrope text-[#f5f5f2] text-sm">
									{formattedWethBalance}
								</span>
							</div>
							<div className="flex items-center justify-between border-[#2a2a2a] border-b pb-2">
								<span className="font-manrope text-[#dbc1b9] text-sm">
									USDC Balance
								</span>
								<span className="font-manrope text-[#f5f5f2] text-sm">
									{formattedUsdcBalance}
								</span>
							</div>
							<div className="mt-2 grid gap-2">
								{diagItems.map((item) => (
									<div
										className="flex items-center justify-between"
										key={item.key}
									>
										<span className="font-manrope text-[#dbc1b9] text-sm">
											{item.label}
										</span>
										<span
											className="font-manrope text-xs uppercase tracking-[0.08em]"
											style={{ color: item.ok ? "#83d99c" : "#ffb4ab" }}
										>
											{item.ok ? "ready" : "down"}
										</span>
									</div>
								))}
							</div>
						</CardContent>
					</Card>
				</section>

				<Card className="rounded-lg border border-[#55433d] bg-[#1b1b1b] text-[#e2e2e2] ring-0">
					<CardHeader className="px-6 pt-6">
						<CardTitle className="font-(family-name:--font-newsreader) font-normal text-2xl text-[#f5f5f2]">
							Last Response
						</CardTitle>
					</CardHeader>
					<CardContent className="px-6 pb-6">
						{result ? (
							<div className="grid gap-3 font-manrope text-[#dbc1b9] text-sm">
								<p>
									<span className="text-[#a38c85]">cycleId:</span>{" "}
									{result.cycleId}
								</p>
								<p>
									<span className="text-[#a38c85]">decision:</span>{" "}
									<span
										style={{
											color:
												result.decision === "APPROVE" ? "#83d99c" : "#ffb4ab",
										}}
									>
										{result.decision}
									</span>
								</p>
								{result.decision === "REJECT" && result.reason && (
									<p>
										<span className="text-[#a38c85]">reason:</span>{" "}
										<span className="text-[#ffb4ab]/80 italic">
											{result.reason}
										</span>
									</p>
								)}
								<p>
									<span className="text-[#a38c85]">executionId:</span>{" "}
									{result.executionId ?? "—"}
								</p>
								<p>
									<span className="text-[#a38c85]">txHash:</span>{" "}
									{txLink ? (
										<a
											className="text-[#ffb59e] underline-offset-4 hover:underline"
											href={txLink}
											rel="noopener noreferrer"
											target="_blank"
										>
											{result.txHash}
										</a>
									) : (
										"—"
									)}
								</p>
								<p>
									<span className="text-[#a38c85]">logPointer:</span>{" "}
									{result.logPointer}
								</p>
							</div>
						) : (
							<p className="font-manrope text-[#a38c85] text-sm">
								No cycle run yet.
							</p>
						)}

						{runTradeCycle.error ? (
							<p className="mt-4 font-manrope text-[#ffb4ab] text-sm">
								{runTradeCycle.error.message}
							</p>
						) : null}
					</CardContent>
				</Card>
			</div>
		</main>
	);
}
