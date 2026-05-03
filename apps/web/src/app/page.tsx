"use client";

import { Button } from "@auto/ui/components/button";
import { usePrivy } from "@privy-io/react-auth";
import { motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import logo from "@/assets/logo-dark.svg";
import logo0g from "@/assets/partners/0g.webp";
import logoEns from "@/assets/partners/ens.webp";
import logoKeeperhub from "@/assets/partners/keeperhub.webp";
import logoUniswap from "@/assets/partners/uniswap.svg";

export default function Home() {
	const { ready, authenticated, login, logout } = usePrivy();
	const reduceMotion = useReducedMotion();

	let cta: React.ReactNode = (
		<div className="h-11 w-48 animate-pulse rounded-md bg-[#1b1b1b]" />
	);
	if (ready && authenticated) {
		cta = (
			<>
				<Link href="/vaults">
					<Button className="h-11 rounded-md bg-[#d97757] px-7 font-manrope text-[#1b1b1b] hover:bg-[#ffb59e]">
						Open dashboard
					</Button>
				</Link>
				<Button
					className="h-11 rounded-md border border-[#55433d] font-manrope text-[#dbc1b9] hover:bg-[#2a2a2a]"
					onClick={logout}
					variant="outline"
				>
					Log out
				</Button>
			</>
		);
	}
	if (ready && !authenticated) {
		cta = (
			<>
				<Button
					className="h-11 rounded-md bg-[#d97757] px-7 font-manrope text-[#1b1b1b] hover:bg-[#ffb59e]"
					onClick={login}
				>
					Log in
				</Button>
				<p className="text-[#a38c85] text-xs leading-relaxed sm:max-w-xs">
					Sign in with Privy. Funds stay in your vault contract — you stay in
					control.
				</p>
			</>
		);
	}

	return (
		<main className="bg-[#131313] text-[#e2e2e2]">
			<section className="flex min-h-[calc(100vh-64px)] items-center">
				<div className="mx-auto grid w-full max-w-[90dvw] items-center gap-10 px-7 py-12 md:grid-cols-2 md:px-12 md:py-14 lg:px-16">
					<div className="order-2 md:order-1">
						<h1 className="max-w-xl font-newsreader text-5xl text-[#f5f5f2] italic leading-[1.05] md:text-6xl">
							Orchestrate instant autonomous fund managers in a few clicks.
						</h1>
						<p className="mt-5 max-w-xl font-manrope text-[#dbc1b9] text-base leading-relaxed md:text-lg">
							Launch multiple trading agents — each with its own rules, risk
							limits, and memory. Review suggestions, then let the best ones
							execute on schedule.
						</p>

						<ul className="mt-8 grid max-w-xl gap-3 font-manrope text-[#dbc1b9] text-sm md:text-base">
							<li className="flex items-start gap-3">
								<span className="mt-2 inline-block size-1.5 rounded-full bg-[#d97757]" />
								<span>
									<strong className="font-medium text-[#f5f5f2]">
										Smart suggestions
									</strong>{" "}
									Trade ideas with structured reasoning and safety checks before
									any action.
								</span>
							</li>
							<li className="flex items-start gap-3">
								<span className="mt-2 inline-block size-1.5 rounded-full bg-[#d97757]" />
								<span>
									<strong className="font-medium text-[#f5f5f2]">
										Portfolio management
									</strong>{" "}
									Run on demand or on a schedule — the agent keeps context and
									improves over time.
								</span>
							</li>
							<li className="flex items-start gap-3">
								<span className="mt-2 inline-block size-1.5 rounded-full bg-[#d97757]" />
								<span>
									<strong className="font-medium text-[#f5f5f2]">
										Autonomy on your terms
									</strong>{" "}
									Keep it in “suggest only,” or enable execution to trade
									automatically.
								</span>
							</li>
						</ul>

						<div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
							{cta}
						</div>
					</div>

					<div className="order-1 md:order-2">
						<div className="relative mx-auto aspect-square w-full max-w-[720px]">
							<div className="absolute inset-0 rounded-3xl bg-[radial-gradient(circle_at_30%_20%,rgba(217,119,87,0.25),transparent_55%),radial-gradient(circle_at_70%_60%,rgba(245,245,242,0.12),transparent_55%)]" />
							<div className="absolute inset-0 rounded-3xl border border-[#55433d] bg-[#1b1b1b]/40 backdrop-blur-sm" />
							<div className="absolute inset-0 flex items-center justify-center p-10 md:p-14">
								<motion.div
									animate={
										reduceMotion
											? { y: 0 }
											: {
													y: [-4, 4, -4],
												}
									}
									className="h-full w-full"
									transition={
										reduceMotion
											? { duration: 0 }
											: {
													duration: 5.5,
													ease: "easeInOut",
													repeat: Number.POSITIVE_INFINITY,
												}
									}
								>
									<Image
										alt=""
										aria-hidden
										className="h-full w-full opacity-95 drop-shadow-[0_30px_80px_rgba(0,0,0,0.65)]"
										height={800}
										priority
										src={logo}
										unoptimized
										width={800}
									/>
								</motion.div>
							</div>
						</div>
					</div>
				</div>
			</section>

			<section className="border-[#55433d] border-t bg-[#0f0f0f]">
				<div className="mx-auto w-full max-w-[90dvw] px-7 py-14 md:px-12 lg:px-16">
					<div className="mb-10 max-w-2xl">
						<h2 className="mt-3 font-newsreader text-4xl text-[#d97757] italic">
							What powers what
						</h2>
						<p className="mt-4 font-manrope text-[#dbc1b9] leading-relaxed">
							auto.eth is built by composing integrations into one loop: propose
							→ verify → execute → prove.
						</p>
					</div>

					<div className="grid gap-6 md:grid-cols-2">
						<div className="rounded-2xl border border-[#55433d] bg-[#131313] p-6">
							<div className="flex items-center gap-3">
								<div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg bg-white/90">
									<Image
										alt="0G"
										height={32}
										src={logo0g}
										unoptimized
										width={32}
									/>
								</div>
								<div>
									<p className="font-manrope font-medium text-[#f5f5f2]">0G</p>
									<p className="font-manrope text-[#d97757] text-[10px] uppercase tracking-wide">
										Storage + Compute
									</p>
								</div>
							</div>
							<p className="mt-4 font-manrope text-[#dbc1b9] text-sm leading-relaxed">
								Every trade cycle leaves a permanent mark. 0G Storage writes
								structured logs to decentralized KV with stream pointers, batch
								roots, and transaction hashes you can verify. The Compute Router
								adds a second opinion—auditing proposals with verifiable
								inference before any swap hits the chain.
							</p>
						</div>

						<div className="rounded-2xl border border-[#55433d] bg-[#131313] p-6">
							<div className="flex items-center gap-3">
								<Image
									alt="Uniswap"
									height={32}
									src={logoUniswap}
									unoptimized
									width={32}
								/>
								<div>
									<p className="font-manrope font-medium text-[#f5f5f2]">
										Uniswap
									</p>
									<p className="font-manrope text-[#d97757] text-[10px] uppercase tracking-wide">
										Liquidity Layer
									</p>
								</div>
							</div>
							<p className="mt-4 font-manrope text-[#dbc1b9] text-sm leading-relaxed">
								When an agent decides to trade, Uniswap provides the deep
								liquidity pools and smart routing. We integrate the Trading API
								for quotes on mainnet and fall back to direct pool integration
								on testnets—ensuring swaps execute with minimal slippage and
								maximum reliability.
							</p>
						</div>

						<div className="rounded-2xl border border-[#55433d] bg-[#131313] p-6">
							<div className="flex items-center gap-3">
								<div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg bg-white/90">
									<Image
										alt="KeeperHub"
										height={32}
										src={logoKeeperhub}
										unoptimized
										width={32}
									/>
								</div>
								<div>
									<p className="font-manrope font-medium text-[#f5f5f2]">
										KeeperHub
									</p>
									<p className="font-manrope text-[#d97757] text-[10px] uppercase tracking-wide">
										Execution Layer
									</p>
								</div>
							</div>
							<p className="mt-4 font-manrope text-[#dbc1b9] text-sm leading-relaxed">
								Agents propose. KeeperHub executes. Their infrastructure handles
								the heavy lifting: submitting signed contract calls, managing
								gas, retrying on failures, and returning clean receipts. You get
								reliable on-chain confirmation without managing private keys or
								RPC nodes.
							</p>
						</div>

						<div className="rounded-2xl border border-[#55433d] bg-[#131313] p-6">
							<div className="flex items-center gap-3">
								<div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg bg-white/90">
									<Image
										alt="ENS"
										height={32}
										src={logoEns}
										unoptimized
										width={32}
									/>
								</div>
								<div>
									<p className="font-manrope font-medium text-[#f5f5f2]">ENS</p>
									<p className="font-manrope text-[#d97757] text-[10px] uppercase tracking-wide">
										Identity Layer
									</p>
								</div>
							</div>
							<p className="mt-4 font-manrope text-[#dbc1b9] text-sm leading-relaxed">
								Wallet addresses are opaque. ENS names are human. We resolve
								primary names and avatars from Ethereum mainnet so your
								operators appear as "alice.eth" not "0x71C7…". It makes the
								dashboard friendlier and the audit logs more readable—especially
								when managing multiple agents.
							</p>
						</div>
					</div>
				</div>
			</section>
		</main>
	);
}
