"use client";

import { Button } from "@auto/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@auto/ui/components/card";
import { Activity, RefreshCcw } from "lucide-react";
import { CycleLogEntry } from "./cycle-log-entry";
import { useVaultDetailContext } from "./vault-detail-context";

export function LiveActivityCard() {
	const { cycles, setTriggerSheetOpen, runTradeCycle, vault, baseScanTxUrl } =
		useVaultDetailContext();

	return (
		<Card className="border-[#55433d] bg-[#1b1b1b]">
			<CardHeader className="flex flex-row items-center justify-between border-[#2a2a2a] border-b pb-4">
				<CardTitle className="flex items-center gap-2 font-newsreader font-normal text-2xl text-[#f5f5f2]">
					<Activity className="size-5 text-[#ffb59e]" />
					Agent Log
				</CardTitle>
				<Button
					className="border-[#55433d] font-manrope text-[#dbc1b9] hover:bg-[#2a2a2a]"
					disabled={runTradeCycle.isPending || !vault?.vaultAddress}
					onClick={() => setTriggerSheetOpen(true)}
					variant="outline"
				>
					<RefreshCcw className="size-4" />
					Trigger manually
				</Button>
			</CardHeader>
			<CardContent className="py-6">
				{cycles.length === 0 ? (
					<p className="py-8 text-center font-manrope text-[#a38c85]">
						No cycles yet. Trigger a manual run, or wait for the agent to run a
						cycle.
					</p>
				) : (
					<ul className="flex flex-col gap-4">
						{cycles.map((entry) => (
							<CycleLogEntry
								baseScanTxUrl={baseScanTxUrl}
								entry={entry}
								key={entry.cycleId}
							/>
						))}
					</ul>
				)}
			</CardContent>
		</Card>
	);
}
