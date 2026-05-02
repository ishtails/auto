"use client";

import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@auto/ui/components/card";
import { Activity } from "lucide-react";
import { useEffect, useRef } from "react";
import { CycleLogEntry } from "./cycle-log-entry";
import { useVaultDetailContext } from "./vault-detail-context";

export function LiveActivityCard() {
	const {
		cycles,
		baseScanTxUrl,
		fetchMoreCycles,
		hasMoreCycles,
		isFetchingMoreCycles,
	} = useVaultDetailContext();

	const sentinelRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		const node = sentinelRef.current;
		if (!(node && fetchMoreCycles && hasMoreCycles)) {
			return;
		}

		const observer = new IntersectionObserver(
			(entries) => {
				const entry = entries[0];
				if (entry?.isIntersecting) {
					fetchMoreCycles();
				}
			},
			{ rootMargin: "200px" }
		);

		observer.observe(node);
		return () => observer.disconnect();
	}, [fetchMoreCycles, hasMoreCycles]);

	return (
		<Card className="border-[#55433d] bg-[#1b1b1b]">
			<CardHeader className="flex flex-col gap-4 border-[#2a2a2a] border-b pb-4">
				<div className="space-y-1">
					<CardTitle className="flex items-center gap-2 font-newsreader font-normal text-2xl text-[#f5f5f2]">
						<Activity className="size-5 shrink-0 text-[#ffb59e]" />
						Recent activity
					</CardTitle>
					<p className="max-w-md font-manrope text-[#a38c85] text-sm leading-relaxed">
						Recent holds, suggestions, and trades. Use{" "}
						<span className="text-[#dbc1b9]">Run trade cycle</span> above to
						trigger the agent.
					</p>
				</div>
			</CardHeader>
			<CardContent className="py-6">
				{cycles.length === 0 ? (
					<div className="rounded-lg border border-[#55433d] border-dashed bg-[#131313] px-6 py-10 text-center">
						<p className="font-manrope text-[#f5f5f2] text-sm">
							Nothing here yet.
						</p>
						<p className="mx-auto mt-2 max-w-sm font-manrope text-[#a38c85] text-sm leading-relaxed">
							Run trade cycle or enable autopilot — activity will show up here.
						</p>
					</div>
				) : (
					<ul className="flex flex-col gap-4">
						{cycles.map((entry) => (
							<CycleLogEntry
								baseScanTxUrl={baseScanTxUrl}
								entry={entry}
								key={entry.cycleId}
							/>
						))}
						{hasMoreCycles ? (
							<li className="pt-2">
								<div
									className="text-center font-manrope text-[#a38c85] text-xs"
									ref={sentinelRef}
								>
									{isFetchingMoreCycles
										? "Loading more…"
										: "Scroll to load more"}
								</div>
							</li>
						) : null}
					</ul>
				)}
			</CardContent>
		</Card>
	);
}
