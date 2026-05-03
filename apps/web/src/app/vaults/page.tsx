"use client";

import { Button } from "@auto/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@auto/ui/components/card";
import { usePrivy } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Plus, ShieldCheck } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { orpc } from "@/utils/orpc";

export default function VaultsPage() {
	const { authenticated, login, ready } = usePrivy();
	const listVaults = useQuery(orpc.listVaults.queryOptions());

	if (!ready) {
		return null;
	}

	if (!authenticated) {
		return (
			<main className="flex min-h-[calc(100vh-64px)] items-center justify-center bg-[#131313] px-7 text-[#e2e2e2] md:px-12 lg:px-16">
				<div className="w-full max-w-lg rounded-2xl border border-[#55433d] bg-[#1b1b1b] p-8 text-center">
					<ShieldCheck className="mx-auto mb-5 h-12 w-12 text-[#d97757]" />
					<h1 className="font-newsreader text-4xl text-[#f5f5f2] italic">
						Sign in to orchestrate your agents
					</h1>
					<p className="mt-3 font-manrope text-[#dbc1b9] leading-relaxed">
						Create multiple fund managers, review suggestions, and optionally
						turn on execution — all from one dashboard.
					</p>
					<Button
						className="mt-7 h-11 rounded-md bg-[#d97757] px-8 font-manrope text-[#1b1b1b] hover:bg-[#ffb59e]"
						onClick={login}
					>
						Log in
					</Button>
				</div>
			</main>
		);
	}

	const vaultCount = listVaults.data?.length ?? 0;

	return (
		<main className="min-h-[calc(100vh-64px)] bg-[#131313] text-[#e2e2e2]">
			<div className="mx-auto w-full max-w-[90dvw] px-7 py-12 md:px-12 md:py-14 lg:px-16">
				<header className="mb-10 flex flex-wrap items-end justify-between gap-6 border-[#55433d] border-b pb-8">
					<div>
						<p className="font-manrope text-[#d97757] text-[10px] uppercase tracking-[0.2em]">
							Dashboard
						</p>
						<h1 className="mt-3 font-newsreader text-5xl text-[#f5f5f2] italic">
							Your fund managers
						</h1>
						<p className="mt-2 max-w-2xl font-manrope text-[#dbc1b9]">
							Spin up agents per strategy, compare suggestions, and switch
							between suggest-only and execution when you’re ready.
						</p>
					</div>
					<Link href="/vaults/create">
						<Button className="h-11 rounded-md bg-[#d97757] font-manrope text-[#1b1b1b] hover:bg-[#ffb59e]">
							<Plus className="h-4 w-4" />
							Create agent
						</Button>
					</Link>
				</header>

				<div className="mb-8 flex flex-wrap items-center justify-between gap-3">
					<p className="font-manrope text-[#a38c85] text-sm">
						{listVaults.isLoading ? "Loading…" : `${vaultCount} agent(s)`}
					</p>
				</div>

				<div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
					{listVaults.isLoading &&
						Array.from({ length: 3 }).map((_, i) => (
							<Card
								className="animate-pulse border-[#55433d] bg-[#1b1b1b]"
								key={i}
							>
								<div className="h-44" />
							</Card>
						))}

					{!listVaults.isLoading && listVaults.data?.length === 0 && (
						<Card className="col-span-full border-[#55433d] border-dashed bg-transparent py-20">
							<CardContent>
								<div className="mx-auto max-w-lg text-center">
									<p className="font-newsreader text-3xl text-[#f5f5f2] italic">
										Create your first agent
									</p>
									<p className="mt-3 font-manrope text-[#a38c85] leading-relaxed">
										Each agent is a dedicated fund manager with its own rules,
										risk limits, and memory. Start with one strategy and
										iterate.
									</p>
									<div className="mt-7 flex justify-center">
										<Link href="/vaults/create">
											<Button className="h-11 rounded-md bg-[#d97757] px-7 font-manrope text-[#1b1b1b] hover:bg-[#ffb59e]">
												<Plus className="h-4 w-4" />
												Create agent
											</Button>
										</Link>
									</div>
								</div>
							</CardContent>
						</Card>
					)}

					{!listVaults.isLoading &&
						listVaults.data?.map((vault) => (
							<Link href={`/vaults/${vault.id}` as Route} key={vault.id}>
								<Card className="group cursor-pointer border border-[#55433d] bg-[#1b1b1b] transition-colors hover:border-[#ffb59e]/50 hover:bg-[#1f1f1f]">
									<CardHeader className="pb-3">
										<div className="flex items-center justify-between">
											<span className="font-manrope text-[#d97757] text-[10px] uppercase tracking-[0.2em]">
												{vault.status}
											</span>
											<ExternalLink className="h-3 w-3 text-[#a38c85] opacity-0 transition-opacity group-hover:opacity-100" />
										</div>
										<CardTitle className="mt-2 font-newsreader font-normal text-2xl text-[#f5f5f2]">
											{vault.name || "Agent"}
										</CardTitle>
									</CardHeader>
									<CardContent>
										<div className="flex flex-col gap-3 font-manrope text-[#dbc1b9] text-sm">
											<div className="flex items-center justify-between">
												<span className="text-[#a38c85]">Risk</span>
												<span className="text-[#f5f5f2] tabular-nums">
													{vault.riskScore}/100
												</span>
											</div>
											<div className="flex items-center justify-between">
												<span className="text-[#a38c85]">Executor</span>
												<span className="text-[#f5f5f2]">
													{vault.executorEnabled ? "ON" : "OFF"}
												</span>
											</div>
											<div className="flex items-center justify-between">
												<span className="text-[#a38c85]">Address</span>
												<span className="font-mono text-[#f5f5f2]">
													{vault.vaultAddress
														? `${vault.vaultAddress.slice(0, 6)}…${vault.vaultAddress.slice(-4)}`
														: "Deploying…"}
												</span>
											</div>
										</div>
									</CardContent>
								</Card>
							</Link>
						))}
				</div>
			</div>
		</main>
	);
}
