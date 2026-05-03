"use client";

import type {
	CycleLogRecord,
	GetVaultCycleLogsOutput,
} from "@auto/api/trade-types";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { client } from "@/utils/orpc";
import { useVaultCyclesSse } from "./use-vault-cycles-sse";

const PAGE_SIZE = 10;

type Cursor = NonNullable<GetVaultCycleLogsOutput["nextCursor"]>;

const parseCycleLogRecord = (unknownRecord: unknown): CycleLogRecord | null => {
	if (!unknownRecord || typeof unknownRecord !== "object") {
		return null;
	}
	return unknownRecord as CycleLogRecord;
};

export function useVaultCycleFeed({
	vaultId,
	enabled,
}: {
	vaultId: string;
	enabled: boolean;
}): {
	cycles: CycleLogRecord[];
	fetchNextPage: () => void;
	hasNextPage: boolean;
	isFetchingNextPage: boolean;
} {
	const sseLive = useVaultCyclesSse({ vaultId, enabled });

	const infinite = useInfiniteQuery({
		queryKey: ["vault-cycle-logs", vaultId],
		enabled,
		initialPageParam: null as Cursor | null,
		queryFn: async ({ pageParam }) =>
			await client.getVaultCycleLogs({
				vaultId,
				limit: PAGE_SIZE,
				cursor: pageParam ?? undefined,
			}),
		getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
	});

	const dbCycles = useMemo(() => {
		const items =
			infinite.data?.pages.flatMap((page) => page.items) ??
			([] as GetVaultCycleLogsOutput["items"]);
		const records: CycleLogRecord[] = [];
		for (const item of items) {
			const parsed = parseCycleLogRecord(item.record);
			if (parsed) {
				records.push(parsed);
			}
		}
		return records;
	}, [infinite.data]);

	const cycles = useMemo(() => {
		const map = new Map<string, CycleLogRecord>();
		for (const record of sseLive) {
			map.set(record.cycleId, record);
		}
		for (const record of dbCycles) {
			if (!map.has(record.cycleId)) {
				map.set(record.cycleId, record);
			}
		}
		return [...map.values()].sort(
			(a, b) =>
				new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
		);
	}, [dbCycles, sseLive]);

	return {
		cycles,
		fetchNextPage: () => {
			if (infinite.hasNextPage && !infinite.isFetchingNextPage) {
				infinite.fetchNextPage().catch(() => {
					/* toast handled globally */
				});
			}
		},
		hasNextPage: Boolean(infinite.hasNextPage),
		isFetchingNextPage: infinite.isFetchingNextPage,
	};
}
