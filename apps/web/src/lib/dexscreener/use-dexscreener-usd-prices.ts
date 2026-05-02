import {
	type AllowlistTokenKey,
	isAllowlistTokenKey,
} from "@auto/api/token-dex-reference";
import { useQuery } from "@tanstack/react-query";
import { fetchAllowlistUsdPrices } from "./prices";

const STALE_MS = 30_000;

/** Client-side DexScreener USD prices (Base mainnet reference). */
export function useDexscreenerUsdPrices(
	tokenKeys: readonly string[] | undefined,
	options?: { enabled?: boolean }
) {
	const keys = (tokenKeys ?? [])
		.filter(isAllowlistTokenKey)
		.filter((k, i, a) => a.indexOf(k) === i)
		.sort() as AllowlistTokenKey[];

	return useQuery({
		queryKey: ["dexscreener-usd", ...keys],
		queryFn: () => fetchAllowlistUsdPrices(keys),
		staleTime: STALE_MS,
		enabled: (options?.enabled ?? true) && keys.length > 0,
	});
}
