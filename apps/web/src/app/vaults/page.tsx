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
import { ExternalLink, Plus, ShieldCheck, Wallet } from "lucide-react";
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
			<div className="flex min-h-screen flex-col items-center justify-center bg-[#131313] px-6 text-[#e2e2e2]">
				<ShieldCheck className="mb-6 h-16 w-16 text-[#d97757]" />
				<h1 className="mb-2 font-newsreader text-4xl text-[#f5f5f2] italic">
					Authentication Required
				</h1>
				<p className="mb-8 max-w-md text-center font-manrope text-[#dbc1b9]">
					Please log in to view and manage your User-Owned Vaults.
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

	return (
		<main className="min-h-screen bg-[#131313] text-[#e2e2e2]">
			<div className="mx-auto w-full max-w-[1200px] px-6 py-12 md:px-10 md:py-16">
				<header className="mb-12 flex items-center justify-between border-[#55433d] border-b pb-8">
					<div>
						<h1 className="font-newsreader text-5xl text-[#f5f5f2] italic">
							My Agents
						</h1>
						<p className="mt-2 font-manrope text-[#dbc1b9]">
							Manage your autonomous trading agents and non-custodial vaults.
						</p>
					</div>
					<Link href="/vaults/create">
						<Button className="h-11 rounded-md bg-[#d97757] font-manrope text-[#1b1b1b] hover:bg-[#ffb59e]">
							<Plus className="h-4 w-4" />
							Create Vault
						</Button>
					</Link>
				</header>

				<div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
					{listVaults.isLoading &&
						Array.from({ length: 3 }).map((_, i) => (
							<Card
								className="animate-pulse border-[#55433d] bg-[#1b1b1b]"
								key={i}
							>
								<div className="h-48" />
							</Card>
						))}

					{!listVaults.isLoading && listVaults.data?.length === 0 && (
						<Card className="col-span-full border-[#55433d] border-dashed bg-transparent py-20 text-center">
							<CardContent>
								<Wallet className="mx-auto mb-4 h-12 w-12 text-[#a38c85]" />
								<p className="font-manrope text-[#a38c85]">
									No vaults found. Create your first vault to start trading.
								</p>
							</CardContent>
						</Card>
					)}

					{!listVaults.isLoading &&
						listVaults.data?.map((vault) => (
							<Link href={`/vaults/${vault.id}`} key={vault.id}>
								<Card className="group cursor-pointer border border-[#55433d] bg-[#1b1b1b] transition-all hover:border-[#ffb59e]/50 hover:bg-[#1f1f1f]">
									<CardHeader className="pb-3">
										<div className="flex items-center justify-between">
											<span className="font-manrope text-[#d97757] text-[10px] uppercase tracking-[0.2em]">
												{vault.status}
											</span>
											<ExternalLink className="h-3 w-3 text-[#a38c85] opacity-0 transition-opacity group-hover:opacity-100" />
										</div>
										<CardTitle className="mt-2 font-newsreader font-normal text-2xl text-[#f5f5f2]">
											{vault.name || "Unnamed Vault"}
										</CardTitle>
									</CardHeader>
									<CardContent>
										<div className="flex flex-col gap-2 font-manrope text-[#dbc1b9] text-sm">
											<div className="flex justify-between">
												<span>Asset Pair</span>
												<span className="text-[#f5f5f2]">WETH / USDC</span>
											</div>
											<div className="flex justify-between">
												<span>Risk Profile</span>
												<span className="text-[#f5f5f2]">
													{vault.riskScore}/100
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
