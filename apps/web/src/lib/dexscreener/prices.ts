/**
 * Portfolio UI: browser `fetch()` to DexScreener. Trade-cycle / LLM uses the server module instead.
 */
import {
	type AllowlistTokenKey,
	DEX_SCREENER_CHAIN_SLUG_BASE,
	TOKEN_MAINNET_REF_BY_KEY,
} from "@auto/api/token-dex-reference";

const DEX_SCREENER_BASE_URL = "https://api.dexscreener.com";

const FETCH_TIMEOUT_MS = 2500;

interface DexPair {
	baseToken?: { address?: string };
	liquidity?: { usd?: number | null };
	priceNative?: string | null;
	priceUsd?: string | null;
	quoteToken?: { address?: string };
}

type TokenPairsPayload = DexPair[] | { pairs?: DexPair[] };

const normalizePairs = (data: unknown): DexPair[] => {
	if (Array.isArray(data)) {
		return data as DexPair[];
	}
	if (data && typeof data === "object" && "pairs" in data) {
		const pairs = (data as { pairs?: DexPair[] }).pairs;
		return pairs ?? [];
	}
	return [];
};

async function fetchJson<T>(url: string): Promise<T> {
	const controller = new AbortController();
	const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		const res = await fetch(url, {
			headers: { Accept: "application/json" },
			signal: controller.signal,
		});
		if (!res.ok) {
			throw new Error(`DexScreener HTTP ${res.status}`);
		}
		return (await res.json()) as T;
	} finally {
		clearTimeout(t);
	}
}

/** All pairs that list this token on a chain (DexScreener returns a top-level array). */
export async function fetchDexscreenerPairsForToken(
	chainSlug: string,
	tokenAddress: string
): Promise<DexPair[]> {
	const url = `${DEX_SCREENER_BASE_URL}/token-pairs/v1/${encodeURIComponent(chainSlug)}/${encodeURIComponent(tokenAddress)}`;
	const data = await fetchJson<TokenPairsPayload>(url);
	return normalizePairs(data);
}

/**
 * Best-effort USD price for `tokenAddress` from DexScreener pair data.
 * Prefers pools where the token is base (`priceUsd`). If only listed as quote, uses
 * `priceUsd` / `priceNative` on the highest-liquidity pool (base USD per unit, native = quote per base).
 */
export function resolveTokenUsdFromPairs(
	tokenAddress: string,
	pairs: DexPair[]
): number | null {
	const t = tokenAddress.toLowerCase();
	const scored = pairs.map((p) => ({
		liq: p.liquidity?.usd ?? 0,
		p,
	}));

	const asBase = scored.filter(
		({ p }) => p.baseToken?.address?.toLowerCase() === t
	);
	if (asBase.length > 0) {
		const best = asBase.reduce((a, b) => (b.liq > a.liq ? b : a));
		const u = Number(best.p.priceUsd);
		if (Number.isFinite(u) && u > 0) {
			return u;
		}
	}

	const asQuote = scored.filter(
		({ p }) => p.quoteToken?.address?.toLowerCase() === t
	);
	if (asQuote.length > 0) {
		const best = asQuote.reduce((a, b) => (b.liq > a.liq ? b : a));
		const { p } = best;
		const baseUsd = Number(p.priceUsd);
		const native = Number(p.priceNative);
		if (
			Number.isFinite(baseUsd) &&
			baseUsd > 0 &&
			Number.isFinite(native) &&
			native > 0
		) {
			const quoteUsd = baseUsd / native;
			if (Number.isFinite(quoteUsd) && quoteUsd > 0) {
				return quoteUsd;
			}
		}
	}

	return null;
}

/** Fetches USD prices from DexScreener in the browser (Base mainnet). */
export async function fetchAllowlistUsdPrices(
	keys: readonly AllowlistTokenKey[]
): Promise<Record<AllowlistTokenKey, number | null>> {
	const unique = [...new Set(keys)];
	const entries = await Promise.all(
		unique.map(async (key) => {
			const addr = TOKEN_MAINNET_REF_BY_KEY[key];
			const pairs = await fetchDexscreenerPairsForToken(
				DEX_SCREENER_CHAIN_SLUG_BASE,
				addr
			);
			return [key, resolveTokenUsdFromPairs(addr, pairs)] as const;
		})
	);
	return Object.fromEntries(entries) as Record<
		AllowlistTokenKey,
		number | null
	>;
}
