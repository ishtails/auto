"use client";

import type { DiagnosticsResult } from "@auto/api/context";
import { env } from "@auto/env/web";
import { useQuery } from "@tanstack/react-query";
import { Database, ExternalLink, HardDrive } from "lucide-react";

export function DataPlaneStrip() {
	const { data, isError, isPending } = useQuery({
		queryFn: async (): Promise<DiagnosticsResult> => {
			const res = await fetch(`${env.NEXT_PUBLIC_SERVER_URL}/diagnostics`);
			if (!res.ok) {
				throw new Error(`diagnostics ${res.status}`);
			}
			return (await res.json()) as unknown as DiagnosticsResult;
		},
		queryKey: ["integration-diagnostics"],
		refetchInterval: 45_000,
		staleTime: 20_000,
	});

	if (isPending) {
		return (
			<p className="font-manrope text-[#6b5d58] text-xs">
				Loading data plane status…
			</p>
		);
	}

	if (isError || !data) {
		return null;
	}

	const last = data.zeroGStorage.lastWrite;

	return (
		<div className="rounded-lg border border-[#3d352f] bg-[#151515] px-4 py-3">
			<p className="font-manrope text-[#dbc1b9] text-sm leading-relaxed">
				<span className="font-medium text-[#f5f5f2]">How history works: </span>
				{data.architecture}
			</p>
			<div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 font-manrope text-[#a38c85] text-xs">
				<span className="inline-flex items-center gap-1">
					<Database aria-hidden className="size-3.5 opacity-90" />
					Postgres: UI cache / SSE
				</span>
				<span className="inline-flex items-center gap-1">
					<HardDrive aria-hidden className="size-3.5 opacity-90" />
					0G KV:{" "}
					{data.zeroGStorage.kvReachable ? (
						<span className="text-[#b8e0c8]">reachable</span>
					) : (
						<span className="text-[#e8a598]">degraded</span>
					)}
				</span>
				<a
					className="inline-flex items-center gap-1 text-[#ffb59e] underline-offset-4 hover:underline"
					href={data.links.storageExplorer}
					rel="noopener noreferrer"
					target="_blank"
				>
					Storage explorer
					<ExternalLink aria-hidden className="size-3" />
				</a>
			</div>
			{last ? (
				<p className="mt-2 font-mono text-[#6b5d58] text-[11px] leading-relaxed">
					Last 0G KV append on this server: {last.isoTime} ·{" "}
					<span className="break-all">{last.pointer}</span>
					{last.txHash ? ` · L1 tx ${last.txHash.slice(0, 12)}…` : ""}
					{last.rootHash ? ` · root ${last.rootHash.slice(0, 12)}…` : ""}
				</p>
			) : (
				<p className="mt-2 font-manrope text-[#6b5d58] text-xs">
					No KV append recorded on this server process yet — run a cycle to see
					pointer / proof metadata here.
				</p>
			)}
		</div>
	);
}
