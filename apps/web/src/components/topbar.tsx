"use client";

import Image from "next/image";
import Link from "next/link";
import logo from "@/assets/logo-dark.svg";
import { UserDropdown } from "@/components/user-dropdown";

export function Topbar() {
	return (
		<header className="sticky top-0 z-40 border-[#2a2a2a] border-b bg-[#131313]/90 backdrop-blur">
			<div className="mx-auto flex w-full max-w-[1200px] items-center justify-between px-6 py-3 md:px-10">
				<Link className="flex items-center gap-3" href="/vaults">
					<Image
						alt="auto.eth"
						className="size-8 rounded-sm bg-muted"
						height={32}
						priority
						src={logo}
						unoptimized
						width={32}
					/>
					<span className="font-(family-name:--font-newsreader) text-[#f5f5f2] text-xl italic">
						auto.eth
					</span>
				</Link>
				<UserDropdown />
			</div>
		</header>
	);
}
