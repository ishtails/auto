interface DexPair {
	baseToken?: { address?: string; symbol?: string };
	dexId?: string;
	liquidity?: { usd?: number | null };
	pairAddress?: string;
	priceChange?: Record<string, number> | null;
	priceNative?: string;
	priceUsd?: string | null;
	quoteToken?: { address?: string; symbol?: string };
	txns?: Record<string, { buys: number; sells: number }>;
	url?: string;
	volume?: Record<string, number>;
}

interface TokenPairsResponse {
	pairs?: DexPair[];
}

export interface DexScreenerMarketContext {
	buySellRatio1h: number | null;
	buySellRatio24h: number | null;
	buys1h: number | null;
	buys24h: number | null;
	chain: string;
	dexId: string | null;
	liquidityUsd: number | null;
	pairAddress: string | null;
	priceChange1hPct: number | null;
	priceChange24hPct: number | null;
	priceNative: string | null;
	priceUsd: string | null;
	sells1h: number | null;
	sells24h: number | null;
	source: "dexscreener";
	url: string | null;
	volume24h: number | null;
}

const DEX_SCREENER_BASE_URL = "https://api.dexscreener.com";

const toLowerAddress = (value: string) => value.toLowerCase();

const normalizeChainIdForDexScreener = (chainId: number): string[] => {
	// DexScreener uses string chain ids. Base Sepolia support may be limited.
	if (chainId === 8453) {
		return ["base"];
	}
	if (chainId === 84_532) {
		// Try likely ids first; fallback to base for best-effort.
		return ["base-sepolia", "baseSepolia", "base"];
	}
	return [];
};

const CACHE_TTL_MS = 30_000;
const marketCache = new Map<
	string,
	{ expiresAt: number; value: DexScreenerMarketContext | null }
>();

async function fetchJsonWithTimeout<T>(
	url: string,
	timeoutMs: number
): Promise<T> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(url, {
			signal: controller.signal,
			headers: { Accept: "application/json" },
		});
		if (!response.ok) {
			throw new Error(`DexScreener HTTP ${response.status}`);
		}
		return (await response.json()) as T;
	} finally {
		clearTimeout(timeout);
	}
}

const pickBestMatchingPair = ({
	pairs,
	tokenIn,
	tokenOut,
}: {
	pairs: DexPair[];
	tokenIn: string;
	tokenOut: string;
}): DexPair | null => {
	const tokenInLower = toLowerAddress(tokenIn);
	const tokenOutLower = toLowerAddress(tokenOut);

	const matching = pairs.filter((pair) => {
		const base = pair.baseToken?.address?.toLowerCase();
		const quote = pair.quoteToken?.address?.toLowerCase();
		if (!(base && quote)) {
			return false;
		}
		return (
			(base === tokenInLower && quote === tokenOutLower) ||
			(base === tokenOutLower && quote === tokenInLower)
		);
	});

	if (matching.length === 0) {
		return null;
	}

	let best = matching[0] ?? null;
	let bestLiquidity = best?.liquidity?.usd ?? 0;
	for (const pair of matching) {
		const liquidityUsd = pair.liquidity?.usd ?? 0;
		if (liquidityUsd > bestLiquidity) {
			best = pair;
			bestLiquidity = liquidityUsd;
		}
	}
	return best;
};

const ratioOrNull = (numerator: number, denominator: number): number | null => {
	if (!(Number.isFinite(numerator) && Number.isFinite(denominator))) {
		return null;
	}
	if (denominator === 0) {
		return null;
	}
	return numerator / denominator;
};

export async function getDexScreenerMarketContext({
	chainId,
	tokenIn,
	tokenOut,
}: {
	chainId: number;
	tokenIn: string;
	tokenOut: string;
}): Promise<DexScreenerMarketContext | null> {
	const cacheKey = `${chainId}:${tokenIn.toLowerCase()}:${tokenOut.toLowerCase()}`;
	const cached = marketCache.get(cacheKey);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.value;
	}

	const chainCandidates = normalizeChainIdForDexScreener(chainId);
	const context = await fetchFirstAvailableMarketContext({
		chainCandidates,
		tokenIn,
		tokenOut,
	});

	marketCache.set(cacheKey, {
		expiresAt: Date.now() + CACHE_TTL_MS,
		value: context,
	});

	return context;
}

async function fetchPairsForToken({
	chain,
	tokenAddress,
}: {
	chain: string;
	tokenAddress: string;
}): Promise<DexPair[]> {
	const url = `${DEX_SCREENER_BASE_URL}/token-pairs/v1/${encodeURIComponent(chain)}/${encodeURIComponent(tokenAddress)}`;
	const data = await fetchJsonWithTimeout<TokenPairsResponse>(url, 1500);
	return data.pairs ?? [];
}

function buildMarketContextFromPair({
	chain,
	pair,
}: {
	chain: string;
	pair: DexPair;
}): DexScreenerMarketContext {
	const priceChange1hPct = pair.priceChange?.h1 ?? null;
	const priceChange24hPct = pair.priceChange?.h24 ?? null;

	const tx1h = pair.txns?.h1 ?? null;
	const buys1h = tx1h?.buys ?? null;
	const sells1h = tx1h?.sells ?? null;
	const buySellRatio1h =
		buys1h !== null && sells1h !== null ? ratioOrNull(buys1h, sells1h) : null;

	const tx24h = pair.txns?.h24 ?? null;
	const buys24h = tx24h?.buys ?? null;
	const sells24h = tx24h?.sells ?? null;
	const buySellRatio24h =
		buys24h !== null && sells24h !== null
			? ratioOrNull(buys24h, sells24h)
			: null;

	return {
		source: "dexscreener",
		chain,
		pairAddress: pair.pairAddress ?? null,
		dexId: pair.dexId ?? null,
		url: pair.url ?? null,
		priceUsd: pair.priceUsd ?? null,
		priceNative: pair.priceNative ?? null,
		priceChange1hPct,
		priceChange24hPct,
		buys1h,
		sells1h,
		buySellRatio1h,
		buys24h,
		sells24h,
		buySellRatio24h,
		volume24h: pair.volume?.h24 ?? null,
		liquidityUsd: pair.liquidity?.usd ?? null,
	};
}

async function fetchFirstAvailableMarketContext({
	chainCandidates,
	tokenIn,
	tokenOut,
}: {
	chainCandidates: string[];
	tokenIn: string;
	tokenOut: string;
}): Promise<DexScreenerMarketContext | null> {
	if (chainCandidates.length === 0) {
		return null;
	}

	for (const chain of chainCandidates) {
		try {
			const pairs = await fetchPairsForToken({ chain, tokenAddress: tokenIn });
			const best = pickBestMatchingPair({ pairs, tokenIn, tokenOut });
			if (!best) {
				continue;
			}
			return buildMarketContextFromPair({ chain, pair: best });
		} catch {
			// Best-effort: try next candidate.
		}
	}

	return null;
}
