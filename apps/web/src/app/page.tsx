"use client";

import { Button } from "@auto/ui/components/button";
import { usePrivy } from "@privy-io/react-auth";
import Image from "next/image";
import Link from "next/link";
import logo from "@/assets/logo-dark.svg";

export default function Home() {
	const { ready, authenticated, login, logout } = usePrivy();

	return (
		<main className="flex min-h-screen flex-col items-center justify-center bg-[#131313] px-6 text-[#e2e2e2]">
			<div className="flex max-w-md flex-col items-center gap-10 text-center">
				<div className="flex flex-col items-center gap-4">
					<Image
						alt="auto.eth"
						className="size-20 rounded-sm bg-muted"
						height={96}
						priority
						src={logo}
						unoptimized
						width={80}
					/>
					<p className="font-(family-name:--font-newsreader) text-4xl text-[#f5f5f2] italic md:text-5xl">
						auto.eth
					</p>
					<p className="font-manrope text-[#dbc1b9] text-sm leading-relaxed md:text-base">
						Sign in to create agents and run trade cycles from your vaults.
					</p>
				</div>

				{ready ? (
					<div className="flex flex-col items-center gap-3 sm:flex-row">
						{authenticated ? (
							<>
								<Link href="/vaults">
									<Button className="h-11 min-w-40 rounded-md bg-[#d97757] px-6 font-manrope text-[#1b1b1b] hover:bg-[#ffb59e]">
										My Agents
									</Button>
								</Link>
								<Button
									className="h-11 min-w-40 rounded-md border border-[#55433d] font-manrope text-[#dbc1b9] hover:bg-[#2a2a2a]"
									onClick={logout}
									variant="outline"
								>
									Log out
								</Button>
							</>
						) : (
							<Button
								className="h-11 min-w-48 rounded-md bg-[#d97757] font-manrope text-[#1b1b1b] hover:bg-[#ffb59e]"
								onClick={login}
							>
								Log in
							</Button>
						)}
					</div>
				) : null}
			</div>
		</main>
	);
}
