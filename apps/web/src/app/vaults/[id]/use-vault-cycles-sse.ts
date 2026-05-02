"use client";

import type { CycleLogRecord } from "@auto/api/trade-types";
import { getAccessToken } from "@privy-io/react-auth";
import { useEffect, useState } from "react";

const parseSseEvent = (
	block: string
): { event: string; data: string } | null => {
	const lines = block.split("\n");
	let event = "message";
	const dataLines: string[] = [];
	for (const line of lines) {
		if (line.startsWith("event:")) {
			event = line.slice("event:".length).trim();
			continue;
		}
		if (line.startsWith("data:")) {
			dataLines.push(line.slice("data:".length).trimStart());
		}
	}
	if (dataLines.length === 0) {
		return null;
	}
	return { event, data: dataLines.join("\n") };
};

async function streamVaultCycles({
	serverBase,
	vaultId,
	token,
	signal,
	onHistory,
	onCycle,
}: {
	serverBase: string;
	vaultId: string;
	token: string;
	signal: AbortSignal;
	onHistory: (records: CycleLogRecord[]) => void;
	onCycle: (record: CycleLogRecord) => void;
}): Promise<void> {
	const res = await fetch(
		`${serverBase}/sse/vaults/${vaultId}/cycles?limit=10`,
		{
			headers: { Authorization: `Bearer ${token}` },
			signal,
		}
	);

	if (!(res.ok && res.body)) {
		return;
	}

	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	for (;;) {
		const { value, done } = await reader.read();
		if (done) {
			return;
		}

		buffer += decoder.decode(value, { stream: true });

		let idx = buffer.indexOf("\n\n");
		while (idx !== -1) {
			const block = buffer.slice(0, idx);
			buffer = buffer.slice(idx + 2);
			idx = buffer.indexOf("\n\n");

			const evt = parseSseEvent(block);
			if (!evt) {
				continue;
			}

			if (evt.event === "history") {
				onHistory(JSON.parse(evt.data) as CycleLogRecord[]);
				continue;
			}

			if (evt.event === "cycle") {
				onCycle(JSON.parse(evt.data) as CycleLogRecord);
			}
		}
	}
}

/**
 * Live SSE feed for a vault's most recent cycles.
 *
 * - `history` is intentionally capped server-side (default 10)
 * - new `cycle` events arrive in real time
 * - older history should be loaded via paginated RPC (see `useVaultCycleFeed`)
 */
export function useVaultCyclesSse({
	vaultId,
	enabled,
}: {
	vaultId: string;
	enabled: boolean;
}): CycleLogRecord[] {
	const [cycles, setCycles] = useState<CycleLogRecord[]>([]);

	useEffect(() => {
		if (!enabled) {
			return;
		}

		const serverBase = process.env.NEXT_PUBLIC_SERVER_URL;
		if (!serverBase) {
			return;
		}

		const controller = new AbortController();

		getAccessToken()
			.then((token) => {
				if (!token) {
					return;
				}
				return streamVaultCycles({
					serverBase,
					vaultId,
					token,
					signal: controller.signal,
					onHistory: (records) => setCycles(records),
					onCycle: (record) =>
						setCycles((prev) => [...prev, record].slice(-10)),
				});
			})
			.catch(() => {
				// Best-effort stream. UI remains usable without it.
			});

		return () => {
			controller.abort();
		};
	}, [enabled, vaultId]);

	return cycles;
}
